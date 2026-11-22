/**
 * StarliDigital R6 Canonical Orchestration Registration Adapter
 * Task: GGB1-GEMINI1-ORCHESTRATION-R6 (closes R4-07-NATIVE)
 *
 * Reads actual MachineryRunService, StarliOrchestratorService, and tenant room-ownership records
 * to authorize graph & delegation link registration BEFORE SQLite INSERT.
 * Omitted or unavailable canonical services fail closed.
 */

export class CanonicalOrchestrationRegistrationAdapter {
  #machineryRuns;
  #orchestrator;
  #roomDirectory;

  constructor({ machineryRuns, orchestrator, roomDirectory }) {
    if (!machineryRuns || typeof machineryRuns.getRun !== 'function') {
      throw Object.assign(new Error('CANONICAL_MACHINERY_SERVICE_REQUIRED'), {
        code: 'CANONICAL_MACHINERY_SERVICE_REQUIRED',
      });
    }
    if (!orchestrator || typeof orchestrator.getPlan !== 'function') {
      throw Object.assign(new Error('CANONICAL_ORCHESTRATOR_SERVICE_REQUIRED'), {
        code: 'CANONICAL_ORCHESTRATOR_SERVICE_REQUIRED',
      });
    }
    if (!roomDirectory || typeof roomDirectory.ownsRoom !== 'function') {
      throw Object.assign(new Error('CANONICAL_ROOM_DIRECTORY_REQUIRED'), {
        code: 'CANONICAL_ROOM_DIRECTORY_REQUIRED',
      });
    }
    this.#machineryRuns = machineryRuns;
    this.#orchestrator = orchestrator;
    this.#roomDirectory = roomDirectory;
  }

  /**
   * Verify that graph registration matches actual canonical MachineryRunRecord,
   * OrchestrationPlan, and tenant room ownership.
   */
  verifyGraphRegistration(graph, actor) {
    if (!actor || !actor.userId || !actor.workspaceTenantId) {
      throw Object.assign(new Error('CANONICAL_ACTOR_REQUIRED'), { code: 'CANONICAL_ACTOR_REQUIRED' });
    }
    if (!graph.machineryRunId || typeof graph.machineryRunId !== 'string') {
      throw Object.assign(new Error('MACHINERY_RUN_ID_REQUIRED'), { code: 'MACHINERY_RUN_ID_REQUIRED' });
    }

    const run = this.#machineryRuns.getRun(actor, graph.machineryRunId);
    if (!run || run.id !== graph.machineryRunId) {
      throw Object.assign(new Error('CANONICAL_MACHINERY_RUN_NOT_FOUND'), {
        code: 'CANONICAL_MACHINERY_RUN_NOT_FOUND',
      });
    }
    if (run.tenantId !== graph.companyId || actor.workspaceTenantId !== graph.companyId) {
      throw Object.assign(new Error('CANONICAL_TENANT_MISMATCH'), { code: 'CANONICAL_TENANT_MISMATCH' });
    }
    const selectedPlanIds = (run.selections || []).map((s) => s.orchestrationPlanId);
    if (!selectedPlanIds.includes(graph.graphId)) {
      throw Object.assign(new Error('PLAN_NOT_SELECTED_IN_MACHINERY_RUN'), {
        code: 'PLAN_NOT_SELECTED_IN_MACHINERY_RUN',
      });
    }

    const orchActor = {
      workspaceTenantId: run.tenantId,
      userId: actor.userId,
      role: actor.role,
    };
    const plan = this.#orchestrator.getPlan(orchActor, graph.graphId);
    if (!plan || plan.id !== graph.graphId || plan.tenantId !== graph.companyId) {
      throw Object.assign(new Error('CANONICAL_PLAN_MISMATCH'), { code: 'CANONICAL_PLAN_MISMATCH' });
    }
    if (plan.status === 'STOPPED') {
      throw Object.assign(new Error('CANONICAL_PLAN_ALREADY_STOPPED'), { code: 'CANONICAL_PLAN_ALREADY_STOPPED' });
    }
    if (graph.revision !== undefined && plan.revision !== undefined && Number(plan.revision) !== Number(graph.revision)) {
      throw Object.assign(new Error('CANONICAL_PLAN_REVISION_MISMATCH'), {
        code: 'CANONICAL_PLAN_REVISION_MISMATCH',
      });
    }

    if (this.#roomDirectory.ownsRoom(graph.companyId, graph.parentRoomId) !== true) {
      throw Object.assign(new Error('PARENT_ROOM_NOT_OWNED_BY_TENANT'), {
        code: 'PARENT_ROOM_NOT_OWNED_BY_TENANT',
      });
    }
    return true;
  }

  /**
   * Verify that a delegation link belongs to the same tenant, parent run, owned child room,
   * and an actual work package in the canonical OrchestrationPlan.
   */
  verifyDelegationLinkRegistration(link, graph, actor) {
    if (!actor || !actor.userId || !actor.workspaceTenantId) {
      throw Object.assign(new Error('CANONICAL_ACTOR_REQUIRED'), { code: 'CANONICAL_ACTOR_REQUIRED' });
    }
    if (link.childCompanyId !== graph.company_id || actor.workspaceTenantId !== graph.company_id) {
      throw Object.assign(new Error('CROSS_TENANT_DELEGATION_DENIED'), {
        code: 'CROSS_TENANT_DELEGATION_DENIED',
      });
    }
    if (link.parentRunId !== graph.parent_run_id) {
      throw Object.assign(new Error('UNRELATED_PARENT_RUN_DENIED'), {
        code: 'UNRELATED_PARENT_RUN_DENIED',
      });
    }
    if (this.#roomDirectory.ownsRoom(graph.company_id, link.childRoomId) !== true) {
      throw Object.assign(new Error('CHILD_ROOM_NOT_OWNED_BY_TENANT'), {
        code: 'CHILD_ROOM_NOT_OWNED_BY_TENANT',
      });
    }

    const orchActor = {
      workspaceTenantId: graph.company_id,
      userId: actor.userId,
      role: actor.role,
    };
    const plan = this.#orchestrator.getPlan(orchActor, graph.graph_id);
    if (!plan || plan.tenantId !== graph.company_id) {
      throw Object.assign(new Error('CANONICAL_PLAN_MISMATCH'), { code: 'CANONICAL_PLAN_MISMATCH' });
    }
    if (plan.status === 'STOPPED') {
      throw Object.assign(new Error('CANONICAL_PLAN_ALREADY_STOPPED'), { code: 'CANONICAL_PLAN_ALREADY_STOPPED' });
    }

    const pkgId = link.workPackageId || link.taskId;
    const pkg = (plan.workPackages || []).find((p) => p.id === pkgId);
    if (!pkg) {
      throw Object.assign(new Error('CANONICAL_WORK_PACKAGE_NOT_FOUND'), {
        code: 'CANONICAL_WORK_PACKAGE_NOT_FOUND',
      });
    }
    if (pkg.status === 'STOPPED') {
      throw Object.assign(new Error('CANONICAL_WORK_PACKAGE_ALREADY_STOPPED'), {
        code: 'CANONICAL_WORK_PACKAGE_ALREADY_STOPPED',
      });
    }
    return true;
  }
}
