import {MachineryPreflightService} from '../business-engine/machinery-preflight.js';
import type {Events} from '../events.js';
import type {Store} from '../store.js';
import {AutonomyPolicyService} from '../autonomy-policy/service.js';
import type {CustomerCapabilityRuntime} from '../customer-capabilities/runtime.js';
import {AgencyExecutionService} from '../agency-execution/service.js';
import {StarliExecutionLoop} from '../agency-execution/bridge.js';
import {CanonicalStarliExecutionConsumer} from '../agency-execution/canonical-consumer.js';
import {StarliOrchestratorService} from '../starli-orchestrator/service.js';
import {CanonicalOrchestrationExecutionAdapter} from '../starli-orchestrator/execution-adapter.js';
import {MachineryRunService} from './service.js';
import {MachineryRunExecutionDriver} from './execution-driver.js';

export interface CanonicalMachineryExecutionRuntime {
  capabilityRuntime: CustomerCapabilityRuntime;
  autonomyPolicy: AutonomyPolicyService;
  orchestrator: StarliOrchestratorService;
  agencyExecution: AgencyExecutionService;
  orchestrationAdapter: CanonicalOrchestrationExecutionAdapter;
  executionLoop: StarliExecutionLoop;
  executionConsumer: CanonicalStarliExecutionConsumer;
  machineryRuns: MachineryRunService;
  machineryDriver: MachineryRunExecutionDriver;
}

export function createCanonicalMachineryExecutionRuntime(options:{
  store:Store;
  events?:Events;
  customerCapabilityRuntime:CustomerCapabilityRuntime;
  clockMs?:()=>number;
}):CanonicalMachineryExecutionRuntime{
  const {store,events,customerCapabilityRuntime}=options;
  if(customerCapabilityRuntime.store!==store)throw new Error('Customer capability runtime store mismatch.');
  const clockMs=options.clockMs??(()=>Date.now());
  const autonomyPolicy=new AutonomyPolicyService(store,events);
  const orchestrator=new StarliOrchestratorService(store,events,clockMs);
  const agencyExecution=new AgencyExecutionService(store,customerCapabilityRuntime.gateway,customerCapabilityRuntime.registry,autonomyPolicy,events,clockMs);
  const orchestrationAdapter=new CanonicalOrchestrationExecutionAdapter(orchestrator);
  const executionLoop=new StarliExecutionLoop(agencyExecution,orchestrationAdapter);
  const executionConsumer=new CanonicalStarliExecutionConsumer(orchestrator,executionLoop);
  const machineryRuns=new MachineryRunService(store,undefined,events,clockMs);
  const machineryDriver=new MachineryRunExecutionDriver(machineryRuns,orchestrator,executionConsumer,new MachineryPreflightService(store));
  return{capabilityRuntime:customerCapabilityRuntime,autonomyPolicy,orchestrator,agencyExecution,orchestrationAdapter,executionLoop,executionConsumer,machineryRuns,machineryDriver};
}
