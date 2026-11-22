/**
 * StarliDigital R6 Verifier-Only Durable Orchestration & Stop Store
 * Task: GGB1-GEMINI1-ORCHESTRATION-R6
 *
 * Security invariants:
 * 1. Verifier-only: zero signing methods; private #executorVerifyKey (>=32-byte Buffer).
 * 2. Canonical machinery_run_id persisted separately from native parent_run_id.
 * 3. Fail-closed canonical authority requirement for non-FIXTURE graph/link registration (R4-07-NATIVE).
 * 4. Atomic SQLite BEGIN IMMEDIATE late-receipt fence checking graph_state, link.status,
 *    parent_stop_confirmed, authorization_revision, and generation, persisting forensic
 *    evidence to late_artifact_audit without reviving stopped/revoked progress (R6-LATE-RECEIPT).
 * 5. Explicit physical cancellation confirmation required on parent + all children (R6-STOP-CONFIRMATION).
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildReceiptCanonicalPayload } from './executor-receipt-issuer.mjs';

const FENCED_STATES = new Set(['STOP_REQUESTED', 'STOPPED', 'REVOKED']);

export class DurableOrchestrationStore {
  #executorVerifyKey;

  constructor(dbPath, { executorVerifyKey }) {
    if (!Buffer.isBuffer(executorVerifyKey) || executorVerifyKey.length < 32) {
      throw Object.assign(new Error('EXECUTOR_VERIFY_KEY_REQUIRED'), { code: 'EXECUTOR_VERIFY_KEY_REQUIRED' });
    }
    this.dbPath = dbPath;
    this.#executorVerifyKey = Buffer.from(executorVerifyKey);
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS orchestration_graphs (
        graph_id TEXT PRIMARY KEY,
        machinery_run_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        parent_run_id TEXT NOT NULL,
        parent_room_id TEXT NOT NULL,
        parent_turn_id TEXT NOT NULL,
        authorization_revision INTEGER NOT NULL,
        generation INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        graph_state TEXT NOT NULL DEFAULT 'ACTIVE',
        registration_mode TEXT NOT NULL DEFAULT 'CANONICAL_VERIFIED',
        parent_stop_confirmed INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
        status TEXT NOT NULL DEFAULT 'DISPATCHED',
        execution_class TEXT NOT NULL DEFAULT 'FIXTURE',
        artifact_path TEXT,
        artifact_digest TEXT,
        server_provenance_verified INTEGER NOT NULL DEFAULT 0,
        stop_confirmed_by_server INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (graph_id) REFERENCES orchestration_graphs(graph_id)
      );

      CREATE TABLE IF NOT EXISTS stop_handoffs (
        handoff_id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS late_artifact_audit (
        audit_id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        graph_id TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        artifact_digest TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        fence_reason TEXT NOT NULL,
        graph_state TEXT NOT NULL,
        link_status TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  registerGraph(g, { authorityVerifier = null, actor = null, allowFixtureUnverified = false } = {}) {
    if (!g || typeof g !== 'object' || !g.graphId || !g.companyId || !g.machineryRunId || !g.parentRunId) {
      throw Object.assign(new Error('INVALID_GRAPH_BINDING'), { code: 'INVALID_GRAPH_BINDING' });
    }

    let registrationMode = 'CANONICAL_VERIFIED';
    if (authorityVerifier) {
      let ok;
      try {
        ok =
          typeof authorityVerifier === 'function'
            ? authorityVerifier(g, actor)
            : authorityVerifier.verifyGraphRegistration(g, actor);
      } catch (err) {
        if (err && err.code) throw err;
        throw Object.assign(new Error(err?.message || 'CANONICAL_AUTHORITY_UNAVAILABLE'), {
          code: 'CANONICAL_AUTHORITY_UNAVAILABLE',
        });
      }
      if (ok !== true) {
        throw Object.assign(new Error('CANONICAL_AUTHORITY_DENIED'), { code: 'CANONICAL_AUTHORITY_DENIED' });
      }
    } else if (allowFixtureUnverified === true) {
      registrationMode = 'FIXTURE_UNVERIFIED';
    } else {
      throw Object.assign(new Error('CANONICAL_AUTHORITY_REQUIRED'), { code: 'CANONICAL_AUTHORITY_REQUIRED' });
    }

    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO orchestration_graphs
           (graph_id, machinery_run_id, company_id, project_id, source_message_id, request_id,
            parent_run_id, parent_room_id, parent_turn_id, authorization_revision, generation, revision,
            graph_state, registration_mode, parent_stop_confirmed, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, ?, ?)`
        )
        .run(
          g.graphId,
          g.machineryRunId,
          g.companyId,
          g.projectId,
          g.sourceMessageId,
          g.requestId,
          g.parentRunId,
          g.parentRoomId,
          g.parentTurnId || g.parentRunId,
          g.authorizationRevision,
          g.generation,
          g.revision,
          registrationMode,
          now,
          now
        );
    } catch (err) {
      if (String(err?.message || '').includes('UNIQUE') || String(err?.message || '').includes('PRIMARY')) {
        throw Object.assign(new Error('IMMUTABLE_BINDING_CONFLICT'), { code: 'IMMUTABLE_BINDING_CONFLICT' });
      }
      throw err;
    }
    return this.getGraph(g.graphId);
  }

  registerDelegationLink(link, { authorityVerifier = null, actor = null, allowFixtureUnverified = false } = {}) {
    const g = this.getGraph(link.graphId);
    if (!g) {
      throw Object.assign(new Error('ORCHESTRATION_GRAPH_NOT_FOUND'), { code: 'ORCHESTRATION_GRAPH_NOT_FOUND' });
    }
    if (FENCED_STATES.has(g.graph_state)) {
      throw Object.assign(new Error(`GRAPH_NOT_ACTIVE:${g.graph_state}`), { code: 'GRAPH_NOT_ACTIVE' });
    }
    if (link.childCompanyId !== g.company_id) {
      throw Object.assign(
        new Error(`CROSS_TENANT_DELEGATION_DENIED: child company ${link.childCompanyId} != graph company ${g.company_id}`),
        { code: 'CROSS_TENANT_DELEGATION_DENIED' }
      );
    }
    if (link.parentRunId !== g.parent_run_id) {
      throw Object.assign(
        new Error(`UNRELATED_PARENT_RUN_DENIED: parentRunId ${link.parentRunId} != graph parent_run_id ${g.parent_run_id}`),
        { code: 'UNRELATED_PARENT_RUN_DENIED' }
      );
    }

    const execClass = link.executionClass || 'FIXTURE';
    if (authorityVerifier) {
      let ok;
      try {
        ok =
          typeof authorityVerifier === 'function'
            ? authorityVerifier(link, g, actor)
            : authorityVerifier.verifyDelegationLinkRegistration(link, g, actor);
      } catch (err) {
        if (err && err.code) throw err;
        throw Object.assign(new Error(err?.message || 'CANONICAL_AUTHORITY_UNAVAILABLE'), {
          code: 'CANONICAL_AUTHORITY_UNAVAILABLE',
        });
      }
      if (ok !== true) {
        throw Object.assign(new Error('CANONICAL_AUTHORITY_DENIED'), { code: 'CANONICAL_AUTHORITY_DENIED' });
      }
    } else if (allowFixtureUnverified === true && execClass === 'FIXTURE') {
      // Allowed ONLY for explicit fixture-only tests when executionClass is FIXTURE
    } else {
      throw Object.assign(new Error('CANONICAL_AUTHORITY_REQUIRED'), { code: 'CANONICAL_AUTHORITY_REQUIRED' });
    }

    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO delegation_links
           (call_id, graph_id, parent_run_id, child_company_id, child_room_id, child_run_id,
            task_id, bot_id, turn_id, status, execution_class, updated_at)
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
          'DISPATCHED',
          execClass,
          now
        );
    } catch (err) {
      if (String(err?.message || '').includes('UNIQUE') || String(err?.message || '').includes('PRIMARY')) {
        throw Object.assign(new Error('IMMUTABLE_BINDING_CONFLICT'), { code: 'IMMUTABLE_BINDING_CONFLICT' });
      }
      throw err;
    }
    return this.db.prepare('SELECT * FROM delegation_links WHERE call_id=?').get(link.callId);
  }

  /**
   * Atomically verify and admit a signed executor receipt.
   * Checks lifecycle (STOP_REQUESTED/STOPPED/REVOKED), parent_stop_confirmed,
   * authorization_revision, and generation inside BEGIN IMMEDIATE.
   * Fenced late receipts are durably audited in late_artifact_audit and NEVER revive stopped work.
   */
  recordVerifiedArtifact({ callId, artifactPath, expectedSha256, executorReceipt, nowMs = Date.now() }) {
    if (
      !executorReceipt ||
      typeof executorReceipt !== 'object' ||
      executorReceipt.contract !== 'TRUSTED_EXECUTOR_RECEIPT_V2' ||
      executorReceipt.verifiedByExecutor !== true ||
      typeof executorReceipt.hmac !== 'string'
    ) {
      throw Object.assign(new Error('UNTRUSTED_EXECUTOR_RECEIPT'), { code: 'UNTRUSTED_EXECUTOR_RECEIPT' });
    }

    const actualSha256 = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
    if (actualSha256 !== expectedSha256 || actualSha256 !== executorReceipt.artifactDigest) {
      throw Object.assign(new Error('ARTIFACT_DIGEST_MISMATCH'), { code: 'ARTIFACT_DIGEST_MISMATCH' });
    }

    const issuedMs = Date.parse(executorReceipt.issuedAt || '');
    const expiresMs = Date.parse(executorReceipt.expiresAt || '');
    if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || nowMs > expiresMs) {
      throw Object.assign(new Error('EXPIRED_EXECUTOR_RECEIPT'), { code: 'EXPIRED_EXECUTOR_RECEIPT' });
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const link = this.db.prepare('SELECT * FROM delegation_links WHERE call_id=?').get(callId);
      if (!link) {
        throw Object.assign(new Error('DELEGATION_LINK_NOT_FOUND'), { code: 'DELEGATION_LINK_NOT_FOUND' });
      }
      const g = this.db.prepare('SELECT * FROM orchestration_graphs WHERE graph_id=?').get(link.graph_id);
      if (!g) {
        throw Object.assign(new Error('ORCHESTRATION_GRAPH_NOT_FOUND'), { code: 'ORCHESTRATION_GRAPH_NOT_FOUND' });
      }

      if (
        executorReceipt.graphId !== g.graph_id ||
        executorReceipt.companyId !== g.company_id ||
        executorReceipt.projectId !== g.project_id ||
        executorReceipt.requestId !== g.request_id ||
        executorReceipt.callId !== link.call_id ||
        executorReceipt.taskId !== link.task_id ||
        executorReceipt.childRunId !== link.child_run_id
      ) {
        throw Object.assign(new Error('EXECUTOR_RECEIPT_BINDING_MISMATCH'), {
          code: 'EXECUTOR_RECEIPT_BINDING_MISMATCH',
        });
      }

      const expectedMac = createHmac('sha256', this.#executorVerifyKey)
        .update(buildReceiptCanonicalPayload(executorReceipt))
        .digest('hex');
      const a = Buffer.from(executorReceipt.hmac, 'utf8');
      const b = Buffer.from(expectedMac, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw Object.assign(new Error('UNTRUSTED_EXECUTOR_RECEIPT_SIGNATURE'), {
          code: 'UNTRUSTED_EXECUTOR_RECEIPT',
        });
      }

      // Atomic lifecycle + authority revision + generation fence (R6-LATE-RECEIPT)
      let fenceReason = null;
      if (FENCED_STATES.has(g.graph_state)) {
        fenceReason = `GRAPH_LIFECYCLE_FENCED:${g.graph_state}`;
      } else if (FENCED_STATES.has(link.status)) {
        fenceReason = `LINK_LIFECYCLE_FENCED:${link.status}`;
      } else if (g.parent_stop_confirmed !== null) {
        fenceReason = 'PARENT_STOP_INITIATED';
      } else if (Number(executorReceipt.authorizationRevision) !== Number(g.authorization_revision)) {
        fenceReason = `AUTHORIZATION_REVISION_STALE:${executorReceipt.authorizationRevision}!=${g.authorization_revision}`;
      } else if (Number(executorReceipt.generation) !== Number(g.generation)) {
        fenceReason = `GENERATION_STALE:${executorReceipt.generation}!=${g.generation}`;
      }

      const now = new Date(nowMs).toISOString();
      if (fenceReason) {
        this.db
          .prepare(
            `INSERT INTO late_artifact_audit
             (audit_id, call_id, graph_id, artifact_path, artifact_digest, receipt_json, fence_reason, graph_state, link_status, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            'audit_' + randomUUID(),
            callId,
            g.graph_id,
            artifactPath,
            actualSha256,
            JSON.stringify(executorReceipt),
            fenceReason,
            g.graph_state,
            link.status,
            now
          );
        this.db.exec('COMMIT');
        return {
          callId,
          artifactDigest: actualSha256,
          executionClass: executorReceipt.executionClass || link.execution_class || 'FIXTURE',
          fenced: true,
          fenceReason,
          audited: true,
          serverProvenanceVerified: false,
          graphState: g.graph_state,
          linkStatus: link.status,
        };
      }

      const execClass = executorReceipt.executionClass || link.execution_class || 'FIXTURE';
      this.db
        .prepare(
          `UPDATE delegation_links
           SET status='WORKER_TERMINAL', execution_class=?, artifact_path=?, artifact_digest=?, server_provenance_verified=1, updated_at=?
           WHERE call_id=?`
        )
        .run(execClass, artifactPath, actualSha256, now, callId);
      this.db.exec('COMMIT');
      return {
        callId,
        artifactDigest: actualSha256,
        executionClass: execClass,
        fenced: false,
        audited: false,
        serverProvenanceVerified: true,
      };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }

  getGraph(graphId) {
    return this.db.prepare('SELECT * FROM orchestration_graphs WHERE graph_id=?').get(graphId) || null;
  }

  listLinksForGraph(graphId) {
    return this.db.prepare('SELECT * FROM delegation_links WHERE graph_id=? ORDER BY call_id ASC').all(graphId);
  }

  listLateArtifactAudits(graphId) {
    return this.db
      .prepare('SELECT * FROM late_artifact_audit WHERE graph_id=? ORDER BY recorded_at DESC')
      .all(graphId);
  }

  revokeGraph(graphId, { newAuthorizationRevision = null, nowMs = Date.now() } = {}) {
    const now = new Date(nowMs).toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const g = this.db.prepare('SELECT * FROM orchestration_graphs WHERE graph_id=?').get(graphId);
      if (!g) {
        throw Object.assign(new Error('ORCHESTRATION_GRAPH_NOT_FOUND'), { code: 'ORCHESTRATION_GRAPH_NOT_FOUND' });
      }
      const nextRev =
        newAuthorizationRevision !== null ? Number(newAuthorizationRevision) : Number(g.authorization_revision) + 1;
      this.db
        .prepare(
          `UPDATE orchestration_graphs
           SET graph_state='REVOKED', authorization_revision=?, updated_at=?
           WHERE graph_id=?`
        )
        .run(nextRev, now, graphId);
      this.db
        .prepare(
          `UPDATE delegation_links
           SET status='REVOKED', updated_at=?
           WHERE graph_id=?`
        )
        .run(now, graphId);
      this.db.exec('COMMIT');
      return this.getGraph(graphId);
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  }

  markParentStopStatus(graphId, confirmedStopped) {
    const now = new Date().toISOString();
    const g = this.getGraph(graphId);
    if (!g) return;
    const nextState =
      g.graph_state === 'REVOKED' ? 'REVOKED' : confirmedStopped ? 'STOPPED' : 'STOP_REQUESTED';
    this.db
      .prepare(
        `UPDATE orchestration_graphs
         SET parent_stop_confirmed=?, graph_state=?, updated_at=?
         WHERE graph_id=?`
      )
      .run(confirmedStopped ? 1 : 0, nextState, now, graphId);
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
        `INSERT INTO stop_handoffs (handoff_id, graph_id, payload_json, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(handoff.handoffId, handoff.graphId, JSON.stringify(handoff), now);
    // Keep graph_state consistent with overall handoff confirmation
    const g = this.getGraph(handoff.graphId);
    if (g && g.graph_state !== 'REVOKED') {
      const nextState = handoff.confirmedStopped === true ? 'STOPPED' : 'STOP_REQUESTED';
      this.db
        .prepare('UPDATE orchestration_graphs SET graph_state=?, updated_at=? WHERE graph_id=?')
        .run(nextState, now, handoff.graphId);
    }
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
    const isRevoked = g.graph_state === 'REVOKED';
    const isStoppedOrPending = g.graph_state === 'STOPPED' || g.graph_state === 'STOP_REQUESTED';
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
      revoked: isRevoked,
      graphCompletionVerified:
        !isRevoked &&
        !isStoppedOrPending &&
        !parentStopUnconfirmed &&
        links.length > 0 &&
        links.every((l) => l.status === 'WORKER_TERMINAL' && l.server_provenance_verified === 1),
      nowMs,
    };

    const items = links.map((l) => {
      let effectiveStatus = l.status;
      if (parentStopUnconfirmed && l.status === 'STOPPED') {
        effectiveStatus = 'STOP_REQUESTED';
      }
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
    const actorTenant = actor.tenantId || actor.workspaceTenantId;
    if (actorTenant && actorTenant !== g.company_id) {
      throw Object.assign(new Error('CROSS_TENANT_STOP_DENIED'), { code: 'CROSS_TENANT_STOP_DENIED' });
    }

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

    // Fence graph BEFORE logical/physical stop so concurrent late receipts cannot slip in
    store.markParentStopStatus(graphId, false);

    const logicalStop = await Promise.resolve(originalStop(actor, reference, reason));

    const cancelled = [];
    let parentConfirmed = false;
    try {
      const parentRes = await Promise.resolve(
        ports.cancelTurn({
          company: g.company_id,
          room: g.parent_room_id,
          turn: g.parent_run_id,
        })
      );
      parentConfirmed = Boolean(parentRes && typeof parentRes === 'object' && parentRes.confirmedStopped === true);
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
      if (link.child_company_id !== g.company_id || link.parent_run_id !== g.parent_run_id) {
        continue;
      }
      let childConfirmed = false;
      try {
        const cRes = await Promise.resolve(
          ports.cancelTurn({
            company: link.child_company_id,
            room: link.child_room_id,
            turn: link.child_run_id,
          })
        );
        childConfirmed = Boolean(cRes && typeof cRes === 'object' && cRes.confirmedStopped === true);
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

    const logicalUncertain = Boolean(
      logicalStop && typeof logicalStop === 'object' && logicalStop.state === 'UNCERTAIN'
    );
    const allConfirmed = !logicalUncertain && parentConfirmed && cancelled.every((c) => c.confirmedStopped === true);

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
      runIds: [g.parent_run_id, ...links.map((l) => l.child_run_id)],
      vmQuotaReleased: false,
      nativeTurnCleanupDoesNotReleaseVmQuota: true,
      reason: String(reason || 'Stopped by operator'),
      confirmedStopped: allConfirmed,
      cancelled,
      issuedAt: new Date().toISOString(),
    };
    store.saveStopHandoff(handoff);

    return {
      ...(logicalStop && typeof logicalStop === 'object' ? logicalStop : {}),
      state: logicalUncertain ? 'UNCERTAIN' : allConfirmed ? 'STOPPED' : 'STOP_PENDING',
      stopState: handoff.stopState,
      confirmedStopped: allConfirmed,
      computeStopHandoff: handoff,
      cancelled,
    };
  };
}
