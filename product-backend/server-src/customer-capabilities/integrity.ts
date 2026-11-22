import type {CanonicalMachineryExecutionRuntime} from '../machinery-run/runtime.js';
import type {CustomerCapabilityRuntime} from './runtime.js';
import type {IntegrationConnectionStatus} from './types.js';

const CONNECTION_STATES: readonly IntegrationConnectionStatus[]=['CONFIGURATION_NEEDED','DISCONNECTED','CONNECTING','CONNECTED','DEGRADED','REAUTH_REQUIRED','REVOKED','ERROR'];

export interface CustomerCapabilityRuntimeIntegrityProjection {
  schemaVersion: 1;
  status: 'PASS'|'BLOCKED';
  generation: string;
  runtimeIdentity: string;
  schemaIdentity: string|null;
  sharedIdentity: {runtime:boolean;registry:boolean;state:boolean;gateway:boolean};
  capabilities: {count:number;ids:string[]};
  connectorProviders: {count:number;liveAuthAvailable:number;metadataOnly:number};
  tenantConnections: {count:number;byStatus:Record<IntegrationConnectionStatus,number>;hasMore:boolean}|null;
}

export function projectCustomerCapabilityRuntimeIntegrity(options:{
  schemaRuntime:CustomerCapabilityRuntime;
  machineryRuntime:CanonicalMachineryExecutionRuntime;
  tenantId?:string;
}):CustomerCapabilityRuntimeIntegrityProjection{
  const {schemaRuntime,machineryRuntime}=options;
  const machineryCapabilityRuntime=machineryRuntime.capabilityRuntime;
  const sharedIdentity={
    runtime:machineryCapabilityRuntime===schemaRuntime,
    registry:machineryCapabilityRuntime.registry===schemaRuntime.registry,
    state:machineryCapabilityRuntime.state===schemaRuntime.state,
    gateway:machineryCapabilityRuntime.gateway===schemaRuntime.gateway
  };
  const ids=schemaRuntime.registry.list().map(item=>item.id).sort().slice(0,100);
  const providers=schemaRuntime.connectorRegistry.listProviders().slice(0,100);
  let tenantConnections:CustomerCapabilityRuntimeIntegrityProjection['tenantConnections']=null;
  if(options.tenantId){
    const tenantId=String(options.tenantId).trim();
    if(!/^[A-Za-z0-9_.:-]{1,220}$/.test(tenantId))throw new Error('Invalid capability integrity tenant identity.');
    const byStatus=Object.fromEntries(CONNECTION_STATES.map(state=>[state,0])) as Record<IntegrationConnectionStatus,number>;
    const rows=schemaRuntime.store.db.prepare('SELECT payload FROM records WHERE collection=? AND owner=? LIMIT 101').all('customer-capability-connections',tenantId).map(row=>JSON.parse(String((row as any).payload)));
    const hasMore=rows.length>100;let count=0;
    for(const row of rows.slice(0,100)){
      if(row.tenantId!==tenantId||!CONNECTION_STATES.includes(row.status as IntegrationConnectionStatus))continue;
      byStatus[row.status as IntegrationConnectionStatus]++;count++;
    }
    tenantConnections={count,byStatus,hasMore};
  }
  return{
    schemaVersion:1,
    status:Object.values(sharedIdentity).every(Boolean)&&!!schemaRuntime.schemaIdentity?'PASS':'BLOCKED',
    generation:schemaRuntime.generation,
    runtimeIdentity:schemaRuntime.runtimeIdentity,
    schemaIdentity:schemaRuntime.schemaIdentity,
    sharedIdentity,
    capabilities:{count:ids.length,ids},
    connectorProviders:{count:providers.length,liveAuthAvailable:providers.filter(item=>item.liveAuthAvailable).length,metadataOnly:providers.filter(item=>item.implementationStatus==='METADATA_ONLY').length},
    tenantConnections
  };
}

export function assertSharedCustomerCapabilityRuntime(options:{schemaRuntime:CustomerCapabilityRuntime;machineryRuntime:CanonicalMachineryExecutionRuntime}){
  const projection=projectCustomerCapabilityRuntimeIntegrity(options);
  if(projection.status!=='PASS')throw new Error('CUSTOMER_CAPABILITY_RUNTIME_DIVERGENCE');
  return projection;
}
