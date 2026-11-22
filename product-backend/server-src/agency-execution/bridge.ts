import type { AgencyExecutionReceipt, AgencyExecutionRequest } from './types.js';
import { AgencyExecutionService } from './service.js';

export interface OrchestrationExecutionReference {
  tenantId: string;
  orchestrationPlanId: string;
  workPackageId: string;
}

export interface OrchestrationExecutionResolution {
  agencyActionPlanId: string;
  projectId?: string;
  input?: Record<string, unknown>;
  approvalId?: string;
  capabilityApprovalReferenceId?: string;
}

export interface OrchestrationExecutionAdapter {
  resolveExecution(reference: OrchestrationExecutionReference): Promise<OrchestrationExecutionResolution | null>;
}

export class StarliExecutionLoop {
  constructor(private executor: AgencyExecutionService, private orchestration?: OrchestrationExecutionAdapter) {}

  prepareAgencyAction(input: {
    tenantId: string;
    actionPlanId: string;
    projectId?: string;
    input?: Record<string, unknown>;
    approvalId?: string;
    capabilityApprovalReferenceId?: string;
    requestedBy: string;
  }): AgencyExecutionRequest {
    return this.executor.createRequest(input);
  }

  async prepareOrchestrationWork(reference: OrchestrationExecutionReference, requestedBy: string): Promise<AgencyExecutionRequest> {
    if (!this.orchestration) throw new Error('Orchestration execution adapter unavailable');
    const resolved = await this.orchestration.resolveExecution(reference);
    if (!resolved) throw new Error('Orchestration work package is not executable');
    return this.executor.createRequest({
      tenantId: reference.tenantId,
      actionPlanId: resolved.agencyActionPlanId,
      projectId: resolved.projectId,
      input: resolved.input,
      approvalId: resolved.approvalId,
      capabilityApprovalReferenceId: resolved.capabilityApprovalReferenceId,
      requestedBy
    });
  }

  execute(tenantId: string, requestId: string): Promise<AgencyExecutionReceipt> {
    return this.executor.execute(tenantId, requestId);
  }

  getRequest(tenantId: string, requestId: string) {
    return this.executor.getRequest(tenantId, requestId);
  }

  getReceipt(tenantId: string, requestId: string) {
    return this.executor.getReceipt(tenantId, requestId);
  }

  stop(tenantId: string, requestId: string, reason?: string) {
    return this.executor.stop(tenantId, requestId, reason);
  }
}
