import type {Events} from '../events.js';
import type {Store} from '../store.js';
import type {AutonomyLevel,AutonomyPolicyRecord,AutonomyPolicySummary,ContactChannel,Day,DiscoveredAutonomyScope,QuietHoursPolicy,StoredAutonomyScope} from './types.js';

const COLLECTION='agency-autonomy-policies';
export const AUTONOMY_LEVELS=['OBSERVE','RECOMMEND','DRAFT','EXECUTE_SAFE','EXECUTE_APPROVED'] as const;
const DAYS=['MON','TUE','WED','THU','FRI','SAT','SUN'] as const;
const CHANNELS=['EMAIL','SMS','PHONE','SOCIAL_DM','ONSITE'] as const;
const ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const levelIndex=(level:AutonomyLevel)=>AUTONOMY_LEVELS.indexOf(level);
const now=()=>new Date().toISOString();
const tenantId=(value:string)=>{const id=String(value||'').trim();if(!ID.test(id))throw new Error('Invalid tenant identity.');return id;};
const scopeId=(value:string)=>{const id=String(value||'').trim();if(!ID.test(id))throw new Error('Invalid autonomy scope.');return id;};
const level=(value:string)=>{if(!AUTONOMY_LEVELS.includes(value as AutonomyLevel))throw new Error('Invalid autonomy level.');return value as AutonomyLevel;};
const timezone=(value:string)=>{const tz=String(value||'').trim();if(!tz||tz.length>80)throw new Error('Invalid timezone.');try{new Intl.DateTimeFormat('en',{timeZone:tz}).format();}catch{throw new Error('Invalid timezone.');}return tz;};
function quiet(value:QuietHoursPolicy):QuietHoursPolicy{if(!TIME.test(value.startLocal)||!TIME.test(value.endLocal))throw new Error('Invalid quiet-hours time.');const days=[...new Set(value.days)].filter((item):item is Day=>DAYS.includes(item as Day));const channels=[...new Set(value.channels)].filter((item):item is ContactChannel=>CHANNELS.includes(item as ContactChannel));if(!days.length||days.length>7)throw new Error('Invalid quiet-hours days.');if(!channels.length||channels.length>5)throw new Error('Invalid quiet-hours channels.');return{enabled:!!value.enabled,timezone:timezone(value.timezone),startLocal:value.startLocal,endLocal:value.endLocal,days,channels};}
function defaultPolicy(tenant:string):AutonomyPolicyRecord{return{id:`policy:${tenant}`,tenantId:tenant,pauseAll:false,defaultLevel:'DRAFT',scopeOverrides:[],quietHours:{enabled:true,timezone:'UTC',startLocal:'20:00',endLocal:'08:30',days:[...DAYS],channels:[...CHANNELS]},updatedAt:now()};}
export class AutonomyPolicyService{
  constructor(private store:Store,private events?:Events){}
  record(tenant:string){const id=tenantId(tenant),stored=this.store.get(COLLECTION,`policy:${id}`) as AutonomyPolicyRecord|undefined;if(stored&&stored.tenantId!==id)throw new Error('Autonomy policy tenant mismatch.');return stored?{...stored,scopeOverrides:Array.isArray(stored.scopeOverrides)?stored.scopeOverrides:[],quietHours:quiet(stored.quietHours)}:defaultPolicy(id);}
  summary(tenant:string,discovered:DiscoveredAutonomyScope[]=[]):AutonomyPolicySummary{const record=this.record(tenant),overrides=new Map(record.scopeOverrides.map(item=>[`${item.kind}:${item.scopeId}`,item]));const scopes=discovered.slice(0,100).map(scope=>{const found=overrides.get(`${scope.kind}:${scope.scopeId}`),configured=found?.level??record.defaultLevel,effective=levelIndex(configured)<=levelIndex(scope.maxLevel)?configured:scope.maxLevel;return{...scope,level:effective,paused:!!found?.paused};});return{id:record.id,policyId:record.id,pauseAll:record.pauseAll,defaultLevel:record.defaultLevel,scopes,quietHours:record.quietHours,doNotContact:{enabled:true,enforcement:'HARD_BLOCK',channels:['EMAIL','SMS','PHONE','SOCIAL_DM'],honorExplicitOptOuts:true,sourceOfTruth:'CRM_AND_CONSENT_RECORDS'},updatedAt:record.updatedAt};}
  setPauseAll(tenant:string,paused:boolean){const record=this.record(tenant);record.pauseAll=!!paused;return this.save(record,'pause_all',{paused:record.pauseAll});}
  setScope(tenant:string,scope:DiscoveredAutonomyScope,input:{level:AutonomyLevel;paused:boolean}){const record=this.record(tenant),requested=level(input.level);if(levelIndex(requested)>levelIndex(scope.maxLevel))throw new Error(`Autonomy exceeds the maximum allowed level for ${scope.label}.`);const timestamp=now(),next:StoredAutonomyScope={scopeId:scopeId(scope.scopeId),kind:scope.kind,level:requested,paused:!!input.paused,updatedAt:timestamp};record.scopeOverrides=[...record.scopeOverrides.filter(item=>!(item.scopeId===next.scopeId&&item.kind===next.kind)),next].slice(-100);return this.save(record,'scope_updated',{kind:next.kind,scopeId:next.scopeId,level:next.level,paused:next.paused});}
  updateQuietHours(tenant:string,input:QuietHoursPolicy){const record=this.record(tenant);record.quietHours=quiet(input);return this.save(record,'quiet_hours_updated',{enabled:record.quietHours.enabled,timezone:record.quietHours.timezone,startLocal:record.quietHours.startLocal,endLocal:record.quietHours.endLocal,daysCount:record.quietHours.days.length,channels:record.quietHours.channels});}
  canPreparePlans(tenant:string){const record=this.record(tenant);return !record.pauseAll&&levelIndex(record.defaultLevel)>=levelIndex('DRAFT');}
  private save(record:AutonomyPolicyRecord,eventType:string,payload:Record<string,unknown>){record.updatedAt=now();this.store.put(COLLECTION,record,record.tenantId);try{this.events?.company({type:'agency.policy.updated',source:'autonomy-policy',entities:[{kind:'autonomy_policy',id:record.id}],correlationKey:record.tenantId,idempotencyKey:`agency-policy:${record.id}:${record.updatedAt}:${eventType}`,payload:{change:eventType,...payload}});}catch{}return record;}
}
