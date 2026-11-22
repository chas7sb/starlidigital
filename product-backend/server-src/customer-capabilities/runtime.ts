import { randomUUID } from 'node:crypto';
import type { Store } from '../store.js';
import { CreativeProjectService } from '../creative-projects/service.js';
import type { BackendSummary, CustomerCapabilityAdapters } from './types.js';
import { StoreCapabilityStateRepository } from './store.js';
import { CustomerCapabilityRegistry } from './registry.js';
import { registerStarterCapabilities } from './starter.js';
import { CustomerCapabilityGateway } from './gateway.js';
import { CustomerConnectorRegistry } from './connectors/registry.js';

const safeEndpoint=(value:unknown)=>{try{const url=new URL(String(value||''));return url.protocol==='https:'?url.toString():null;}catch{return null;}};
const runtimeLifecycle=(state:string):BackendSummary['lifecycle']=>state==='VALIDATED'?'VALIDATING':state==='STAGED'?'BUILDING':(['DRAFT','BUILDING','READY','DEPLOYING','LIVE','BLOCKED','NEEDS_REVIEW','FAILED','ROLLED_BACK'].includes(state)?state:'DRAFT') as BackendSummary['lifecycle'];

export class CustomerCapabilityRuntime {
  readonly generation='customer-capability-runtime/v1' as const;
  readonly runtimeIdentity=randomUUID();
  private _schemaIdentity:string|null=null;
  readonly creative: CreativeProjectService;
  readonly state: StoreCapabilityStateRepository;
  readonly registry: CustomerCapabilityRegistry;
  readonly gateway: CustomerCapabilityGateway;
  readonly connectorRegistry: CustomerConnectorRegistry;
  readonly adapters: CustomerCapabilityAdapters;

  constructor(readonly store: Store, options: { clock?: () => Date } = {}) {
    this.creative=new CreativeProjectService(store);
    this.state=new StoreCapabilityStateRepository(store);
    this.connectorRegistry=new CustomerConnectorRegistry();
    this.adapters={
      readProject:async({tenantId,projectId,subjectId})=>{
        if(tenantId!==subjectId)return{available:false,reason:'Project tenant mismatch'};
        try{
          const project=this.creative.getProject({tenantId,ownerId:subjectId},projectId);
          return{available:true,data:{id:project.id,title:project.title,goal:project.goal.summary,status:project.status,updatedAt:project.updatedAt},trust:'TRUSTED_TENANT_DATA'};
        }catch{
          const project=this.ownedLegacy(subjectId,projectId);
          if(!project)return{available:false,reason:'Project not found'};
          return{available:true,data:{id:String(project.id),name:String(project.name||'Website project'),status:String(project.status||'DRAFT'),deploymentStatus:project.deploymentStatus?String(project.deploymentStatus):null,hasDeployment:!!project.deploymentUrl,updatedAt:String(project.updatedAt||project.createdAt)},trust:'TRUSTED_TENANT_DATA'};
        }
      },
      readArtifact:async({tenantId,projectId,artifactId,subjectId})=>{
        if(tenantId!==subjectId)return{available:false,reason:'Artifact tenant mismatch'};
        try{
          const artifact=this.creative.getArtifact({tenantId,ownerId:subjectId},artifactId);
          if(artifact.projectId!==projectId)return{available:false,reason:'Artifact belongs to another project'};
          return{available:true,data:{id:artifact.id,projectId:artifact.projectId,kind:artifact.kind,name:artifact.name,status:artifact.status,backend:artifact.backend,updatedAt:artifact.updatedAt},trust:'TRUSTED_TENANT_DATA'};
        }catch{return{available:false,reason:'Artifact not found'};}
      },
      readBackendSummary:async({tenantId,projectId,backendProjectId,subjectId})=>{
        if(tenantId!==subjectId)return{available:false,reason:'Backend tenant mismatch'};
        if(!this.ownsProject(subjectId,projectId))return{available:false,reason:'Project not found'};
        const summary=this.backendSummary(tenantId,projectId,backendProjectId);
        return summary?{available:true,data:summary,trust:'TRUSTED_TENANT_DATA'}:{available:false,reason:'No managed backend is linked to this project'};
      }
    };
    this.registry=new CustomerCapabilityRegistry();
    registerStarterCapabilities(this.registry,this.adapters);
    this.gateway=new CustomerCapabilityGateway(this.registry,this.state,options.clock);
  }

  bindSchemaIdentity(schemaIdentity:string){const id=String(schemaIdentity||'').trim();if(!/^[A-Za-z0-9_.:-]{8,160}$/.test(id))throw new Error('Invalid capability schema identity.');if(this._schemaIdentity&&this._schemaIdentity!==id)throw new Error('Customer capability runtime already bound to another schema instance.');this._schemaIdentity=id;return this;}
  get schemaIdentity(){return this._schemaIdentity;}

  ownsProject(userId:string,projectId:string):boolean{
    if(this.ownedLegacy(userId,projectId))return true;
    try{this.creative.getProject({tenantId:userId,ownerId:userId},projectId);return true;}catch{return false;}
  }

  projectCatalog(userId:string){
    const creativeRows=this.creative.listProjects({tenantId:userId,ownerId:userId},{limit:50}).items.map(project=>({id:project.id,name:project.title,kind:'CREATIVE',status:project.status,updatedAt:project.updatedAt}));
    const legacy=this.store.list('projects',userId).slice(0,50).map(project=>({id:String(project.id),name:String(project.name||'Website project'),kind:'WEBSITE',status:String(project.status||'DRAFT'),updatedAt:String(project.updatedAt||project.createdAt||new Date().toISOString())}));
    const seen=new Set<string>();
    return [...creativeRows,...legacy].filter(project=>!seen.has(project.id)&&seen.add(project.id)).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,75);
  }

  private ownedLegacy(userId:string,projectId:string){const row=this.store.get('projects',projectId);return row&&row.ownerId===userId?row:undefined;}

  private backendSummary(tenantId:string,projectId:string,backendProjectId?:string):BackendSummary|undefined{
    const rows=(this.store.list('backend-runtime-deployments',tenantId) as any[]).filter(row=>row.tenantId===tenantId&&(String(row.projectId)===projectId||backendProjectId&&String(row.projectId)===backendProjectId)).sort((a,b)=>Date.parse(String(b.updatedAt||b.createdAt))-Date.parse(String(a.updatedAt||a.createdAt)));
    const row=rows[0];if(!row)return undefined;
    const release=this.store.get('backend-runtime-releases',String(row.releaseId)),spec=this.store.get('backend-runtime-specifications',String(row.deploymentId));
    return{backendProjectId:String(row.projectId),serviceId:String(row.serviceId),name:'Managed backend',stack:'NODE_EXPRESS_PRISMA',environment:row.environment==='PRODUCTION'?'PRODUCTION':'STAGING',lifecycle:runtimeLifecycle(String(row.state||'DRAFT')),versionId:release?.versionId?String(release.versionId):null,endpoint:row.state==='LIVE'?safeEndpoint(row.endpointRef):null,health:['HEALTHY','UNHEALTHY'].includes(String(row.healthStatus))?row.healthStatus:'UNKNOWN',readiness:['READY','NOT_READY'].includes(String(row.readinessStatus))?row.readinessStatus:'UNKNOWN',database:spec?.databaseBinding?{engine:'POSTGRESQL',status:'BOUND'}:null,migrationRisk:['SAFE_ADDITIVE','REVIEW_REQUIRED','BLOCKED'].includes(String(row.migrationRisk))?row.migrationRisk:null,updatedAt:String(row.updatedAt||row.createdAt)} as BackendSummary;
  }
}

export function createCustomerCapabilityRuntime(options:{store:Store;clock?:()=>Date}){
  return new CustomerCapabilityRuntime(options.store,{clock:options.clock});
}
