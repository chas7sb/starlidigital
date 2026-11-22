/**
 * StarliDigital R6 Trusted Executor Receipt Issuer
 * Task: GGB1-GEMINI1-ORCHESTRATION-R6
 *
 * Security boundaries:
 * 1. Physically separated from DurableOrchestrationStore (verifier-only).
 * 2. NEVER defaults to NATIVE_NONPRODUCTION without canonical Agency completion + scoped artifact proof.
 * 3. issueFixtureReceipt() ALWAYS stamps executionClass = 'FIXTURE' and rejects promotion to NATIVE_*.
 * 4. issueFromCanonicalCompletion() requires actual AgencyExecutionReceipt (status === 'SUCCEEDED'),
 *    live non-STOPPED OrchestrationPlan/WorkPackage matching lastExecutionReceiptId & executionRequestId,
 *    and an artifact strictly inside artifactRootDir (realpath-verified).
 */
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export function buildReceiptCanonicalPayload(fields) {
  return [
    'TRUSTED_EXECUTOR_RECEIPT_V2',
    fields.issuerId || '',
    fields.graphId || '',
    fields.companyId || '',
    fields.projectId || '',
    fields.requestId || '',
    fields.roomId || '',
    fields.callId || '',
    fields.taskId || '',
    fields.childRunId || '',
    String(fields.authorizationRevision ?? ''),
    String(fields.generation ?? ''),
    fields.artifactDigest || '',
    fields.executionClass || '',
    fields.agencyReceiptId || '',
    fields.executionRequestId || '',
    fields.issuedAt || '',
    fields.expiresAt || '',
  ].join('|');
}

function assertScopedArtifact(artifactRootDir, artifactPath) {
  if (!artifactRootDir || typeof artifactRootDir !== 'string') {
    throw Object.assign(new Error('ARTIFACT_ROOT_DIR_REQUIRED'), { code: 'ARTIFACT_ROOT_DIR_REQUIRED' });
  }
  if (!artifactPath || typeof artifactPath !== 'string') {
    throw Object.assign(new Error('ARTIFACT_PATH_REQUIRED'), { code: 'ARTIFACT_PATH_REQUIRED' });
  }
  const resolvedRoot = realpathSync(artifactRootDir);
  const resolvedFile = realpathSync(artifactPath);
  const rel = path.relative(resolvedRoot, resolvedFile);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('ARTIFACT_OUTSIDE_SCOPED_ROOT'), { code: 'ARTIFACT_OUTSIDE_SCOPED_ROOT' });
  }
  const st = statSync(resolvedFile);
  if (!st.isFile()) {
    throw Object.assign(new Error('ARTIFACT_NOT_REGULAR_FILE'), { code: 'ARTIFACT_NOT_REGULAR_FILE' });
  }
  return resolvedFile;
}

export class TrustedExecutorReceiptIssuer {
  #signingKey;
  #issuerId;

  constructor({ signingKey, issuerId = 'starli-trusted-agency-executor/v2' }) {
    if (!Buffer.isBuffer(signingKey) || signingKey.length < 32) {
      throw Object.assign(new Error('EXECUTOR_ISSUER_KEY_TOO_SHORT'), { code: 'EXECUTOR_ISSUER_KEY_TOO_SHORT' });
    }
    this.#signingKey = Buffer.from(signingKey);
    this.#issuerId = String(issuerId);
  }

  #sign(fields) {
    const hmac = createHmac('sha256', this.#signingKey)
      .update(buildReceiptCanonicalPayload(fields))
      .digest('hex');
    return { ...fields, hmac };
  }

  /**
   * Issue a receipt backed by genuine canonical Agency completion & scoped artifact evidence.
   * Rejects stopped plans/packages, mismatched tenant/receipt/request bindings, unscoped files,
   * and any attempt to promote a FIXTURE agency receipt to NATIVE_*.
   */
  issueFromCanonicalCompletion({
    agencyReceipt,
    orchestrationPlan,
    workPackage,
    artifactRootDir,
    artifactPath,
    graphId,
    companyId,
    projectId,
    requestId,
    roomId,
    callId,
    taskId,
    childRunId,
    authorizationRevision,
    generation,
    executionClass = 'NATIVE_NONPRODUCTION',
    nowMs = Date.now(),
    ttlMs = 300_000,
  }) {
    if (!agencyReceipt || typeof agencyReceipt !== 'object' || !agencyReceipt.id || !agencyReceipt.executionRequestId) {
      throw Object.assign(new Error('CANONICAL_AGENCY_RECEIPT_REQUIRED'), { code: 'CANONICAL_AGENCY_RECEIPT_REQUIRED' });
    }
    if (agencyReceipt.status !== 'SUCCEEDED') {
      throw Object.assign(new Error(`AGENCY_RECEIPT_NOT_SUCCEEDED:${agencyReceipt.status}`), {
        code: 'AGENCY_RECEIPT_NOT_SUCCEEDED',
      });
    }
    if (agencyReceipt.tenantId !== companyId) {
      throw Object.assign(new Error('AGENCY_RECEIPT_TENANT_MISMATCH'), { code: 'AGENCY_RECEIPT_TENANT_MISMATCH' });
    }
    if (!orchestrationPlan || typeof orchestrationPlan !== 'object') {
      throw Object.assign(new Error('ORCHESTRATION_PLAN_REQUIRED'), { code: 'ORCHESTRATION_PLAN_REQUIRED' });
    }
    if (orchestrationPlan.id !== graphId || orchestrationPlan.tenantId !== companyId) {
      throw Object.assign(new Error('ORCHESTRATION_PLAN_BINDING_MISMATCH'), {
        code: 'ORCHESTRATION_PLAN_BINDING_MISMATCH',
      });
    }
    if (orchestrationPlan.status === 'STOPPED') {
      throw Object.assign(new Error('ORCHESTRATION_PLAN_ALREADY_STOPPED'), {
        code: 'ORCHESTRATION_PLAN_ALREADY_STOPPED',
      });
    }
    if (!workPackage || typeof workPackage !== 'object') {
      throw Object.assign(new Error('ORCHESTRATION_WORK_PACKAGE_REQUIRED'), {
        code: 'ORCHESTRATION_WORK_PACKAGE_REQUIRED',
      });
    }
    if (workPackage.status === 'STOPPED') {
      throw Object.assign(new Error('WORK_PACKAGE_ALREADY_STOPPED'), { code: 'WORK_PACKAGE_ALREADY_STOPPED' });
    }
    if (
      workPackage.executionRequestId !== agencyReceipt.executionRequestId ||
      workPackage.lastExecutionReceiptId !== agencyReceipt.id
    ) {
      throw Object.assign(new Error('WORK_PACKAGE_RECEIPT_MISMATCH'), { code: 'WORK_PACKAGE_RECEIPT_MISMATCH' });
    }

    const allowedClasses = new Set(['FIXTURE', 'NATIVE_NONPRODUCTION', 'NATIVE_PRODUCTION']);
    if (!allowedClasses.has(executionClass)) {
      throw Object.assign(new Error('INVALID_EXECUTION_CLASS'), { code: 'INVALID_EXECUTION_CLASS' });
    }
    if (agencyReceipt.executionClass === 'FIXTURE' && executionClass !== 'FIXTURE') {
      throw Object.assign(new Error('FIXTURE_CANNOT_BE_PROMOTED_TO_NATIVE'), {
        code: 'FIXTURE_CANNOT_BE_PROMOTED_TO_NATIVE',
      });
    }

    const scopedPath = assertScopedArtifact(artifactRootDir, artifactPath);
    const artifactDigest = createHash('sha256').update(readFileSync(scopedPath)).digest('hex');

    if (agencyReceipt.outputDigest && agencyReceipt.outputDigest !== artifactDigest) {
      throw Object.assign(new Error('AGENCY_RECEIPT_ARTIFACT_DIGEST_MISMATCH'), {
        code: 'AGENCY_RECEIPT_ARTIFACT_DIGEST_MISMATCH',
      });
    }

    const issuedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ttlMs).toISOString();
    const fields = {
      schemaVersion: 2,
      contract: 'TRUSTED_EXECUTOR_RECEIPT_V2',
      issuerId: this.#issuerId,
      verifiedByExecutor: true,
      graphId,
      companyId,
      projectId,
      requestId,
      roomId,
      callId,
      taskId,
      childRunId,
      authorizationRevision,
      generation,
      artifactDigest,
      executionClass,
      agencyReceiptId: agencyReceipt.id,
      executionRequestId: agencyReceipt.executionRequestId,
      issuedAt,
      expiresAt,
    };
    return this.#sign(fields);
  }

  /**
   * Deterministic fixture-only receipt helper.
   * ALWAYS stamps executionClass = 'FIXTURE'; NEVER allows NATIVE_* without canonical Agency completion.
   */
  issueFixtureReceipt({
    graphId,
    companyId,
    projectId,
    requestId,
    roomId,
    callId,
    taskId,
    childRunId,
    authorizationRevision,
    generation,
    artifactRootDir,
    artifactPath,
    executionClass = 'FIXTURE',
    nowMs = Date.now(),
    ttlMs = 300_000,
  }) {
    if (executionClass !== 'FIXTURE') {
      throw Object.assign(new Error('FIXTURE_ISSUER_CANNOT_MINT_NATIVE_RECEIPT'), {
        code: 'FIXTURE_ISSUER_CANNOT_MINT_NATIVE_RECEIPT',
      });
    }
    const scopedPath = assertScopedArtifact(artifactRootDir, artifactPath);
    const artifactDigest = createHash('sha256').update(readFileSync(scopedPath)).digest('hex');
    const issuedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ttlMs).toISOString();
    const fields = {
      schemaVersion: 2,
      contract: 'TRUSTED_EXECUTOR_RECEIPT_V2',
      issuerId: this.#issuerId,
      verifiedByExecutor: true,
      graphId,
      companyId,
      projectId,
      requestId,
      roomId,
      callId,
      taskId,
      childRunId,
      authorizationRevision,
      generation,
      artifactDigest,
      executionClass: 'FIXTURE',
      agencyReceiptId: `fixture-receipt:${callId}`,
      executionRequestId: `fixture-req:${callId}`,
      issuedAt,
      expiresAt,
    };
    return this.#sign(fields);
  }
}
