/**
 * Durable Canonical Orchestration Store, Executor-Signed Artifact Provenance Validator,
 * and 3-Argument-Compatible Native Stop Bridge (GGB1-GEMINI1-INTEGRATION-R4).
 *
 * Fixes all 4 coordinator-reproduced R4 orchestration defects:
 *  - R4-04: Emits Grokbot4-compatible COMPUTE_STOP_HANDOFF_V1 (schemaVersion COMPUTE_STOP_HANDOFF_V1.1,
 *           stopState, runIds, vmQuotaReleased: false, nativeTurnCleanupDoesNotReleaseVmQuota: true).
 *  - R4-05: Tracks parent_stop_confirmed in SQLite; unconfirmed parent stop prevents graph-level STOPPED.
 *  - R4-06: Rejects unattested caller executor receipts; requires executor HMAC over (callId, sha256, exitCode, runId).
 *  - R4-07: Rejects explicitNative identity overrides (EXPLICIT_NATIVE_IDENTITY_MISMATCH) and uses immutable
 *           INSERT (IMMUTABLE_BINDING_CONFLICT) instead of INSERT OR REPLACE.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export class DurableOrchestrationStore {
  constructor(dbPath, { executorSigningKey } = {}) {
    this.dbPath = dbPath;
    this.executorSigningKey =
      Buffer.isBuffer(executorSigningKey) && executorSigningKey.length >= 32
        ? Buffer.from(executorSigningKey)
        : randomBytes(32);
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS orchestration_graphs (
        graph_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        parent_room_id TEXT NOT NULL,
        parent_run_id TEXT NOT NULL,
        authorization_revision INTEGER NOT NULL,
        generation INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL DEFAULT 'ACTIVE',
        parent_stop_confirmed INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS delegation_links (
        call_id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        parent_run_id TEXT NOT NULL,
        child_company_id TEXT NOT NULL,
        child_room_id TEXT NOT NULL,
        child_run_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'TASK_DISPATCHED',
        execution_class TEXT NOT NULL DEFAULT 'FIXTURE',
        artifact_path TEXT,
        artifact_digest TEXT,
        server_provenance_verified INTEGER NOT NULL DEFAULT 0,
        stop_confirmed_by_server INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stop_handoffs (
        handoff_id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        confirmed_stopped INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  signExecutorReceipt({ callId, artifactDigest, exitCode, runId }) {
    const cleanDigest = String(artifactDigest || '').replace(/^sha256:/i, '');
    const mac = createHmac('sha256', this.executorSigningKey)
      .update(`${callId}:${cleanDigest}:${exitCode}:${runId}`)
      .digest('hex');
    return { verifiedByExecutor: true, exitCode, runId, hmac: mac };
  }

  registerGraph(g) {
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO orchestration_graphs
           (graph_id, company_id, project_id, request_id, source_message_id, parent_room_id, parent_run_id, authorization_revision, generation, revision, state, parent_stop_confirmed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?)`
        )
        .run(
          g.graphId,
          g.companyId,
          g.projectId,
          g.requestId,
          g.sourceMessageId,
          g.parentRoomId,
          g.parentRunId,
          g.authorizationRevision,
          g.generation,
          g.revision ?? 1,
          now
        );
    } catch (e) {
      throw Object.assign(new Error('IMMUTABLE_BINDING_CONFLICT: graph already registered'), {
        code: 'IMMUTABLE_BINDING_CONFLICT',
      });
    }
  }

  registerDelegationLink(link) {
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO delegation_links
           (call_id, graph_id, parent_run_id, child_company_id, child_room_id, child_run_id, task_id, bot_id, turn_id, status, execution_class, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          link.callId,
          link.graphId,
          link.parentRunId,
          link.childCompanyId,
          link.childRoomId,
          link.childRunId,
          link.taskId,
          link.botId,
          link.turnId,
          link.status ?? 'TASK_DISPATCHED',
          link.executionClass ?? 'FIXTURE',
          now
        );
    } catch (e) {
      throw Object.assign(new Error('IMMUTABLE_BINDING_CONFLICT: delegation link already registered'), {
        code: 'IMMUTABLE_BINDING_CONFLICT',
      });
    }
  }

  /**
   * R4-06 FIX: Requires executor-signed receipt (HMAC verified with internal executorSigningKey)
   * AND on-disk SHA-256 verification. Never trusts raw caller {exitCode: 0, pid: ...}.
   */
  recordVerifiedArtifact({ callId, artifactPath, expectedSha256, executorReceipt, executionClass }) {
    if (!artifactPath || typeof artifactPath !== 'string') {
      throw Object.assign(new Error('ARTIFACT_PATH_REQUIRED'), { code: 'ARTIFACT_PATH_REQUIRED' });
    }
    const link = this.db.prepare('SELECT * FROM delegation_links WHERE call_id=?').get(callId);
    if (!link) {
      throw Object.assign(new Error('DELEGATION_LINK_NOT_FOUND'), { code: 'DELEGATION_LINK_NOT_FOUND' });
    }
    if (
      !executorReceipt ||
      typeof executorReceipt !== 'object' ||
      executorReceipt.verifiedByExecutor !== true ||
      executorReceipt.exitCode !== 0 ||
      executorReceipt.runId !== link.child_run_id ||
      typeof executorReceipt.hmac !== 'string'
    ) {
      throw Object.assign(new Error('UNTRUSTED_EXECUTOR_RECEIPT'), { code: 'UNTRUSTED_EXECUTOR_RECEIPT' });
    }

    const actualSha256 = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
    if (expectedSha256 && actualSha256 !== expectedSha256.replace(/^sha256:/i, '')) {
      throw Object.assign(new Error('ARTIFACT_DIGEST_MISMATCH'), { code: 'ARTIFACT_DIGEST_MISMATCH' });
    }

    const expectedMac = createHmac('sha256', this.executorSigningKey)
      .update(`${callId}:${actualSha256}:0:${link.child_run_id}`)
      .digest('hex');
    const a = Buffer.from(executorReceipt.hmac, 'utf8');
    const b = Buffer.from(expectedMac, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw Object.assign(new Error('UNTRUSTED_EXECUTOR_RECEIPT_SIGNATURE'), {
        code: 'UNTRUSTED_EXECUTOR_RECEIPT',
      });
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE delegation_links
         SET status='WORKER_TERMINAL', execution_class=?, artifact_path=?, artifact_digest=?, server_provenance_verified=1, updated_at=?
         WHERE call_id=?`
      )
      .run(executionClass || 'NATIVE_NONPRODUCTION', artifactPath, actualSha256, now, callId);
    return { callId, artifactDigest: actualSha256, serverProvenanceVerified: true };
  }

  getGraph(graphId) {
    return this.db.prepare('SELECT * FROM orchestration_graphs WHERE graph_id=?').get(graphId) || null;
  }

  listLinksForGraph(graphId) {
    return this.db.prepare('SELECT * FROM delegation_links WHERE graph_id=? ORDER BY call_id ASC').all(graphId);
  }

  markParentStopStatus(graphId, confirmedStopped) {
    this.db
      .prepare('UPDATE orchestration_graphs SET parent_stop_confirmed=?, state=? WHERE graph_id=?')
      .run(confirmedStopped ? 1 : 0, confirmedStopped ? 'STOPPED' : 'STOP_PENDING', graphId);
  }

  markLinkStopStatus(callId, confirmedStopped) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE delegation_links
         SET status=?, stop_confirmed_by_server=?, updated_at=?
         WHERE call_id=?`
      )
      .run(confirmedStopped ? 'STOPPED' : 'STOP_REQUESTED', confirmedStopped ? 1 : 0, now, callId);
  }

  saveStopHandoff(handoff) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO stop_handoffs (handoff_id, graph_id, company_id, project_id, request_id, revision, confirmed_stopped, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        handoff.handoffId,
        handoff.graphId,
        handoff.companyId,
        handoff.projectId,
        handoff.requestId,
        handoff.revision,
        handoff.confirmedStopped ? 1 : 0,
        JSON.stringify(handoff),
        now
      );
  }

  listStopHandoffs(graphId) {
    return this.db
      .prepare('SELECT * FROM stop_handoffs WHERE graph_id=? ORDER BY created_at DESC')
      .all(graphId)
      .map((r) => JSON.parse(r.payload_json));
  }

  buildAuthoritativeProgressEnvelope(graphId, { nowMs = Date.now(), ttlMs = 60_000 } = {}) {
    const g = this.getGraph(graphId);
    if (!g) return null;
    const links = this.listLinksForGraph(graphId);
    const issuedAt = new Date(nowMs - 1000).toISOString();
    const expiresAt = new Date(nowMs + ttlMs).toISOString();
    const parentStopUnconfirmed = g.parent_stop_confirmed === 0;

    const expectedContext = {
      companyId: g.company_id,
      projectId: g.project_id,
      sourceMessageId: g.source_message_id,
      requestId: g.request_id,
      graphId: g.graph_id,
      roomId: g.parent_room_id,
      authorizationRevision: g.authorization_revision,
      runGeneration: g.generation,
      expectedTaskIds: links.map((l) => l.task_id),
      graphCompletionVerified:
        !parentStopUnconfirmed &&
        links.length > 0 &&
        links.every((l) => l.status === 'WORKER_TERMINAL' && l.server_provenance_verified === 1),
      nowMs,
    };

    const items = links.map((l) => {
      // R4-05 FIX: If parent stop is unconfirmed, graph cannot claim STOPPED even if child is stopped
      const effectiveStatus = parentStopUnconfirmed && l.status === 'STOPPED' ? 'STOP_REQUESTED' : l.status;
      const effectiveStopConfirmed = !parentStopUnconfirmed && l.stop_confirmed_by_server === 1;
      return {
        schemaVersion: 1,
        contract: 'WORKER_EXECUTION_RECEIPT_V1',
        companyId: g.company_id,
        projectId: g.project_id,
        nativeSourceMessageId: g.source_message_id,
        requestId: g.request_id,
        graphId: g.graph_id,
        roomId: g.parent_room_id,
        childRoomId: l.child_room_id,
        taskId: l.task_id,
        botId: l.bot_id,
        turnId: l.turn_id,
        runId: l.child_run_id,
        generation: g.generation,
        authorizationRevision: g.authorization_revision,
        revision: g.revision,
        status: effectiveStatus,
        executionClass: l.execution_class,
        fixtureOnly: l.execution_class === 'FIXTURE',
        artifactDigest: l.artifact_digest || null,
        serverProvenanceVerified: l.server_provenance_verified === 1,
        stopConfirmedByServer: effectiveStopConfirmed,
        issuedAt,
        expiresAt,
      };
    });

    return { expectedContext, items };
  }
}

export function installDurableNativeStopBridge(runtime, store, ports) {
  const originalStop = runtime.executionConsumer.stop.bind(runtime.executionConsumer);

  runtime.executionConsumer.stop = async function durableNativeStop(actor, reference, reason, explicitNative) {
    if (!actor || !reference || typeof reference.orchestrationPlanId !== 'string') {
      throw Object.assign(new Error('INVALID_STOP_REFERENCE'), { code: 'INVALID_STOP_REFERENCE' });
    }

    const graphId = reference.orchestrationPlanId;
    const g = store.getGraph(graphId);
    if (!g) {
      throw Object.assign(new Error('ORCHESTRATION_GRAPH_NOT_FOUND'), { code: 'ORCHESTRATION_GRAPH_NOT_FOUND' });
    }
    if (actor.tenantId && actor.tenantId !== g.company_id) {
      throw Object.assign(new Error('CROSS_TENANT_STOP_DENIED'), { code: 'CROSS_TENANT_STOP_DENIED' });
    }

    // R4-07 FIX: Reject explicitNative mismatches ? never allow caller to override canonical bound identity
    if (explicitNative && typeof explicitNative === 'object') {
      if (
        (explicitNative.companyId !== undefined && explicitNative.companyId !== g.company_id) ||
        (explicitNative.projectId !== undefined && explicitNative.projectId !== g.project_id) ||
        (explicitNative.requestId !== undefined && explicitNative.requestId !== g.request_id) ||
        (explicitNative.revision !== undefined && explicitNative.revision !== g.revision)
      ) {
        throw Object.assign(new Error('EXPLICIT_NATIVE_IDENTITY_MISMATCH'), {
          code: 'EXPLICIT_NATIVE_IDENTITY_MISMATCH',
        });
      }
    }

    const logicalStop = await originalStop(actor, reference, reason);

    const cancelled = [];
    let parentConfirmed = false;
    try {
      const parentRes = await ports.cancelTurn({
        company: g.company_id,
        room: g.parent_room_id,
        turn: g.parent_run_id,
      });
      parentConfirmed = parentRes?.confirmedStopped === true;
    } catch {
      parentConfirmed = false;
    }
    store.markParentStopStatus(graphId, parentConfirmed);
    cancelled.push({
      company: g.company_id,
      room: g.parent_room_id,
      turn: g.parent_run_id,
      confirmedStopped: parentConfirmed,
    });

    const links = store.listLinksForGraph(graphId);
    for (const link of links) {
      let childConfirmed = false;
      try {
        const cRes = await ports.cancelTurn({
          company: link.child_company_id,
          room: link.child_room_id,
          turn: link.child_run_id,
        });
        childConfirmed = cRes?.confirmedStopped === true;
      } catch {
        childConfirmed = false;
      }
      store.markLinkStopStatus(link.call_id, childConfirmed);
      cancelled.push({
        company: link.child_company_id,
        room: link.child_room_id,
        turn: link.child_run_id,
        confirmedStopped: childConfirmed,
      });
    }

    const allConfirmed = parentConfirmed && cancelled.every((c) => c.confirmedStopped === true);

    // R4-04 FIX: Exact Grokbot4 ComputeStopHandoffConsumer contract
    const handoff = {
      contract: 'COMPUTE_STOP_HANDOFF_V1',
      schemaVersion: 'COMPUTE_STOP_HANDOFF_V1.1',
      addressee: 'grokbot4',
      handoffId: 'stop_' + randomUUID(),
      graphId: g.graph_id,
      companyId: g.company_id,
      projectId: g.project_id,
      requestId: g.request_id,
      revision: g.revision,
      stopState: allConfirmed ? 'CONFIRMED_NATIVE_CANCELLED' : 'STOP_PENDING',
      runIds: cancelled.map((c) => c.turn),
      vmQuotaReleased: false,
      nativeTurnCleanupDoesNotReleaseVmQuota: true,
      reason: String(reason || 'stop_requested'),
      confirmedStopped: allConfirmed,
      cancelled,
      issuedAt: new Date().toISOString(),
    };

    store.saveStopHandoff(handoff);
    if (typeof ports.emitComputeStopHandoff === 'function') {
      await ports.emitComputeStopHandoff(handoff);
    }

    return {
      logicalStop,
      confirmedStopped: allConfirmed,
      cancelled,
      computeStopHandoff: handoff,
    };
  };
}
