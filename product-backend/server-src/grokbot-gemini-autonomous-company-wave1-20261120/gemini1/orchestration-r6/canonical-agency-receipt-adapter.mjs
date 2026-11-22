/**
 * StarliDigital R6 Canonical Agency Receipt Adapter
 * Task: GGB1-GEMINI1-ORCHESTRATION-R6 (closes R4-03-NATIVE)
 *
 * Bridges real StarliOrchestratorService + AgencyExecutionReceipt storage into
 * TrustedExecutorReceiptIssuer.issueFromCanonicalCompletion(...) with scoped artifact verification.
 */

export class CanonicalAgencyReceiptAdapter {
  #issuer;
  #orchestrator;
  #agencyReceiptReader;
  #artifactRootDir;

  constructor({ issuer, orchestrator, agencyReceiptReader, artifactRootDir }) {
    if (!issuer || typeof issuer.issueFromCanonicalCompletion !== 'function') {
      throw Object.assign(new Error('TRUSTED_RECEIPT_ISSUER_REQUIRED'), { code: 'TRUSTED_RECEIPT_ISSUER_REQUIRED' });
    }
    if (!orchestrator || typeof orchestrator.getPlan !== 'function') {
      throw Object.assign(new Error('CANONICAL_ORCHESTRATOR_SERVICE_REQUIRED'), {
        code: 'CANONICAL_ORCHESTRATOR_SERVICE_REQUIRED',
      });
    }
    if (!agencyReceiptReader || typeof agencyReceiptReader.getReceipt !== 'function') {
      throw Object.assign(new Error('CANONICAL_AGENCY_RECEIPT_READER_REQUIRED'), {
        code: 'CANONICAL_AGENCY_RECEIPT_READER_REQUIRED',
      });
    }
    if (!artifactRootDir || typeof artifactRootDir !== 'string') {
      throw Object.assign(new Error('ARTIFACT_ROOT_DIR_REQUIRED'), { code: 'ARTIFACT_ROOT_DIR_REQUIRED' });
    }
    this.#issuer = issuer;
    this.#orchestrator = orchestrator;
    this.#agencyReceiptReader = agencyReceiptReader;
    this.#artifactRootDir = artifactRootDir;
  }

  /**
   * Read live canonical OrchestrationPlan, OrchestrationWorkPackage, and AgencyExecutionReceipt,
   * verify completion and scoped artifact integrity, and mint a signed executor receipt.
   */
  issueForCompletedWorkPackage({
    actor,
    graph,
    link,
    workPackageId,
    artifactPath,
    executionClass = 'NATIVE_NONPRODUCTION',
    nowMs = Date.now(),
    ttlMs = 300_000,
  }) {
    if (!actor || !actor.userId || !actor.workspaceTenantId) {
      throw Object.assign(new Error('CANONICAL_ACTOR_REQUIRED'), { code: 'CANONICAL_ACTOR_REQUIRED' });
    }
    const companyId = graph.company_id || graph.companyId;
    const graphId = graph.graph_id || graph.graphId;
    if (actor.workspaceTenantId !== companyId) {
      throw Object.assign(new Error('CANONICAL_TENANT_MISMATCH'), { code: 'CANONICAL_TENANT_MISMATCH' });
    }

    const orchActor = {
      workspaceTenantId: companyId,
      userId: actor.userId,
      role: actor.role,
    };
    const plan = this.#orchestrator.getPlan(orchActor, graphId);
    const pkgId = workPackageId || link.task_id || link.taskId;
    const workPackage = (plan?.workPackages || []).find((p) => p.id === pkgId);
    if (!workPackage) {
      throw Object.assign(new Error('CANONICAL_WORK_PACKAGE_NOT_FOUND'), {
        code: 'CANONICAL_WORK_PACKAGE_NOT_FOUND',
      });
    }
    if (!workPackage.lastExecutionReceiptId) {
      throw Object.assign(new Error('CANONICAL_AGENCY_RECEIPT_MISSING_ON_PACKAGE'), {
        code: 'CANONICAL_AGENCY_RECEIPT_MISSING_ON_PACKAGE',
      });
    }

    const agencyReceipt = this.#agencyReceiptReader.getReceipt(companyId, workPackage.lastExecutionReceiptId);
    if (!agencyReceipt) {
      throw Object.assign(new Error('CANONICAL_AGENCY_RECEIPT_NOT_FOUND'), {
        code: 'CANONICAL_AGENCY_RECEIPT_NOT_FOUND',
      });
    }

    return this.#issuer.issueFromCanonicalCompletion({
      agencyReceipt,
      orchestrationPlan: plan,
      workPackage,
      artifactRootDir: this.#artifactRootDir,
      artifactPath,
      graphId,
      companyId,
      projectId: graph.project_id || graph.projectId,
      requestId: graph.request_id || graph.requestId,
      roomId: link.child_room_id || link.childRoomId,
      callId: link.call_id || link.callId,
      taskId: link.task_id || link.taskId,
      childRunId: link.child_run_id || link.childRunId,
      authorizationRevision: graph.authorization_revision ?? graph.authorizationRevision,
      generation: graph.generation,
      executionClass,
      nowMs,
      ttlMs,
    });
  }
}
