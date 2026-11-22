import type {OrchestrationExecutionAdapter,OrchestrationExecutionReference} from '../agency-execution/bridge.js';
import {StarliOrchestratorService} from './service.js';
export class CanonicalOrchestrationExecutionAdapter implements OrchestrationExecutionAdapter{
 constructor(private orchestrator:StarliOrchestratorService){}
 async resolveExecution(reference:OrchestrationExecutionReference){return this.orchestrator.resolveExecution(reference)}
}
