import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableOrchestrationStore, installDurableNativeStopBridge } from './durable-orchestration-stop.mjs';
import { validateWorkerProgressEnvelope } from '../ui/worker-task-progress.ts';

test('DurableOrchestrationStore persists graph/delegation links across restart, validates on-disk artifacts, and feeds UI progress gate cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'starli-orch-r3-'));
  const dbPath = join(dir, 'orchestration.sqlite');
  const feArtifact = join(dir, 'doglove-frontend.js');
  const beArtifact = join(dir, 'doglove-backend.js');
  writeFileSync(feArtifact, 'console.log("doglove-fe");');
  writeFileSync(beArtifact, 'console.log("doglove-be");');
  const feSha = createHash('sha256').update('console.log("doglove-fe");').digest('hex');
  const beSha = createHash('sha256').update('console.log("doglove-be");').digest('hex');

  try {
    // 1. Register graph + 2 cross-room child delegations
    const s1 = new DurableOrchestrationStore(dbPath);
    s1.registerGraph({
      graphId: 'graph-doglove-1',
      companyId: 'comp-doglove-1',
      projectId: 'proj-doglove-1',
      requestId: 'req-doglove-1',
      sourceMessageId: 'msg-orig-1',
      parentRoomId: 'room-doglove-main',
      parentRunId: 'run-boss-parent',
      authorizationRevision: 4,
      generation: 1,
      revision: 1,
    });
    s1.registerDelegationLink({
      callId: 'call-fe-1',
      graphId: 'graph-doglove-1',
      parentRunId: 'run-boss-parent',
      childCompanyId: 'comp-doglove-1',
      childRoomId: 'room-fe-worker',
      childRunId: 'run-child-fe',
      taskId: 'task-fe',
      botId: 'dev-frontend',
      turnId: 'turn-fe-1',
      executionClass: 'NATIVE_NONPRODUCTION',
    });
    s1.registerDelegationLink({
      callId: 'call-be-1',
      graphId: 'graph-doglove-1',
      parentRunId: 'run-boss-parent',
      childCompanyId: 'comp-doglove-1',
      childRoomId: 'room-be-worker',
      childRunId: 'run-child-be',
      taskId: 'task-be',
      botId: 'dev-backend',
      turnId: 'turn-be-1',
      executionClass: 'NATIVE_NONPRODUCTION',
    });

    // Reject forged digest or non-zero exit code
    assert.throws(
      () => s1.recordVerifiedArtifact({ callId: 'call-fe-1', artifactPath: feArtifact, expectedSha256: '0'.repeat(64), processReceipt: { exitCode: 0, pid: 1234 } }),
      /ARTIFACT_DIGEST_MISMATCH/
    );
    assert.throws(
      () => s1.recordVerifiedArtifact({ callId: 'call-fe-1', artifactPath: feArtifact, expectedSha256: feSha, processReceipt: { exitCode: 1, pid: 1234 } }),
      /CANONICAL_PROCESS_RECEIPT_INVALID/
    );

    // Record valid verified artifacts
    s1.recordVerifiedArtifact({ callId: 'call-fe-1', artifactPath: feArtifact, expectedSha256: feSha, processReceipt: { exitCode: 0, pid: 1234 }, executionClass: 'NATIVE_NONPRODUCTION' });
    s1.recordVerifiedArtifact({ callId: 'call-be-1', artifactPath: beArtifact, expectedSha256: beSha, processReceipt: { exitCode: 0, pid: 1235 }, executionClass: 'NATIVE_NONPRODUCTION' });
    s1.close();

    // 2. Reopen SQLite DB (simulating process restart) and verify authoritative progress -> UI gate TERMINAL_VERIFIED
    const s2 = new DurableOrchestrationStore(dbPath);
    const env = s2.buildAuthoritativeProgressEnvelope('graph-doglove-1');
    const uiSummary = validateWorkerProgressEnvelope(env.items, env.expectedContext);
    assert.equal(uiSummary.phase, 'TERMINAL_VERIFIED');
    assert.equal(uiSummary.items.length, 2);
    assert.equal(uiSummary.rejectedCount, 0);
    s2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installDurableNativeStopBridge supports existing 3-argument caller, cancels cross-room children using their own room tuples, denies cross-tenant stop, and persists COMPUTE_STOP_HANDOFF_V1.1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'starli-stop-r3-'));
  const dbPath = join(dir, 'orchestration.sqlite');
  try {
    const store = new DurableOrchestrationStore(dbPath);
    store.registerGraph({
      graphId: 'graph-stop-1',
      companyId: 'comp-doglove-1',
      projectId: 'proj-doglove-1',
      requestId: 'req-doglove-1',
      sourceMessageId: 'msg-orig-1',
      parentRoomId: 'room-boss-main',
      parentRunId: 'run-boss-parent',
      authorizationRevision: 5,
      generation: 2,
      revision: 1,
    });
    store.registerDelegationLink({
      callId: 'call-1',
      graphId: 'graph-stop-1',
      parentRunId: 'run-boss-parent',
      childCompanyId: 'comp-doglove-1',
      childRoomId: 'room-child-alpha',
      childRunId: 'run-child-alpha',
      taskId: 'task-alpha',
      botId: 'dev-frontend',
      turnId: 'turn-alpha',
    });
    store.registerDelegationLink({
      callId: 'call-2',
      graphId: 'graph-stop-1',
      parentRunId: 'run-boss-parent',
      childCompanyId: 'comp-doglove-1',
      childRoomId: 'room-child-beta',
      childRunId: 'run-child-beta',
      taskId: 'task-beta',
      botId: 'dev-backend',
      turnId: 'turn-beta',
    });

    const cancelledCalls = [];
    const emittedHandoffs = [];
    let logicalStops = 0;
    const runtime = {
      executionConsumer: {
        stop(actor, ref, reason) {
          logicalStops += 1;
          return { state: 'STOPPED', orchestrationPlanId: ref.orchestrationPlanId, detail: reason };
        },
      },
    };
    installDurableNativeStopBridge(runtime, store, {
      async cancelTurn(args) {
        cancelledCalls.push(args);
        return { runId: args.turn, status: 'CANCELLED', confirmedStopped: true };
      },
      async emitComputeStopHandoff(h) {
        emittedHandoffs.push(h);
      },
    });

    // Cross-tenant 3-argument stop denied
    await assert.rejects(
      () => runtime.executionConsumer.stop(
        { tenantId: 'comp-evil-999' },
        { tenantId: 'comp-evil-999', orchestrationPlanId: 'graph-stop-1', workPackageId: 'wp-1' },
        'evil stop'
      ),
      /CROSS_TENANT_STOP_DENIED/
    );

    // Legitimate 3-argument stop (exact MachineryExecutionDriver.stop signature!)
    const res = await runtime.executionConsumer.stop(
      { tenantId: 'comp-doglove-1' },
      { tenantId: 'comp-doglove-1', orchestrationPlanId: 'graph-stop-1', workPackageId: 'wp-1' },
      'Owner requested stop'
    );
    assert.equal(logicalStops, 1);
    assert.equal(res.confirmedStopped, true);
    assert.equal(emittedHandoffs.length, 1);
    assert.equal(res.computeStopHandoff.contract, 'COMPUTE_STOP_HANDOFF_V1.1');

    // Verify each child was cancelled with its OWN room tuple, not parent room!
    assert.deepEqual(cancelledCalls, [
      { company: 'comp-doglove-1', room: 'room-boss-main', turn: 'run-boss-parent' },
      { company: 'comp-doglove-1', room: 'room-child-alpha', turn: 'run-child-alpha' },
      { company: 'comp-doglove-1', room: 'room-child-beta', turn: 'run-child-beta' },
    ]);

    // Verify persisted handoff survives DB reopen and authoritative UI progress reaches STOPPED
    store.close();
    const reopened = new DurableOrchestrationStore(dbPath);
    assert.equal(reopened.listStopHandoffs('graph-stop-1').length, 1);
    const postStopEnv = reopened.buildAuthoritativeProgressEnvelope('graph-stop-1');
    const postStopUi = validateWorkerProgressEnvelope(postStopEnv.items, postStopEnv.expectedContext);
    assert.equal(postStopUi.phase, 'STOPPED');
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
