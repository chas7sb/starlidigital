import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PortableAppAuthority } from './app-authority-r4/package/server/portable-authority.ts';
import { createTrustedAuthorityService, RemoteTrustedAppAuthority } from './app-authority-r4/package/server/trusted-authority-service.ts';
import { FixtureAppAuthority } from './app-authority-r4/package/server/authority.ts';
import { createAppServer, loadVerifiedBuild } from './app-authority-r4/package/server/app-server.ts';
import { openSqlite, migrateSqlite, SqliteDogStore } from './app-authority-r4/package/server/storage.ts';
import { DurableOrchestrationStore, installDurableNativeStopBridge } from './orchestration-r4/durable-orchestration-stop.mjs';
import { validateWorkerProgressEnvelope } from './ui/worker-task-progress.ts';

test('R4-08 & R4-09: PortableAppAuthority enforces internal store pin even when state.storeFilePath is omitted, and persists bootstrap redemptions across fresh instances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r4-portable-'));
  const storePath = join(dir, 'authority.sqlite');
  writeFileSync(storePath, 'initial-authority-sentinel', { mode: 0o600 });
  const key = randomBytes(32);
  const now = Date.now();
  const state = {
    available: true,
    revokedJtis: new Set(),
    revokedUsers: new Set(),
    activeMemberships: new Map([['comp-1:user-1', { active: true, revision: 7, role: 'owner' }]]),
    activeLeases: new Map([['lease-1', { companyId: 'comp-1', projectId: 'proj-1', generation: 3, active: true }]]),
  };
  const expected = { companyId: 'comp-1', projectId: 'proj-1', leaseId: 'lease-1', processGeneration: 3, nowMs: now };

  try {
    const auth1 = new PortableAppAuthority({ signingKey: key, pinnedStorePath: storePath });
    const ticket = auth1.issueTicket({
      companyId: 'comp-1', projectId: 'proj-1', userId: 'user-1',
      leaseId: 'lease-1', processGeneration: 3, authorityRevision: 7,
      issuedAt: now - 1000, expiresAt: now + 60000,
    });

    // 1. Valid ticket + first bootstrap redemption succeeds (even with state.storeFilePath omitted!)
    const ok1 = auth1.verifyTicket(ticket, { ...expected, singleUseBootstrap: true }, state);
    assert.equal(ok1.ok, true);
    auth1.close();

    // 2. Fresh instance (simulating process restart) MUST reject replayed bootstrap ticket
    const auth2 = new PortableAppAuthority({ signingKey: key, pinnedStorePath: storePath });
    const replay2 = auth2.verifyTicket(ticket, { ...expected, singleUseBootstrap: true }, state);
    assert.equal(replay2.ok, false);
    assert.equal(replay2.code, 'TICKET_REPLAYED');

    // 3. Replace store file atomically while state.storeFilePath is OMITTED -> MUST deny AUTHORITY_STORE_REPLACED
    const replacement = join(dir, 'replacement.sqlite');
    writeFileSync(replacement, 'replaced-sentinel', { mode: 0o600 });
    renameSync(replacement, storePath);
    const repCheck = auth2.verifyTicket(ticket, expected, state);
    assert.equal(repCheck.ok, false);
    assert.equal(repCheck.code, 'AUTHORITY_STORE_REPLACED');

    // 4. Delete store file while state.storeFilePath is OMITTED -> MUST deny AUTHORITY_STORE_MISSING
    unlinkSync(storePath);
    const missCheck = auth2.verifyTicket(ticket, expected, state);
    assert.equal(missCheck.ok, false);
    assert.equal(missCheck.code, 'AUTHORITY_STORE_MISSING');
    auth2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R4-04..R4-07: DurableOrchestrationStore rejects untrusted receipts/overrides/mutable bindings, tracks parent stop uncertainty, and emits Grokbot4-accepted COMPUTE_STOP_HANDOFF_V1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r4-orch-'));
  const dbPath = join(dir, 'orch.sqlite');
  const artPath = join(dir, 'app.js');
  writeFileSync(artPath, 'console.log("doglove");');
  const artSha = createHash('sha256').update('console.log("doglove");').digest('hex');

  try {
    const store = new DurableOrchestrationStore(dbPath);
    store.registerGraph({
      graphId: 'g-1', companyId: 'company-a', projectId: 'project-a', requestId: 'request-a',
      sourceMessageId: 'msg-a', parentRoomId: 'room-parent', parentRunId: 'run-parent',
      authorizationRevision: 2, generation: 1, revision: 2,
    });
    // R4-07: Immutable binding rejects overwrite
    assert.throws(() => store.registerGraph({
      graphId: 'g-1', companyId: 'company-b', projectId: 'project-b', requestId: 'request-b',
      sourceMessageId: 'msg-b', parentRoomId: 'room-b', parentRunId: 'run-b',
      authorizationRevision: 9, generation: 9, revision: 9,
    }), /IMMUTABLE_BINDING_CONFLICT/);

    store.registerDelegationLink({
      callId: 'c-1', graphId: 'g-1', parentRunId: 'run-parent',
      childCompanyId: 'company-a', childRoomId: 'room-child', childRunId: 'run-child',
      taskId: 'task-child', botId: 'dev-backend', turnId: 'turn-child',
    });

    // R4-06: Raw unattested caller receipt rejected; valid executor-signed receipt accepted
    assert.throws(() => store.recordVerifiedArtifact({
      callId: 'c-1', artifactPath: artPath, expectedSha256: artSha,
      executorReceipt: { exitCode: 0, pid: 1234 },
    }), /UNTRUSTED_EXECUTOR_RECEIPT/);

    const signedReceipt = store.signExecutorReceipt({ callId: 'c-1', artifactDigest: artSha, exitCode: 0, runId: 'run-child' });
    const rec = store.recordVerifiedArtifact({ callId: 'c-1', artifactPath: artPath, expectedSha256: artSha, executorReceipt: signedReceipt });
    assert.equal(rec.serverProvenanceVerified, true);

    // R4-07: explicitNative identity override rejected
    const runtime = { executionConsumer: { stop: (a, r, why) => ({ state: 'STOPPED', id: r.orchestrationPlanId, why }) } };
    let parentShouldConfirm = false;
    installDurableNativeStopBridge(runtime, store, {
      async cancelTurn(args) {
        if (args.turn === 'run-parent') return { runId: args.turn, confirmedStopped: parentShouldConfirm };
        return { runId: args.turn, confirmedStopped: true };
      },
    });

    await assert.rejects(
      () => runtime.executionConsumer.stop(
        { tenantId: 'company-a' },
        { tenantId: 'company-a', orchestrationPlanId: 'g-1', workPackageId: 'wp-1' },
        'override test',
        { companyId: 'company-b', revision: 999 }
      ),
      /EXPLICIT_NATIVE_IDENTITY_MISMATCH/
    );

    // R4-05: Parent cancel unconfirmed -> graph progress MUST stay STOP_PENDING (not STOPPED)
    const partialStop = await runtime.executionConsumer.stop(
      { tenantId: 'company-a' },
      { tenantId: 'company-a', orchestrationPlanId: 'g-1', workPackageId: 'wp-1' },
      'parent-uncertain'
    );
    assert.equal(partialStop.confirmedStopped, false);
    assert.equal(partialStop.computeStopHandoff.stopState, 'STOP_PENDING');
    const envPartial = store.buildAuthoritativeProgressEnvelope('g-1');
    const uiPartial = validateWorkerProgressEnvelope(envPartial.items, envPartial.expectedContext);
    assert.equal(uiPartial.phase, 'STOP_PENDING');

    // R4-04: Full confirmed stop emits COMPUTE_STOP_HANDOFF_V1 accepted directly by Grokbot4 ComputeStopHandoffConsumer
    parentShouldConfirm = true;
    const fullStop = await runtime.executionConsumer.stop(
      { tenantId: 'company-a' },
      { tenantId: 'company-a', orchestrationPlanId: 'g-1', workPackageId: 'wp-1' },
      'full-confirmed-stop'
    );
    assert.equal(fullStop.confirmedStopped, true);
    const handoff = fullStop.computeStopHandoff;
    assert.equal(handoff.contract, 'COMPUTE_STOP_HANDOFF_V1');
    assert.equal(handoff.stopState, 'CONFIRMED_NATIVE_CANCELLED');

    const pyCheck = `
import importlib.util, json, sys, tempfile
from pathlib import Path
p = Path("/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/grokbot4/app-vm-r1/lib/compute_stop_handoff.py")
spec = importlib.util.spec_from_file_location("gb4_consumer", p)
m = importlib.util.module_from_spec(spec); sys.modules[spec.name] = m; spec.loader.exec_module(m)
h = json.loads(sys.stdin.read())
expected = m.ExpectedBinding(companyId=h["companyId"], projectId=h["projectId"], requestId=h["requestId"], revision=h["revision"])
calls = []
def stopper(body):
    calls.append(body)
    return {"processReleased": True, "fixtureOnly": True, "detail": "counted port"}
with tempfile.TemporaryDirectory() as d:
    c = m.ComputeStopHandoffConsumer(Path(d)/"c.sqlite", process_stopper=stopper)
    res = c.consume(h, expected)
    print(json.dumps({"decision": res["decision"], "reservationHeld": res["reservationHeld"], "vmQuotaReleased": res["vmQuotaReleased"], "calls": len(calls)}))
`;
    const pyOut = execFileSync('/usr/bin/python3', ['-c', pyCheck], { input: JSON.stringify(handoff), encoding: 'utf8' });
    const consumed = JSON.parse(pyOut.trim());
    assert.equal(consumed.decision, 'PROCESS_RELEASED');
    assert.equal(consumed.reservationHeld, true);
    assert.equal(consumed.vmQuotaReleased, false);
    assert.equal(consumed.calls, 1);

    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R4-10: RemoteTrustedAppAuthority + actual app-server.ts enforce approvedParentOrigin CSP, dl_app_session bootstrap, x-csrf-token write, independent restart persistence, revocation, and cross-tenant denial', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r4-serving-'));
  const authDbPath = join(dir, 'trusted-auth.sqlite');
  const dogDbPath = join(dir, 'dogs.sqlite');
  const build = loadVerifiedBuild(join(import.meta.dirname, 'app-authority-r4/package/generated/doglove-r3'));
  const { companyId, projectId } = build.spec.binding;
  const leaseId = 'lease-r4-serving-1';
  const artifactDigest = build.receipt.artifactDigest;

  const authDb = openSqlite(authDbPath);
  const backingAuth = new FixtureAppAuthority(authDb, { artifactDigest, leaseId });
  const key = randomBytes(32);
  const portable = new PortableAppAuthority({ signingKey: key, pinnedStorePath: authDbPath });
  const sharedSecret = 'internal-r4-secret-key';

  const now = Date.now();
  const state = {
    available: true,
    revokedJtis: new Set(),
    revokedUsers: new Set(),
    activeMemberships: new Map([[`${companyId}:owner-1`, { active: true, revision: 1, role: 'owner' }]]),
    activeLeases: new Map([[leaseId, { companyId, projectId, generation: 1, active: true }]]),
  };

  const authSrv = createTrustedAuthorityService({
    backingAuthority: backingAuth,
    portableAuthority: portable,
    getAuthorityState: () => state,
    expectedBinding: { companyId, projectId, leaseId, processGeneration: 1 },
    issueSessionForClaims: (claims) => {
      const issued = backingAuth.issue({
        companyId: claims.companyId, projectId: claims.projectId, subjectId: claims.userId,
        principalKind: 'verified_registered_person', scope: ['dog:read', 'dog:write'],
        ttlSeconds: 300, artifactDigest, leaseId,
      });
      return { token: issued.token, expiresAt: issued.expiresAt };
    },
    internalSharedSecret: sharedSecret,
  });
  await new Promise((r) => authSrv.listen(0, '127.0.0.1', r));
  const authPort = authSrv.address().port;

  const approvedParent = 'https://starlidigital.ro';
  const dogDb1 = openSqlite(dogDbPath);
  migrateSqlite(dogDb1);
  const remoteAuth = new RemoteTrustedAppAuthority({ baseUrl: `http://127.0.0.1:${authPort}`, sharedSecret });

  let appSrv1 = createAppServer({
    build, store: new SqliteDogStore(dogDb1, 2), authority: remoteAuth,
    allowedOrigins: [], executionClass: 'COMBINED_CANDIDATE', leaseId, startGeneration: 1,
    approvedParentOrigin: approvedParent, isLoopbackTest: true,
  });
  await new Promise((r) => appSrv1.listen(0, '127.0.0.1', r));
  const port1 = appSrv1.address().port;
  const origin1 = `http://127.0.0.1:${port1}`;
  appSrv1.closeAllConnections?.(); await new Promise((r) => appSrv1.close(r));
  appSrv1 = createAppServer({
    build, store: new SqliteDogStore(dogDb1, 2), authority: remoteAuth,
    allowedOrigins: [origin1], executionClass: 'COMBINED_CANDIDATE', leaseId, startGeneration: 1,
    approvedParentOrigin: approvedParent, isLoopbackTest: true,
  });
  await new Promise((r) => appSrv1.listen(port1, '127.0.0.1', r));

  try {
    // 1. Unapproved parent denied 403; approved parent gets 200 + CSP frame-ancestors
    const badParent = await fetch(`${origin1}/`, { headers: { Referer: 'https://evil.tld/x' } });
    assert.equal(badParent.status, 403);
    const goodParent = await fetch(`${origin1}/`, { headers: { Referer: `${approvedParent}/app` } });
    assert.equal(goodParent.status, 200);
    assert.match(goodParent.headers.get('content-security-policy') || '', /frame-ancestors https:\/\/starlidigital\.ro/);

    // 2. Bootstrap single-use ticket -> receives HttpOnly dl_app_session cookie; replay fails 403
    const ticket = portable.issueTicket({
      companyId, projectId, userId: 'owner-1', leaseId, processGeneration: 1,
      authorityRevision: 1, issuedAt: now - 1000, expiresAt: now + 60000,
    });
    const boot = await fetch(`${origin1}/api/v1/app/session/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: `${approvedParent}/app` },
      body: JSON.stringify({ ticket }),
    });
    assert.equal(boot.status, 200);
    const setCookie = boot.headers.get('set-cookie') || '';
    assert.match(setCookie, /dl_app_session=/);
    assert.match(setCookie, /HttpOnly/);
    const sessionCookie = setCookie.split(';')[0];

    const bootReplay = await fetch(`${origin1}/api/v1/app/session/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: `${approvedParent}/app` },
      body: JSON.stringify({ ticket }),
    });
    assert.equal(bootReplay.status, 403);

    // 3. Fetch CSRF token + POST /api/v1/customer/dogs with dl_app_session & x-csrf-token
    const csrfRes = await fetch(`${origin1}/api/v1/customer/csrf`, { headers: { Cookie: sessionCookie } });
    assert.equal(csrfRes.status, 200);
    const { csrfToken } = await csrfRes.json();
    const postRes = await fetch(`${origin1}/api/v1/customer/dogs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin1,
        Cookie: sessionCookie,
        'x-csrf-token': csrfToken,
        'idempotency-key': 'r4-dog-save-1',
      },
      body: JSON.stringify({ name: 'Biscuit', breed: 'Beagle', ageYears: 3, notes: 'Persisted across restart' }),
    });
    assert.equal(postRes.status, 201);

    // 4. Independent restart of app-server.ts -> persisted GET returns Biscuit
    appSrv1.closeAllConnections?.(); await new Promise((r) => appSrv1.close(r));
    dogDb1.close();

    const dogDb2 = openSqlite(dogDbPath);
    const appSrv2 = createAppServer({
      build, store: new SqliteDogStore(dogDb2, 2), authority: remoteAuth,
      allowedOrigins: [origin1], executionClass: 'COMBINED_CANDIDATE', leaseId, startGeneration: 2,
      approvedParentOrigin: approvedParent, isLoopbackTest: true,
    });
    await new Promise((r) => appSrv2.listen(0, '127.0.0.1', r));
    const origin2 = `http://127.0.0.1:${appSrv2.address().port}`;
    try {
      const getAfterRestart = await fetch(`${origin2}/api/v1/customer/dogs`, { headers: { Cookie: sessionCookie } });
      assert.equal(getAfterRestart.status, 200);
      const listBody = await getAfterRestart.json();
      assert.equal(listBody.dogs.length, 1);
      assert.equal(listBody.dogs[0].name, 'Biscuit');

      // 5. Cross-tenant session denied 403
      const otherSession = backingAuth.issue({
        companyId: 'other-company-999', projectId: 'other-proj', subjectId: 'other-user',
        principalKind: 'verified_registered_person', scope: ['dog:read', 'dog:write'],
        ttlSeconds: 300, artifactDigest, leaseId,
      });
      const crossGet = await fetch(`${origin2}/api/v1/customer/dogs`, {
        headers: { Cookie: `dl_app_session=${otherSession.token}` },
      });
      assert.equal(crossGet.status, 403);

      // 6. Revoke membership on trusted host -> immediately denies 403
      backingAuth.revoke(companyId, projectId, 'owner-1');
      const afterRevoke = await fetch(`${origin2}/api/v1/customer/dogs`, { headers: { Cookie: sessionCookie } });
      assert.equal(afterRevoke.status, 403);
    } finally {
      appSrv2.closeAllConnections?.(); await new Promise((r) => appSrv2.close(r));
      dogDb2.close();
    }
  } finally {
    try { appSrv1.closeAllConnections?.(); appSrv1.close(); } catch {}
    try { dogDb1.close(); } catch {}
    authSrv.closeAllConnections?.(); await new Promise((r) => authSrv.close(r));
    portable.close();
    authDb.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
