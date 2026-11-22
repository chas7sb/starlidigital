import type {Store} from '../store.js';
import type { SocialConnection, SocialPostPlan, SocialPublishJob } from './types.js';
export interface SocialRepository {
  putConnection(value: SocialConnection): void; getConnection(tenantId:string,id:string):SocialConnection|undefined; listConnections(tenantId:string):SocialConnection[];
  putPlan(value: SocialPostPlan):void; getPlan(tenantId:string,id:string):SocialPostPlan|undefined; listPlans(tenantId:string):SocialPostPlan[];
  putJob(value:SocialPublishJob):void; getJob(tenantId:string,id:string):SocialPublishJob|undefined; listJobs(tenantId:string):SocialPublishJob[]; findJobByIdempotency(tenantId:string,key:string):SocialPublishJob|undefined;
}
export class InMemorySocialRepository implements SocialRepository {
  private connections=new Map<string,SocialConnection>(); private plans=new Map<string,SocialPostPlan>(); private jobs=new Map<string,SocialPublishJob>();
  private key(t:string,id:string){return `${t}:${id}`}
  putConnection(v:SocialConnection){this.connections.set(this.key(v.tenantId,v.id),structuredClone(v));}
  getConnection(t:string,id:string){const v=this.connections.get(this.key(t,id)); return v&&structuredClone(v);}
  listConnections(t:string){return [...this.connections.values()].filter(v=>v.tenantId===t).map(v=>structuredClone(v));}
  putPlan(v:SocialPostPlan){this.plans.set(this.key(v.tenantId,v.id),structuredClone(v));}
  getPlan(t:string,id:string){const v=this.plans.get(this.key(t,id)); return v&&structuredClone(v);}
  listPlans(t:string){return [...this.plans.values()].filter(v=>v.tenantId===t).map(v=>structuredClone(v));}
  putJob(v:SocialPublishJob){this.jobs.set(this.key(v.tenantId,v.id),structuredClone(v));}
  getJob(t:string,id:string){const v=this.jobs.get(this.key(t,id)); return v&&structuredClone(v);}
  listJobs(t:string){return [...this.jobs.values()].filter(v=>v.tenantId===t).map(v=>structuredClone(v));}
  findJobByIdempotency(t:string,key:string){const v=[...this.jobs.values()].find(v=>v.tenantId===t&&v.idempotencyKey===key);return v&&structuredClone(v);}
}

const CONNECTIONS='social-connections',PLANS='social-post-plans',JOBS='social-publish-jobs';
export class StoreSocialRepository implements SocialRepository{
  constructor(private store:Store){}
  putConnection(v:SocialConnection){this.assertTenant(v.tenantId);this.store.put(CONNECTIONS,structuredClone(v) as any,v.tenantId);}
  getConnection(t:string,id:string){return this.owned<SocialConnection>(CONNECTIONS,t,id);}
  listConnections(t:string){return this.list<SocialConnection>(CONNECTIONS,t);}
  putPlan(v:SocialPostPlan){this.assertTenant(v.tenantId);this.store.put(PLANS,structuredClone(v) as any,v.tenantId);}
  getPlan(t:string,id:string){return this.owned<SocialPostPlan>(PLANS,t,id);}
  listPlans(t:string){return this.list<SocialPostPlan>(PLANS,t);}
  putJob(v:SocialPublishJob){this.assertTenant(v.tenantId);this.store.put(JOBS,structuredClone(v) as any,v.tenantId);}
  getJob(t:string,id:string){return this.owned<SocialPublishJob>(JOBS,t,id);}
  listJobs(t:string){return this.list<SocialPublishJob>(JOBS,t);}
  findJobByIdempotency(t:string,key:string){return this.listJobs(t).find(job=>job.idempotencyKey===key);}
  private owned<T extends {tenantId:string}>(collection:string,tenantId:string,id:string){this.assertTenant(tenantId);const row=this.store.get(collection,id) as T|undefined;if(!row||row.tenantId!==tenantId)return undefined;return structuredClone(row);}
  private list<T extends {tenantId:string}>(collection:string,tenantId:string){this.assertTenant(tenantId);return (this.store.list(collection,tenantId) as unknown as T[]).filter(row=>row.tenantId===tenantId).map(row=>structuredClone(row));}
  private assertTenant(value:string){if(!/^[A-Za-z0-9_.:-]{1,200}$/.test(String(value||'')))throw new Error('Invalid social tenant identity');}
}
