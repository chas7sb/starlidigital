import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { DurableOrchestrationStore, installDurableNativeStopBridge } from '../durable-orchestration-stop.mjs';
import { TrustedExecutorReceiptIssuer } from '../executor-receipt-issuer.mjs';
import { CanonicalOrchestrationRegistrationAdapter } from '../canonical-registration-adapter.mjs';
import { CanonicalAgencyReceiptAdapter } from '../canonical-agency-receipt-adapter.mjs';
import { createOrchestrationApiHandler } from '../orchestration-progress-api.mjs';
import { MachineryRunExecutionDriver } from '../machinery-run/execution-driver.ts';
import { validateWorkerProgressEnvelope } from '../ui/worker-task-progress.ts';
import { actorScope } from '/srv/starlidigital/mcp-workspace/server/src/machinery-run/policy.ts';

const GROKBOT4_HANDOFF_PY =
  '/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/grokbot4/app-vm-r1/lib/compute_stop_handoff.py';
const PYTHON_BIN = '/opt/starlidigital/webui-runtime/bin/python3';
const OUTPUT_JSON = process.env.STARLI_TEST_OUTPUT_JSON || '';

const summary = {
  taskId: 'GGB1-GEMINI1-ORCHESTRATION-R6',
  executedAt: new Date().toISOString(),
  executionClass: 'ACTUAL_PATCHED_MODULES_AND_CANONICAL_ADAPTERS_WITH_DISPOSABLE_STATE',
  note: 'Proves R6-STOP-CONFIRMATION (all 5 cases including logical-only/uncertain/undefined), R6-LATE-RECEIPT (stop/replay/revocation/restart + audit), R6-API-ACTOR (real upstream actorScope + MachineryRunService auth), R6-API-RUN (canonical machineryRunId + 409 RUN_ID_MISMATCH), and R4-03/R4-07-NATIVE (canonical registration & Agency receipt adapters). No live production, VM, or external LLM calls.',
  tests: {},
};

function makeCanonicalServices({ companyId = 'company-a', machineryRunId = 'mach-run-a', graphId = 'plan-a', workPackageId = 'task-a', agencyReceiptId = 'ag-rcpt-1', executionRequestId = 'ag-req-1', outputDigest = null, agencyExecutionClass = 'NATIVE_NONPRODUCTION' } = {}) {
  const state = {
    planStatus: 'ACTIVE',
    pkgStatus: 'SUCCEEDED',
    runState: 'RUNNING',
    ownedRooms: new Set(['room-boss-a', 'room-dev-a', 'room-qa-a']),
  };

  const machineryRuns = {
    getRun(actor, runId) {
      const scope = actorScope(actor);
      if (scope.tenantId !== companyId) {
        throw new Error(`Unauthorized tenant ${scope.tenantId}`);
      }
      if (runId !== machineryRunId) {
        throw new Error(`Unknown machinery run ${runId}`);
      }
      return {
        id: machineryRunId,
        tenantId: companyId,
        ownerId: scope.ownerId,
        workspaceId: scope.workspaceId,
        selections: [{ orchestrationPlanId: graphId, workPackageIds: [workPackageId] }],
      };
    },
    refresh(actor, runId) {
      const run = this.getRun(actor, runId);
      return {
        id: run.id,
        tenantId: run.tenantId,
        state: state.runState,
        globalPause: { paused: false },
        work: [],
      };
    },
  };

  const orchestrator = {
    getPlan(orchActor, planId) {
      if ((orchActor.workspaceTenantId || orchActor.tenantId) !== companyId || planId !== graphId) {
        throw new Error(`Plan not accessible: ${planId}`);
      }
      return {
        id: graphId,
        tenantId: companyId,
        revision: 1,
        status: state.planStatus,
        workPackages: [
          {
            id: workPackageId,
            executionMode: 'EXECUTABLE',
            status: state.pkgStatus,
            executionRequestId,
            lastExecutionReceiptId: agencyReceiptId,
          },
        ],
      };
    },
  };

  const roomDirectory = {
    ownsRoom(tenantId, roomId) {
      return tenantId === companyId && state.ownedRooms.has(roomId);
    },
  };

  const agencyReceiptReader = {
    getReceipt(tenantId, receiptId) {
      if (tenantId !== companyId || receiptId !== agencyReceiptId) return null;
      return {
        id: agencyReceiptId,
        executionRequestId,
        tenantId: companyId,
        status: 'SUCCEEDED',
        executionClass: agencyExecutionClass,
        ...(outputDigest ? { outputDigest } : {}),
      };
    },
  };

  return { state, machineryRuns, orchestrator, roomDirectory, agencyReceiptReader };
}

test('T1 (R6-STOP-CONFIRMATION): Fail-closed Stop across explicit false/true, logical-only CanonicalStarliExecutionConsumer, UNCERTAIN, undefined, and Grokbot4 handoff', async () => {
  const actor = { userId: 'user-a', workspaceTenantId: 'company-a', role: 'member' };

  async function runStopCase(executionStopImpl, refreshState = 'STOPPED') {
    const svc = makeCanonicalServices();
    svc.state.runState = refreshState;
    let calls = 0;
    let settled = false;
    const consumer = {
      stop: async (...args) => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        const res = await executionStopImpl(...args);
        settled = true;
        return res;
      },
      resume: async () => ({ state: 'RUNNING' }),
      executeReady: async () => ({ state: 'RUNNING' }),
    };
    const driver = new MachineryRunExecutionDriver(svc.machineryRuns, svc.orchestrator, consumer);
    const result = await driver.stop(actor, 'mach-run-a', 'Operator Stop');
    assert.equal(settled, true, 'driver.stop MUST await async execution.stop before returning');
    assert.equal(calls, 1);
    return result;
  }

  // 1. explicit_unconfirmed
  const rExplicitFalse = await runStopCase(async () => ({
    state: 'STOP_PENDING',
    stopState: 'STOP_PENDING',
    confirmedStopped: false,
  }));
  assert.equal(rExplicitFalse.disposition, 'STOP_PENDING');
  assert.equal(rExplicitFalse.confirmedStopped, false);

  // 2. explicit_confirmed
  const rExplicitTrue = await runStopCase(async () => ({
    state: 'STOPPED',
    stopState: 'CONFIRMED_NATIVE_CANCELLED',
    confirmedStopped: true,
  }));
  assert.equal(rExplicitTrue.disposition, 'TERMINAL');
  assert.equal(rExplicitTrue.confirmedStopped, true);

  // 3. logical_stop_without_confirmation (exact CanonicalStarliExecutionConsumer.stop shape)
  const rLogicalOnly = await runStopCase(async () => ({
    state: 'STOPPED',
    orchestrationPlanId: 'plan-a',
    workPackageId: 'task-a',
    detail: 'Canonical orchestration stop is durable; late completion cannot revive this work.',
  }));
  assert.equal(rLogicalOnly.disposition, 'STOP_PENDING');
  assert.equal(rLogicalOnly.confirmedStopped, false);

  // 4. uncertain_without_confirmation
  const rUncertain = await runStopCase(async () => ({
    state: 'UNCERTAIN',
    detail: 'Execution ownership/outcome is uncertain.',
  }));
  assert.equal(rUncertain.disposition, 'UNCERTAIN');
  assert.equal(rUncertain.confirmedStopped, false);

  // 5. undefined_outcome
  const rUndefined = await runStopCase(async () => undefined);
  assert.equal(rUndefined.disposition, 'STOP_PENDING');
  assert.equal(rUndefined.confirmedStopped, false);

  // 6. Full bridged Stop + Grokbot4 ComputeStopHandoffConsumer check
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starli-r6-t1-'));
  const dbPath = path.join(tmpDir, 'orch.sqlite');
  const key = Buffer.from('r6-verify-key-t1-0123456789abcdef0123456789abcdef', 'utf8');
  const store = new DurableOrchestrationStore(dbPath, { executorVerifyKey: key });
  const svc = makeCanonicalServices();
  const regAdapter = new CanonicalOrchestrationRegistrationAdapter({
    machineryRuns: svc.machineryRuns,
    orchestrator: svc.orchestrator,
    roomDirectory: svc.roomDirectory,
  });

  store.registerGraph(
    {
      graphId: 'plan-a',
      machineryRunId: 'mach-run-a',
      companyId: 'company-a',
      projectId: 'proj-a',
      sourceMessageId: 'msg-1',
      requestId: 'req-1',
      parentRunId: 'native-parent-a',
      parentRoomId: 'room-boss-a',
      parentTurnId: 'turn-parent-a',
      authorizationRevision: 1,
      generation: 1,
      revision: 1,
    },
    { authorityVerifier: regAdapter, actor }
  );
  store.registerDelegationLink(
    {
      callId: 'call-a',
      graphId: 'plan-a',
      childCompanyId: 'company-a',
      parentRunId: 'native-parent-a',
      childRunId: 'native-child-a',
      childRoomId: 'room-dev-a',
      taskId: 'task-a',
      botId: 'bot-dev-a',
      turnId: 'turn-child-a',
      executionClass: 'NATIVE_NONPRODUCTION',
    },
    { authorityVerifier: regAdapter, actor }
  );

  const executionConsumer = {
    stop: () => {
      svc.state.runState = 'STOPPED';
      return { state: 'STOPPED' };
    },
    resume: async () => ({ state: 'RUNNING' }),
    executeReady: async () => ({ state: 'RUNNING' }),
  };
  installDurableNativeStopBridge({ executionConsumer }, store, {
    cancelTurn: async () => ({ confirmedStopped: true }),
  });
  const driver = new MachineryRunExecutionDriver(svc.machineryRuns, svc.orchestrator, executionConsumer);
  const bridgedRes = await driver.stop(actor, 'mach-run-a', 'Stop bridged');
  assert.equal(bridgedRes.disposition, 'TERMINAL');
  assert.equal(bridgedRes.confirmedStopped, true);

  const pyScript = `
import json, sys, os, tempfile, importlib.util
spec = importlib.util.spec_from_file_location("compute_stop_handoff", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
sys.modules["compute_stop_handoff"] = mod
spec.loader.exec_module(mod)
payload = json.loads(sys.argv[2])
with tempfile.TemporaryDirectory() as td:
    consumer = mod.ComputeStopHandoffConsumer(os.path.join(td, "g4.sqlite"))
    expected = mod.ExpectedBinding(
        companyId=payload["companyId"],
        projectId=payload["projectId"],
        requestId=payload["requestId"],
        revision=payload["revision"],
    )
    res = consumer.consume(payload, expected)
    print(json.dumps({
      "decision": res.get("decision"),
      "reservationHeld": res.get("reservationHeld"),
      "vmQuotaReleased": res.get("vmQuotaReleased"),
    }))
`;
  const g4Out = JSON.parse(
    execFileSync(PYTHON_BIN, ['-c', pyScript, GROKBOT4_HANDOFF_PY, JSON.stringify(bridgedRes.computeStopHandoff)], {
      encoding: 'utf8',
    }).trim()
  );
  assert.equal(g4Out.decision, 'PROCESS_RELEASED');
  assert.equal(g4Out.reservationHeld, true);
  assert.equal(g4Out.vmQuotaReleased, false);

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  summary.tests.T1_stop_confirmation = {
    passed: true,
    explicitFalse: { disposition: rExplicitFalse.disposition, confirmedStopped: rExplicitFalse.confirmedStopped },
    explicitTrue: { disposition: rExplicitTrue.disposition, confirmedStopped: rExplicitTrue.confirmedStopped },
    logicalOnly: { disposition: rLogicalOnly.disposition, confirmedStopped: rLogicalOnly.confirmedStopped },
    uncertain: { disposition: rUncertain.disposition, confirmedStopped: rUncertain.confirmedStopped },
    undefinedOutcome: { disposition: rUndefined.disposition, confirmedStopped: rUndefined.confirmedStopped },
    grokbot4: g4Out,
  };
});

test('T2 (R6-LATE-RECEIPT): Atomic lifecycle/revision/generation fence blocks late receipt replay after Stop & revocation, preserves audit, survives restart', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starli-r6-t2-'));
  const artifactRoot = path.join(tmpDir, 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const artifactPath = path.join(artifactRoot, 'result.txt');
  fs.writeFileSync(artifactPath, 'verified-canonical-output\n', 'utf8');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');

  const dbPath = path.join(tmpDir, 'orch.sqlite');
  const key = Buffer.from('r6-verify-key-t2-0123456789abcdef0123456789abcdef', 'utf8');
  const store = new DurableOrchestrationStore(dbPath, { executorVerifyKey: key });
  const issuer = new TrustedExecutorReceiptIssuer({ signingKey: key });
  const actor = { userId: 'user-a', workspaceTenantId: 'company-a', role: 'member' };
  const svc = makeCanonicalServices({ outputDigest: sha });
  const regAdapter = new CanonicalOrchestrationRegistrationAdapter({
    machineryRuns: svc.machineryRuns,
    orchestrator: svc.orchestrator,
    roomDirectory: svc.roomDirectory,
  });
  const receiptAdapter = new CanonicalAgencyReceiptAdapter({
    issuer,
    orchestrator: svc.orchestrator,
    agencyReceiptReader: svc.agencyReceiptReader,
    artifactRootDir: artifactRoot,
  });

  const graph = store.registerGraph(
    {
      graphId: 'plan-a',
      machineryRunId: 'mach-run-a',
      companyId: 'company-a',
      projectId: 'proj-a',
      sourceMessageId: 'msg-t2',
      requestId: 'req-t2',
      parentRunId: 'native-parent-a',
      parentRoomId: 'room-boss-a',
      parentTurnId: 'turn-parent-a',
      authorizationRevision: 3,
      generation: 1,
      revision: 1,
    },
    { authorityVerifier: regAdapter, actor }
  );
  const link = store.registerDelegationLink(
    {
      callId: 'call-t2',
      graphId: 'plan-a',
      childCompanyId: 'company-a',
      parentRunId: 'native-parent-a',
      childRunId: 'native-child-a',
      childRoomId: 'room-dev-a',
      taskId: 'task-a',
      botId: 'bot-dev-a',
      turnId: 'turn-child-a',
      executionClass: 'NATIVE_NONPRODUCTION',
    },
    { authorityVerifier: regAdapter, actor }
  );

  // Mint valid pre-Stop receipt via CanonicalAgencyReceiptAdapter
  const preStopReceipt = receiptAdapter.issueForCompletedWorkPackage({
    actor,
    graph,
    link,
    artifactPath,
    executionClass: 'NATIVE_NONPRODUCTION',
  });

  // Confirm Stop via bridged driver
  const executionConsumer = {
    stop: () => {
      svc.state.runState = 'STOPPED';
      return { state: 'STOPPED' };
    },
    resume: async () => ({ state: 'RUNNING' }),
    executeReady: async () => ({ state: 'RUNNING' }),
  };
  installDurableNativeStopBridge({ executionConsumer }, store, {
    cancelTurn: async () => ({ confirmedStopped: true }),
  });
  const driver = new MachineryRunExecutionDriver(svc.machineryRuns, svc.orchestrator, executionConsumer);
  const stopRes = await driver.stop(actor, 'mach-run-a', 'Stop before late receipt');
  assert.equal(stopRes.confirmedStopped, true);

  const envAfterStop = store.buildAuthoritativeProgressEnvelope('plan-a');
  assert.equal(validateWorkerProgressEnvelope(envAfterStop.items, envAfterStop.expectedContext).phase, 'STOPPED');

  // Replay the valid pre-Stop receipt -> MUST be fenced and audited, NEVER revert to TERMINAL_VERIFIED
  const lateRes = store.recordVerifiedArtifact({
    callId: 'call-t2',
    artifactPath,
    expectedSha256: sha,
    executorReceipt: preStopReceipt,
  });
  assert.equal(lateRes.fenced, true);
  assert.equal(lateRes.audited, true);
  assert.equal(lateRes.serverProvenanceVerified, false);
  assert.match(lateRes.fenceReason, /GRAPH_LIFECYCLE_FENCED:STOPPED/);

  const envAfterReplay = store.buildAuthoritativeProgressEnvelope('plan-a');
  assert.equal(validateWorkerProgressEnvelope(envAfterReplay.items, envAfterReplay.expectedContext).phase, 'STOPPED');
  assert.equal(store.listLateArtifactAudits('plan-a').length, 1);

  // Restart (close & reopen DB) and verify STOPPED + audit persist and second replay is still fenced
  store.close();
  const reopened = new DurableOrchestrationStore(dbPath, { executorVerifyKey: key });
  const envAfterRestart = reopened.buildAuthoritativeProgressEnvelope('plan-a');
  assert.equal(validateWorkerProgressEnvelope(envAfterRestart.items, envAfterRestart.expectedContext).phase, 'STOPPED');
  assert.equal(reopened.listLateArtifactAudits('plan-a').length, 1);

  const lateRes2 = reopened.recordVerifiedArtifact({
    callId: 'call-t2',
    artifactPath,
    expectedSha256: sha,
    executorReceipt: preStopReceipt,
  });
  assert.equal(lateRes2.fenced, true);
  assert.equal(reopened.listLateArtifactAudits('plan-a').length, 2);

  // Also verify revocation fence
  reopened.revokeGraph('plan-a');
  const envRevoked = reopened.buildAuthoritativeProgressEnvelope('plan-a');
  assert.equal(validateWorkerProgressEnvelope(envRevoked.items, envRevoked.expectedContext).phase, 'REVOKED');

  reopened.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  summary.tests.T2_late_receipt_fence = {
    passed: true,
    fenceReason: lateRes.fenceReason,
    phaseAfterStop: 'STOPPED',
    phaseAfterReplay: 'STOPPED',
    phaseAfterRestart: 'STOPPED',
    phaseAfterRevoke: 'REVOKED',
    auditEntriesPersisted: 2,
  };
});

test('T3 (R6-API-ACTOR & R6-API-RUN): Real upstream actorScope preserves workspaceTenantId/role, enforces MachineryRunService auth, rejects body.runId mismatch with 409 and 0 driver calls', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starli-r6-t3-'));
  const dbPath = path.join(tmpDir, 'orch.sqlite');
  const key = Buffer.from('r6-verify-key-t3-0123456789abcdef0123456789abcdef', 'utf8');
  const store = new DurableOrchestrationStore(dbPath, { executorVerifyKey: key });
  const svc = makeCanonicalServices({ machineryRunId: 'mach-run-a', graphId: 'plan-a' });
  const regAdapter = new CanonicalOrchestrationRegistrationAdapter({
    machineryRuns: svc.machineryRuns,
    orchestrator: svc.orchestrator,
    roomDirectory: svc.roomDirectory,
  });
  const ownerActor = { userId: 'user-a', workspaceTenantId: 'company-a', role: 'member' };

  store.registerGraph(
    {
      graphId: 'plan-a',
      machineryRunId: 'mach-run-a',
      companyId: 'company-a',
      projectId: 'proj-a',
      sourceMessageId: 'msg-t3',
      requestId: 'req-t3',
      parentRunId: 'native-parent-a',
      parentRoomId: 'room-boss-a',
      parentTurnId: 'turn-parent-a',
      authorizationRevision: 1,
      generation: 1,
      revision: 1,
    },
    { authorityVerifier: regAdapter, actor: ownerActor }
  );

  const capturedStopCalls = [];
  const countedDriver = {
    inspect: (actor, runId) => svc.machineryRuns.refresh(actor, runId),
    stop: async (actor, runId, reason) => {
      capturedStopCalls.push({ actor, runId, reason, scope: actorScope(actor) });
      svc.state.runState = 'STOPPED';
      return {
        disposition: 'TERMINAL',
        confirmedStopped: true,
        stopOutcomes: [{ confirmedStopped: true }],
      };
    },
  };

  const handler = createOrchestrationApiHandler({
    store,
    machineryDriver: countedDriver,
    machineryService: svc.machineryRuns,
    resolveActor: (req) => {
      const mode = req.headers['x-test-actor'];
      if (mode === 'member-a') {
        return { companyId: 'company-a', userId: 'user-a', workspaceTenantId: 'company-a', role: 'member' };
      }
      if (mode === 'missing-workspace') {
        return { userId: 'user-a', role: 'member' };
      }
      if (mode === 'tenant-b') {
        return { companyId: 'company-b', userId: 'user-b', workspaceTenantId: 'company-b', role: 'member' };
      }
      return null;
    },
  });

  const server = http.createServer(async (req, res) => {
    const handled = await handler(req, res);
    if (!handled) {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated -> 401
    const r401 = await fetch(`${baseUrl}/api/v1/starli/orchestration/graphs/plan-a/progress`);
    assert.equal(r401.status, 401);

    // 2. Missing workspaceTenantId -> 401 (no defaults fabricated)
    const rNoWs = await fetch(`${baseUrl}/api/v1/starli/orchestration/graphs/plan-a/progress`, {
      headers: { 'x-test-actor': 'missing-workspace' },
    });
    assert.equal(rNoWs.status, 401);

    // 3. Cross-tenant -> 403, 0 driver calls
    const r403 = await fetch(`${baseUrl}/api/v1/starli/orchestration/graphs/plan-a/stop`, {
      method: 'POST',
      headers: { 'x-test-actor': 'tenant-b', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(r403.status, 403);
    assert.equal(capturedStopCalls.length, 0);

    // 4. R6-API-RUN: Conflicting body.runId -> 409 RUN_ID_MISMATCH, 0 driver calls!
    const r409 = await fetch(`${baseUrl}/api/v1/starli/orchestration/graphs/plan-a/stop`, {
      method: 'POST',
      headers: { 'x-test-actor': 'member-a', 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'unrelated-machinery-run' }),
    });
    assert.equal(r409.status, 409);
    const body409 = await r409.json();
    assert.equal(body409.errorCode, 'RUN_ID_MISMATCH');
    assert.equal(capturedStopCalls.length, 0, 'Conflicting body.runId must reject BEFORE invoking driver');

    // 5. Valid POST /stop -> forwards exact MachineryRunActor (member, workspaceTenantId=company-a) and canonical mach-run-a!
    const r200 = await fetch(`${baseUrl}/api/v1/starli/orchestration/graphs/plan-a/stop`, {
      method: 'POST',
      headers: { 'x-test-actor': 'member-a', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'stop-valid' }),
    });
    assert.equal(r200.status, 200);
    assert.equal(capturedStopCalls.length, 1);
    const call = capturedStopCalls[0];
    assert.deepEqual(call.actor, { userId: 'user-a', workspaceTenantId: 'company-a', role: 'member' });
    assert.deepEqual(call.scope, { ownerId: 'user-a', tenantId: 'company-a', workspaceId: 'company-a' });
    assert.equal(call.runId, 'mach-run-a');

    summary.tests.T3_api_actor_and_run_binding = {
      passed: true,
      unauthStatus: r401.status,
      missingWorkspaceStatus: rNoWs.status,
      crossTenantStatus: r403.status,
      conflictingBodyRunIdStatus: r409.status,
      conflictingBodyDriverCalls: 0,
      forwardedActor: call.actor,
      actualNativeScope: call.scope,
      forwardedRunId: call.runId,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('T4 (R4-03 / R4-07-NATIVE): Canonical registration & Agency receipt adapters deny omitted authority, unscoped paths, and FIXTURE->NATIVE promotion', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starli-r6-t4-'));
  const artifactRoot = path.join(tmpDir, 'scoped');
  const outsideDir = path.join(tmpDir, 'outside');
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  const scopedFile = path.join(artifactRoot, 'out.txt');
  const outsideFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(scopedFile, 'scoped-payload\n', 'utf8');
  fs.writeFileSync(outsideFile, 'outside-secret\n', 'utf8');
  const scopedSha = crypto.createHash('sha256').update(fs.readFileSync(scopedFile)).digest('hex');

  const dbPath = path.join(tmpDir, 'orch.sqlite');
  const key = Buffer.from('r6-verify-key-t4-0123456789abcdef0123456789abcdef', 'utf8');
  const store = new DurableOrchestrationStore(dbPath, { executorVerifyKey: key });
  const issuer = new TrustedExecutorReceiptIssuer({ signingKey: key });
  const actor = { userId: 'user-a', workspaceTenantId: 'company-a', role: 'member' };

  // 1. Omitted authorityVerifier MUST deny graph registration BEFORE INSERT
  assert.throws(
    () =>
      store.registerGraph({
        graphId: 'plan-no-auth',
        machineryRunId: 'mach-run-a',
        companyId: 'company-a',
        projectId: 'proj-a',
        sourceMessageId: 'msg-1',
        requestId: 'req-1',
        parentRunId: 'native-parent-a',
        parentRoomId: 'room-boss-a',
        parentTurnId: 'turn-1',
        authorizationRevision: 1,
        generation: 1,
        revision: 1,
      }),
    (err) => err?.code === 'CANONICAL_AUTHORITY_REQUIRED'
  );
  assert.equal(store.getGraph('plan-no-auth'), null);

  // 2. Canonical adapter verifies valid graph & rejects unowned room / missing package BEFORE INSERT
  const svc = makeCanonicalServices({ outputDigest: scopedSha });
  const regAdapter = new CanonicalOrchestrationRegistrationAdapter({
    machineryRuns: svc.machineryRuns,
    orchestrator: svc.orchestrator,
    roomDirectory: svc.roomDirectory,
  });
  const graph = store.registerGraph(
    {
      graphId: 'plan-a',
      machineryRunId: 'mach-run-a',
      companyId: 'company-a',
      projectId: 'proj-a',
      sourceMessageId: 'msg-t4',
      requestId: 'req-t4',
      parentRunId: 'native-parent-a',
      parentRoomId: 'room-boss-a',
      parentTurnId: 'turn-parent-a',
      authorizationRevision: 1,
      generation: 1,
      revision: 1,
    },
    { authorityVerifier: regAdapter, actor }
  );

  // Omitted authorityVerifier on NATIVE link -> denied BEFORE INSERT
  assert.throws(
    () =>
      store.registerDelegationLink({
        callId: 'call-no-auth',
        graphId: 'plan-a',
        childCompanyId: 'company-a',
        parentRunId: 'native-parent-a',
        childRunId: 'child-1',
        childRoomId: 'room-dev-a',
        taskId: 'task-a',
        botId: 'bot-1',
        turnId: 'turn-1',
        executionClass: 'NATIVE_NONPRODUCTION',
      }),
    (err) => err?.code === 'CANONICAL_AUTHORITY_REQUIRED'
  );

  // Unowned child room -> denied BEFORE INSERT
  assert.throws(
    () =>
      store.registerDelegationLink(
        {
          callId: 'call-bad-room',
          graphId: 'plan-a',
          childCompanyId: 'company-a',
          parentRunId: 'native-parent-a',
          childRunId: 'child-1',
          childRoomId: 'room-foreign-unowned',
          taskId: 'task-a',
          botId: 'bot-1',
          turnId: 'turn-1',
          executionClass: 'NATIVE_NONPRODUCTION',
        },
        { authorityVerifier: regAdapter, actor }
      ),
    (err) => err?.code === 'CHILD_ROOM_NOT_OWNED_BY_TENANT'
  );

  // Missing canonical work package -> denied BEFORE INSERT
  assert.throws(
    () =>
      store.registerDelegationLink(
        {
          callId: 'call-bad-pkg',
          graphId: 'plan-a',
          childCompanyId: 'company-a',
          parentRunId: 'native-parent-a',
          childRunId: 'child-1',
          childRoomId: 'room-dev-a',
          taskId: 'invented-task-id',
          botId: 'bot-1',
          turnId: 'turn-1',
          executionClass: 'NATIVE_NONPRODUCTION',
        },
        { authorityVerifier: regAdapter, actor }
      ),
    (err) => err?.code === 'CANONICAL_WORK_PACKAGE_NOT_FOUND'
  );
  assert.equal(store.listLinksForGraph('plan-a').length, 0);

  // Register valid canonical link
  const link = store.registerDelegationLink(
    {
      callId: 'call-valid',
      graphId: 'plan-a',
      childCompanyId: 'company-a',
      parentRunId: 'native-parent-a',
      childRunId: 'child-1',
      childRoomId: 'room-dev-a',
      taskId: 'task-a',
      botId: 'bot-1',
      turnId: 'turn-1',
      executionClass: 'NATIVE_NONPRODUCTION',
    },
    { authorityVerifier: regAdapter, actor }
  );

  // 3. Fixture issuer MUST NOT allow NATIVE_NONPRODUCTION
  assert.throws(
    () =>
      issuer.issueFixtureReceipt({
        graphId: 'plan-a',
        companyId: 'company-a',
        projectId: 'proj-a',
        requestId: 'req-t4',
        roomId: 'room-dev-a',
        callId: 'call-valid',
        taskId: 'task-a',
        childRunId: 'child-1',
        authorizationRevision: 1,
        generation: 1,
        artifactRootDir: artifactRoot,
        artifactPath: scopedFile,
        executionClass: 'NATIVE_NONPRODUCTION',
      }),
    (err) => err?.code === 'FIXTURE_ISSUER_CANNOT_MINT_NATIVE_RECEIPT'
  );

  // 4. CanonicalAgencyReceiptAdapter rejects outside-root file
  const receiptAdapter = new CanonicalAgencyReceiptAdapter({
    issuer,
    orchestrator: svc.orchestrator,
    agencyReceiptReader: svc.agencyReceiptReader,
    artifactRootDir: artifactRoot,
  });
  assert.throws(
    () =>
      receiptAdapter.issueForCompletedWorkPackage({
        actor,
        graph,
        link,
        artifactPath: outsideFile,
        executionClass: 'NATIVE_NONPRODUCTION',
      }),
    (err) => err?.code === 'ARTIFACT_OUTSIDE_SCOPED_ROOT'
  );

  // 5. FIXTURE agency receipt cannot be promoted to NATIVE_NONPRODUCTION
  const fixSvc = makeCanonicalServices({ outputDigest: scopedSha, agencyExecutionClass: 'FIXTURE' });
  const fixAdapter = new CanonicalAgencyReceiptAdapter({
    issuer,
    orchestrator: fixSvc.orchestrator,
    agencyReceiptReader: fixSvc.agencyReceiptReader,
    artifactRootDir: artifactRoot,
  });
  assert.throws(
    () =>
      fixAdapter.issueForCompletedWorkPackage({
        actor,
        graph,
        link,
        artifactPath: scopedFile,
        executionClass: 'NATIVE_NONPRODUCTION',
      }),
    (err) => err?.code === 'FIXTURE_CANNOT_BE_PROMOTED_TO_NATIVE'
  );

  // 6. Genuine canonical Agency receipt + scoped file succeeds -> TERMINAL_VERIFIED
  const nativeReceipt = receiptAdapter.issueForCompletedWorkPackage({
    actor,
    graph,
    link,
    artifactPath: scopedFile,
    executionClass: 'NATIVE_NONPRODUCTION',
  });
  const adm = store.recordVerifiedArtifact({
    callId: 'call-valid',
    artifactPath: scopedFile,
    expectedSha256: scopedSha,
    executorReceipt: nativeReceipt,
  });
  assert.equal(adm.serverProvenanceVerified, true);
  const env = store.buildAuthoritativeProgressEnvelope('plan-a');
  assert.equal(validateWorkerProgressEnvelope(env.items, env.expectedContext).phase, 'TERMINAL_VERIFIED');

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  summary.tests.T4_canonical_registration_and_agency_receipt_adapters = {
    passed: true,
    deniedCodes: [
      'CANONICAL_AUTHORITY_REQUIRED',
      'CHILD_ROOM_NOT_OWNED_BY_TENANT',
      'CANONICAL_WORK_PACKAGE_NOT_FOUND',
      'FIXTURE_ISSUER_CANNOT_MINT_NATIVE_RECEIPT',
      'ARTIFACT_OUTSIDE_SCOPED_ROOT',
      'FIXTURE_CANNOT_BE_PROMOTED_TO_NATIVE',
    ],
    canonicalNativeUiPhase: 'TERMINAL_VERIFIED',
  };
});

test.after(() => {
  if (OUTPUT_JSON) {
    fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  }
});
