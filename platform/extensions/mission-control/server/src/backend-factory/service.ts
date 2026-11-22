import {randomUUID} from 'node:crypto';
import type {Store,RecordData} from '../store.js';
import {now} from '../store.js';
import type {
  BackendActor,BackendBuild,BackendBuildState,BackendFactoryEventSink,BackendProject,BackendRuntimeHandoff,BackendService,
  BackendSpecification,BackendVersion,DatabaseBinding,EnvironmentRequirement,MigrationPlan,MigrationRisk,RuntimePolicy
} from './domain.js';
import {BACKEND_BUILD_STATES,BACKEND_TEMPLATE_VERSION} from './domain.js';
import {DEFAULT_ENVIRONMENT_REQUIREMENTS,DEFAULT_RUNTIME_POLICY,sanitizeText,sha256,specificationHash,stableJson,validateSpecification} from './policy.js';
import {generateStarterBackend,releaseFileManifest,sourceHash,validateGeneratedSource} from './generator.js';

export const BACKEND_COLLECTIONS={
  projects:'backend-factory-projects',
  services:'backend-factory-services',
  versions:'backend-factory-versions',
  builds:'backend-factory-builds',
  databases:'backend-factory-databases',
  migrations:'backend-factory-migrations',
  idempotency:'backend-factory-idempotency'
} as const;
const PROJECT_NAME=/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/;
const SAFE_KEY=/^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_REF=/^[A-Za-z0-9_.:/-]{1,240}$/;
const BUILD_TRANSITIONS:Record<BackendBuildState,BackendBuildState[]>={
  DRAFT:['VALIDATED','BLOCKED'],VALIDATED:['BUILDING','BLOCKED'],BUILDING:['SUCCEEDED','FAILED','NEEDS_REVIEW'],
  SUCCEEDED:[],FAILED:['BUILDING'],BLOCKED:['DRAFT'],NEEDS_REVIEW:['BUILDING','BLOCKED']
};
type OwnedTenantRecord={ownerId:string;tenantId:string};
type IdempotencyRecord=RecordData&OwnedTenantRecord&{scope:string;key:string;fingerprint:string;resultId:string;createdAt:string};

export class BackendFactoryService{
  constructor(private store:Store,private events?:BackendFactoryEventSink){}
  private tenant(actor:BackendActor){return actor.workspaceTenantId||actor.userId;}
  private authorize(actor:BackendActor,record:OwnedTenantRecord){
    if(actor.role==='ADMIN')return;
    if(record.ownerId!==actor.userId||record.tenantId!==this.tenant(actor))throw new Error('Backend project access denied.');
  }
  private project(actor:BackendActor,id:string):BackendProject{
    const record=this.store.get(BACKEND_COLLECTIONS.projects,id) as BackendProject|undefined;
    if(!record)throw new Error('Backend project not found.');this.authorize(actor,record);return record;
  }
  private emit(type:string,project:BackendProject,payload:Record<string,string|number|boolean|null>={}){
    try{this.events?.emit({type,source:'backend-factory',occurredAt:now(),entities:[{kind:'backend_project',id:project.id},{kind:'backend_service',id:project.serviceId}],payload});}catch{}
  }
  private idem(actor:BackendActor,scope:string,key:string,fingerprint:string):string|undefined{
    if(!SAFE_KEY.test(key))throw new Error('Invalid idempotency key.');
    const tenantId=this.tenant(actor),id=`${actor.userId}:${tenantId}:${scope}:${key}`;
    const old=this.store.get(BACKEND_COLLECTIONS.idempotency,id) as IdempotencyRecord|undefined;
    if(!old)return undefined;
    if(old.ownerId!==actor.userId||old.tenantId!==tenantId||old.fingerprint!==fingerprint)throw new Error('Idempotency key conflict.');
    return old.resultId;
  }
  private saveIdem(actor:BackendActor,scope:string,key:string,fingerprint:string,resultId:string){
    const tenantId=this.tenant(actor),id=`${actor.userId}:${tenantId}:${scope}:${key}`;
    this.store.put(BACKEND_COLLECTIONS.idempotency,{id,ownerId:actor.userId,tenantId,scope,key,fingerprint,resultId,createdAt:now()},actor.userId);
  }
  createBackendProject(actor:BackendActor,input:{name:string;idempotencyKey:string}):BackendProject{
    const name=sanitizeText(input.name,80);if(!PROJECT_NAME.test(name))throw new Error('Backend project name contains unsupported characters.');
    const tenantId=this.tenant(actor),fingerprint=sha256(stableJson({tenantId,name})),existingId=this.idem(actor,'create-project',input.idempotencyKey,fingerprint);
    if(existingId)return this.project(actor,existingId);
    const createdAt=now(),id=randomUUID(),serviceId=randomUUID();
    const project:BackendProject={id,tenantId,ownerId:actor.userId,name,status:'DRAFT',specification:null,specificationHash:null,serviceId,createdAt,updatedAt:createdAt};
    const service:BackendService={id:serviceId,tenantId,ownerId:actor.userId,backendProjectId:id,runtimePolicy:{...DEFAULT_RUNTIME_POLICY},databaseBindingId:null,currentVersionId:null,createdAt,updatedAt:createdAt};
    this.store.db.exec('BEGIN IMMEDIATE');
    try{this.store.put(BACKEND_COLLECTIONS.projects,project,actor.userId);this.store.put(BACKEND_COLLECTIONS.services,service,actor.userId);this.saveIdem(actor,'create-project',input.idempotencyKey,fingerprint,id);this.store.db.exec('COMMIT');}
    catch(error){this.store.db.exec('ROLLBACK');throw error;}
    this.emit('backend.project.created',project,{status:project.status});return project;
  }
  listBackendProjects(actor:BackendActor):BackendProject[]{
    const rows=this.store.list(BACKEND_COLLECTIONS.projects,actor.role==='ADMIN'?undefined:actor.userId) as BackendProject[];
    return rows.filter(row=>actor.role==='ADMIN'||(row.ownerId===actor.userId&&row.tenantId===this.tenant(actor))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  getBackendProject(actor:BackendActor,id:string):BackendProject{return this.project(actor,id);}
  getBackendService(actor:BackendActor,projectId:string):BackendService{
    const project=this.project(actor,projectId),service=this.store.get(BACKEND_COLLECTIONS.services,project.serviceId) as BackendService|undefined;
    if(!service)throw new Error('Backend service not found.');this.authorize(actor,service);return service;
  }
  saveBackendSpecification(actor:BackendActor,projectId:string,input:unknown):BackendProject{
    const project=this.project(actor,projectId),specification=validateSpecification(input),hash=specificationHash(specification);
    const updated:BackendProject={...project,specification,specificationHash:hash,status:'SPECIFIED',updatedAt:now()};
    this.store.put(BACKEND_COLLECTIONS.projects,updated,project.ownerId);this.emit('backend.specification.saved',updated,{modelCount:specification.models.length,specificationHash:hash.slice(0,16)});return updated;
  }
  validateBackendSpecification(_actor:BackendActor,input:unknown):BackendSpecification{return validateSpecification(input);}
  generateStarterSource(actor:BackendActor,projectId:string){
    const project=this.project(actor,projectId);if(!project.specification)throw new Error('Backend specification is required.');
    const files=generateStarterBackend(project.specification),validation=validateGeneratedSource(files);if(!validation.valid)throw new Error('Generated backend did not pass static validation.');
    return{files,validation,sourceHash:sourceHash(files),environmentRequirements:[...DEFAULT_ENVIRONMENT_REQUIREMENTS]};
  }
  createVersion(actor:BackendActor,projectId:string,input:{idempotencyKey:string}):BackendVersion{
    const project=this.project(actor,projectId);if(!project.specification||!project.specificationHash)throw new Error('Backend specification is required.');
    const generated=this.generateStarterSource(actor,projectId),fingerprint=sha256(stableJson({tenantId:project.tenantId,projectId,specificationHash:project.specificationHash,sourceHash:generated.sourceHash}));
    const existingId=this.idem(actor,`version:${projectId}`,input.idempotencyKey,fingerprint);
    if(existingId){const old=this.store.get(BACKEND_COLLECTIONS.versions,existingId) as BackendVersion|undefined;if(!old)throw new Error('Idempotent backend version is unavailable.');this.authorize(actor,old);return old;}
    const prior=this.listVersions(actor,projectId),version:BackendVersion={id:randomUUID(),tenantId:project.tenantId,ownerId:project.ownerId,backendProjectId:project.id,ordinal:prior.length+1,specificationHash:project.specificationHash,sourceHash:generated.sourceHash,templateVersion:BACKEND_TEMPLATE_VERSION,specification:project.specification,files:generated.files,createdAt:now()};
    const service=this.getBackendService(actor,projectId),updatedProject:BackendProject={...project,status:'VERSIONED',updatedAt:now()};
    this.store.db.exec('BEGIN IMMEDIATE');
    try{this.store.put(BACKEND_COLLECTIONS.versions,version,project.ownerId);this.store.put(BACKEND_COLLECTIONS.projects,updatedProject,project.ownerId);this.store.put(BACKEND_COLLECTIONS.services,{...service,currentVersionId:version.id,updatedAt:now()},service.ownerId);this.saveIdem(actor,`version:${projectId}`,input.idempotencyKey,fingerprint,version.id);this.store.db.exec('COMMIT');}
    catch(error){this.store.db.exec('ROLLBACK');throw error;}
    this.emit('backend.version.created',updatedProject,{ordinal:version.ordinal,sourceHash:version.sourceHash.slice(0,16)});return version;
  }
  listVersions(actor:BackendActor,projectId:string):BackendVersion[]{
    const project=this.project(actor,projectId);return (this.store.list(BACKEND_COLLECTIONS.versions,project.ownerId) as BackendVersion[]).filter(version=>version.backendProjectId===projectId&&version.tenantId===project.tenantId).sort((a,b)=>a.ordinal-b.ordinal);
  }
  staticValidateVersion(actor:BackendActor,versionId:string){
    const version=this.store.get(BACKEND_COLLECTIONS.versions,versionId) as BackendVersion|undefined;if(!version)throw new Error('Backend version not found.');this.authorize(actor,version);return validateGeneratedSource(version.files);
  }
  createMigrationPlan(actor:BackendActor,projectId:string,input:{toVersionId:string;fromVersionId?:string|null}):MigrationPlan{
    const project=this.project(actor,projectId),target=this.store.get(BACKEND_COLLECTIONS.versions,input.toVersionId) as BackendVersion|undefined;
    if(!target||target.backendProjectId!==projectId)throw new Error('Migration target version not found.');this.authorize(actor,target);
    let previous:BackendSpecification|undefined,fromVersionId:string|null=null;
    if(input.fromVersionId){const version=this.store.get(BACKEND_COLLECTIONS.versions,input.fromVersionId) as BackendVersion|undefined;if(!version||version.backendProjectId!==projectId)throw new Error('Migration source version not found.');this.authorize(actor,version);previous=version.specification;fromVersionId=version.id;}
    const operations:string[]=[];let risk:MigrationRisk='SAFE_ADDITIVE';const before=new Map((previous?.models||[]).map(model=>[model.name,model])),after=new Map(target.specification.models.map(model=>[model.name,model]));
    for(const [name,model] of after){const old=before.get(name);if(!old){operations.push(`ADD_MODEL ${name}`);continue;}const oldFields=new Map(old.fields.map(field=>[field.name,field]));for(const field of model.fields){const prior=oldFields.get(field.name);if(!prior){operations.push(`ADD_FIELD ${name}.${field.name}${field.required?' REQUIRED':''}`);if(field.required)risk='REVIEW_REQUIRED';}else if(prior.type!==field.type||prior.required!==field.required){operations.push(`CHANGE_FIELD ${name}.${field.name}`);risk='REVIEW_REQUIRED';}}for(const field of old.fields)if(!model.fields.some(candidate=>candidate.name===field.name)){operations.push(`REMOVE_FIELD ${name}.${field.name}`);risk='REVIEW_REQUIRED';}}
    for(const name of before.keys())if(!after.has(name)){operations.push(`REMOVE_MODEL ${name}`);risk='REVIEW_REQUIRED';}
    if(operations.length>100)risk='BLOCKED';
    const plan:MigrationPlan={id:randomUUID(),tenantId:project.tenantId,ownerId:project.ownerId,backendProjectId:projectId,fromVersionId,toVersionId:target.id,toSpecificationHash:target.specificationHash,risk,operations,requiresApproval:risk!=='SAFE_ADDITIVE',createdAt:now()};
    this.store.put(BACKEND_COLLECTIONS.migrations,plan,project.ownerId);this.emit('backend.migration.planned',project,{migrationPlanId:plan.id,risk,operationCount:operations.length,requiresApproval:plan.requiresApproval});if(risk==='BLOCKED')this.emit('backend.migration.blocked',project,{migrationPlanId:plan.id,risk,operationCount:operations.length});return plan;
  }
  createDatabaseBinding(actor:BackendActor,projectId:string,bindingRef:string):DatabaseBinding{
    const project=this.project(actor,projectId);if(!SAFE_REF.test(bindingRef)||bindingRef.includes('@')||bindingRef.includes('?')||/postgres(?:ql)?:\/\//i.test(bindingRef))throw new Error('Database binding must be an opaque secret reference, not credentials.');
    const existing=(this.store.list(BACKEND_COLLECTIONS.databases,project.ownerId) as DatabaseBinding[]).find(binding=>binding.backendProjectId===projectId&&binding.tenantId===project.tenantId&&binding.bindingRef===bindingRef);if(existing)return existing;
    const createdAt=now(),binding:DatabaseBinding={id:randomUUID(),tenantId:project.tenantId,ownerId:project.ownerId,backendProjectId:projectId,engine:'POSTGRESQL',bindingRef,status:'PLANNED',createdAt,updatedAt:createdAt};
    this.store.put(BACKEND_COLLECTIONS.databases,binding,project.ownerId);const service=this.getBackendService(actor,projectId);this.store.put(BACKEND_COLLECTIONS.services,{...service,databaseBindingId:binding.id,updatedAt:now()},service.ownerId);return binding;
  }
  runtimePolicy(actor:BackendActor,projectId:string):RuntimePolicy{return this.getBackendService(actor,projectId).runtimePolicy;}
  environmentRequirements(actor:BackendActor,projectId:string):EnvironmentRequirement[]{this.project(actor,projectId);return[...DEFAULT_ENVIRONMENT_REQUIREMENTS];}
  createBuild(actor:BackendActor,projectId:string,versionId:string,input:{idempotencyKey:string}):BackendBuild{
    const project=this.project(actor,projectId),version=this.store.get(BACKEND_COLLECTIONS.versions,versionId) as BackendVersion|undefined;
    if(!version||version.backendProjectId!==projectId)throw new Error('Backend version not found.');this.authorize(actor,version);
    const fingerprint=sha256(stableJson({tenantId:project.tenantId,projectId,versionId,sourceHash:version.sourceHash})),existingId=this.idem(actor,`build:${projectId}`,input.idempotencyKey,fingerprint);
    if(existingId){const old=this.store.get(BACKEND_COLLECTIONS.builds,existingId) as BackendBuild|undefined;if(!old)throw new Error('Idempotent backend build is unavailable.');this.authorize(actor,old);return old;}
    const createdAt=now(),build:BackendBuild={id:randomUUID(),tenantId:project.tenantId,ownerId:project.ownerId,backendProjectId:projectId,versionId,status:'DRAFT',createdAt,updatedAt:createdAt};
    this.store.db.exec('BEGIN IMMEDIATE');try{this.store.put(BACKEND_COLLECTIONS.builds,build,project.ownerId);this.saveIdem(actor,`build:${projectId}`,input.idempotencyKey,fingerprint,build.id);this.store.db.exec('COMMIT');}catch(error){this.store.db.exec('ROLLBACK');throw error;}return build;
  }
  validateBuild(actor:BackendActor,buildId:string):BackendBuild{
    const build=this.store.get(BACKEND_COLLECTIONS.builds,buildId) as BackendBuild|undefined;if(!build)throw new Error('Backend build not found.');this.authorize(actor,build);if(build.status!=='DRAFT')throw new Error('Only DRAFT builds can be validated.');
    const version=this.store.get(BACKEND_COLLECTIONS.versions,build.versionId) as BackendVersion|undefined;if(!version||version.backendProjectId!==build.backendProjectId)throw new Error('Backend version not found.');this.authorize(actor,version);
    const validation=validateGeneratedSource(version.files),updated:BackendBuild={...build,status:validation.valid?'VALIDATED':'BLOCKED',validation,updatedAt:now()};this.store.put(BACKEND_COLLECTIONS.builds,updated,build.ownerId);if(!validation.valid){const project=this.project(actor,build.backendProjectId);this.emit('backend.build.failed',project,{buildId:build.id,versionId:build.versionId,status:'BLOCKED',errorCount:validation.errors.length});}return updated;
  }
  updateBuildStatus(actor:BackendActor,buildId:string,status:BackendBuildState):BackendBuild{
    if(!BACKEND_BUILD_STATES.includes(status))throw new Error('Invalid build status.');const build=this.store.get(BACKEND_COLLECTIONS.builds,buildId) as BackendBuild|undefined;if(!build)throw new Error('Backend build not found.');this.authorize(actor,build);if(!BUILD_TRANSITIONS[build.status].includes(status))throw new Error(`Invalid build transition ${build.status} -> ${status}.`);
    const updated:BackendBuild={...build,status,updatedAt:now()};this.store.put(BACKEND_COLLECTIONS.builds,updated,build.ownerId);const project=this.project(actor,build.backendProjectId);
    if(status==='BUILDING')this.emit('backend.build.started',project,{buildId:build.id,versionId:build.versionId,status});
    else if(status==='SUCCEEDED')this.emit('backend.build.completed',project,{buildId:build.id,versionId:build.versionId,status});
    else if(status==='FAILED'||status==='BLOCKED'||status==='NEEDS_REVIEW')this.emit('backend.build.failed',project,{buildId:build.id,versionId:build.versionId,status});
    return updated;
  }
  prepareRuntimeHandoff(actor:BackendActor,buildId:string,input:{migrationPlanId:string}):BackendRuntimeHandoff{
    const build=this.store.get(BACKEND_COLLECTIONS.builds,buildId) as BackendBuild|undefined;if(!build)throw new Error('Backend build not found.');this.authorize(actor,build);if(build.status!=='SUCCEEDED'||build.validation?.valid!==true)throw new Error('Only successfully validated builds can be handed to Backend Runtime.');
    const project=this.project(actor,build.backendProjectId),service=this.getBackendService(actor,project.id),version=this.store.get(BACKEND_COLLECTIONS.versions,build.versionId) as BackendVersion|undefined;
    if(!version||version.backendProjectId!==project.id||version.tenantId!==project.tenantId)throw new Error('Backend version not found.');this.authorize(actor,version);
    const migration=this.store.get(BACKEND_COLLECTIONS.migrations,input.migrationPlanId) as MigrationPlan|undefined;
    if(!migration||migration.backendProjectId!==project.id||migration.tenantId!==project.tenantId||migration.toVersionId!==version.id||migration.toSpecificationHash!==version.specificationHash)throw new Error('Migration plan does not match the successful backend version.');this.authorize(actor,migration);
    if(!service.databaseBindingId)throw new Error('Managed database binding is required before runtime handoff.');
    const binding=this.store.get(BACKEND_COLLECTIONS.databases,service.databaseBindingId) as DatabaseBinding|undefined;
    if(!binding||binding.backendProjectId!==project.id||binding.tenantId!==project.tenantId||binding.status==='DISABLED')throw new Error('Managed database binding is unavailable.');this.authorize(actor,binding);
    return{
      tenantId:project.tenantId,backendProjectId:project.id,serviceId:service.id,versionId:version.id,buildId:build.id,sourceHash:version.sourceHash,templateVersion:version.templateVersion,
      files:releaseFileManifest(version.files),
      runtimePolicyRequest:{nodeVersion:service.runtimePolicy.nodeVersion,memoryMb:service.runtimePolicy.maxMemoryMb,cpuMillisPerSecond:service.runtimePolicy.maxCpuMillisPerSecond,requestTimeoutMs:service.runtimePolicy.requestTimeoutMs,networkPolicy:'DENY'},
      databaseBinding:{databaseBindingId:binding.id,engine:'POSTGRESQL',status:binding.status,reference:binding.bindingRef},
      migration:{migrationPlanId:migration.id,risk:migration.risk,requiresApproval:migration.requiresApproval},
      secretRequirements:[{name:'DATABASE_URL',reference:binding.bindingRef}],platformEnvironment:['PORT','NODE_ENV']
    };
  }
}
