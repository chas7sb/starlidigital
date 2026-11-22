import { randomUUID } from 'node:crypto';
import type { Store, StoreChange, RecordData } from './store.js';

export type CompanyEventEntity={kind:string;id:string};
export type CompanyEvent={id:string;sequence:number;type:string;source:string;occurredAt:string;entities:CompanyEventEntity[];correlationKey:string|null;idempotencyKey:string|null;payload:Record<string,unknown>;createdAt:string};
export type CompanyEventInput={id?:string;type:string;source:string;occurredAt?:string;entities?:CompanyEventEntity[];correlationKey?:string|null;idempotencyKey?:string|null;payload?:Record<string,unknown>};
export type CompanyEventListOptions={afterCursor?:number;since?:string;limit?:number;types?:string[];sources?:string[]};
export type CompanyEventSummary={total:number;lastSequence:number;byType:Record<string,number>;bySource:Record<string,number>};

const validName=(value:string,fallback='unknown')=>/^[A-Za-z0-9_.:-]{1,120}$/.test(value)?value:fallback;
const safeIso=(value:unknown)=>{const n=Date.parse(typeof value==='string'?value:'');return Number.isFinite(n)?new Date(n).toISOString():new Date().toISOString();};
const banned=/^(authorization|proxy-authorization|cookie|set-cookie|password|pass|secret|api[_-]?key|.*token|claim(code|otp)?|otp|raw(ip|body)?|ip|ipaddress|remoteaddress|address|email|phone|recipient|from|to|cc|bcc|body|textbody|htmlbody|sanitizedhtmlbody|content|snippet|message|messages|raw|source)$/i;
function sanitize(value:unknown,key='',depth=0):unknown{
  if(banned.test(key))return undefined;
  if(value==null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500);
  if(depth>=4)return '[omitted]';
  if(Array.isArray(value))return value.slice(0,25).map(v=>sanitize(v,'',depth+1)).filter(v=>v!==undefined);
  if(typeof value==='object'){const out:Record<string,unknown>={};for(const [k,v] of Object.entries(value as Record<string,unknown>).slice(0,40)){const x=sanitize(v,k,depth+1);if(x!==undefined)out[k]=x;}return out;}
  return undefined;
}
export const sanitizeCompanyEventPayload=(payload:Record<string,unknown>={})=>sanitize(payload) as Record<string,unknown>;
const ref=(kind:string,id:unknown):CompanyEventEntity|undefined=>typeof id==='string'&&id&&id.length<=200?{kind:validName(kind,'entity'),id:id.slice(0,200)}:undefined;
const refs=(...items:Array<CompanyEventEntity|undefined>)=>items.filter((x):x is CompanyEventEntity=>!!x);
const changed=(before:RecordData|undefined,after:RecordData,keys:string[])=>keys.some(k=>JSON.stringify(before?.[k])!==JSON.stringify(after[k]));
const idem=(c:StoreChange,type:string,extra='')=>`store:${c.collection}:${c.id}:${type}:${c.after?.updatedAt||c.after?.createdAt||c.after?.lastSeen||''}:${extra}`.slice(0,500);

export class CompanyEventLedger{
  private unsubscribe?:()=>void;
  constructor(private store:Store,observeStore=true){
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,type TEXT NOT NULL,source TEXT NOT NULL,occurred_at TEXT NOT NULL,entities_json TEXT NOT NULL,correlation_key TEXT,idempotency_key TEXT,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS company_events_idempotency ON company_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS company_events_time ON company_events(occurred_at,sequence);
      CREATE TABLE IF NOT EXISTS company_event_acks(consumer TEXT PRIMARY KEY,cursor INTEGER NOT NULL,updated_at TEXT NOT NULL);`);
    if(observeStore)this.unsubscribe=store.onChange(c=>this.capture(c));
  }
  close(){this.unsubscribe?.();this.unsubscribe=undefined;}
  publish(input:CompanyEventInput):CompanyEvent{
    const type=validName(input.type,'company.unknown'),source=validName(input.source),occurredAt=safeIso(input.occurredAt),createdAt=new Date().toISOString(),id=input.id&&/^[A-Za-z0-9_.:-]{1,200}$/.test(input.id)?input.id:randomUUID();
    const entities=(input.entities||[]).slice(0,20).map(x=>ref(x.kind,x.id)).filter((x):x is CompanyEventEntity=>!!x),payload=sanitizeCompanyEventPayload(input.payload||{}),correlationKey=typeof input.correlationKey==='string'?input.correlationKey.slice(0,500):null,idempotencyKey=typeof input.idempotencyKey==='string'&&input.idempotencyKey?input.idempotencyKey.slice(0,500):null;
    if(idempotencyKey){const found=this.store.db.prepare('SELECT * FROM company_events WHERE idempotency_key=?').get(idempotencyKey) as any;if(found)return this.row(found);}
    try{this.store.db.prepare('INSERT INTO company_events(id,type,source,occurred_at,entities_json,correlation_key,idempotency_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,type,source,occurredAt,JSON.stringify(entities),correlationKey,idempotencyKey,JSON.stringify(payload),createdAt);}
    catch(error){if(idempotencyKey){const found=this.store.db.prepare('SELECT * FROM company_events WHERE idempotency_key=?').get(idempotencyKey) as any;if(found)return this.row(found);}throw error;}
    return this.get(id)!;
  }
  get(id:string):CompanyEvent|undefined{const row=this.store.db.prepare('SELECT * FROM company_events WHERE id=?').get(id) as any;return row?this.row(row):undefined;}
  getBySequence(sequence:number):CompanyEvent|undefined{const value=Number(sequence);if(!Number.isSafeInteger(value)||value<1)return undefined;const row=this.store.db.prepare('SELECT * FROM company_events WHERE sequence=?').get(value) as any;return row?this.row(row):undefined;}
  list(options:CompanyEventListOptions={}):CompanyEvent[]{
    const where:string[]=[],args:any[]=[];const after=Number(options.afterCursor||0);
    if(Number.isSafeInteger(after)&&after>0){where.push('sequence>?');args.push(after);}
    if(options.since){where.push('occurred_at>=?');args.push(safeIso(options.since));}
    for(const [column,values] of [['type',options.types],['source',options.sources]] as const){const clean=(values||[]).slice(0,20).map(v=>validName(v,'')).filter(Boolean);if(clean.length){where.push(`${column} IN (${clean.map(()=>'?').join(',')})`);args.push(...clean);}}
    const limit=Math.min(500,Math.max(1,Number(options.limit)||100));const sql=`SELECT * FROM company_events${where.length?' WHERE '+where.join(' AND '):''} ORDER BY sequence ASC LIMIT ?`;
    return (this.store.db.prepare(sql).all(...args,limit) as any[]).map(row=>this.row(row));
  }
  summary(options:Omit<CompanyEventListOptions,'limit'|'afterCursor'>={}):CompanyEventSummary{
    const where:string[]=[],args:any[]=[];
    if(options.since){where.push('occurred_at>=?');args.push(safeIso(options.since));}
    for(const [column,values] of [['type',options.types],['source',options.sources]] as const){
      const clean=(values||[]).slice(0,20).map(v=>validName(v,'')).filter(Boolean);
      if(clean.length){where.push(`${column} IN (${clean.map(()=>'?').join(',')})`);args.push(...clean);}
    }
    const clause=where.length?' WHERE '+where.join(' AND '):'';
    const totals=this.store.db.prepare(`SELECT COUNT(*) AS total,COALESCE(MAX(sequence),0) AS lastSequence FROM company_events${clause}`).get(...args) as any;
    const byType:Record<string,number>={},bySource:Record<string,number>={};
    for(const row of this.store.db.prepare(`SELECT type,COUNT(*) AS count FROM company_events${clause} GROUP BY type`).all(...args) as any[])byType[String(row.type)]=Number(row.count);
    for(const row of this.store.db.prepare(`SELECT source,COUNT(*) AS count FROM company_events${clause} GROUP BY source`).all(...args) as any[])bySource[String(row.source)]=Number(row.count);
    return{total:Number(totals?.total||0),lastSequence:Number(totals?.lastSequence||0),byType,bySource};
  }
  acknowledge(consumer:string,cursor:number){const key=validName(consumer,'');if(!key)throw new Error('Invalid event consumer');const value=Number(cursor);if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid event cursor');const current=this.acknowledgement(key),next=Math.max(current,value);this.store.db.prepare('INSERT INTO company_event_acks(consumer,cursor,updated_at) VALUES(?,?,?) ON CONFLICT(consumer) DO UPDATE SET cursor=MAX(company_event_acks.cursor,excluded.cursor),updated_at=excluded.updated_at').run(key,next,new Date().toISOString());return this.acknowledgement(key);}
  acknowledgement(consumer:string){const row=this.store.db.prepare('SELECT cursor FROM company_event_acks WHERE consumer=?').get(validName(consumer,'')) as any;return Number(row?.cursor||0);}
  private row(row:any):CompanyEvent{return{id:String(row.id),sequence:Number(row.sequence),type:String(row.type),source:String(row.source),occurredAt:String(row.occurred_at),entities:JSON.parse(String(row.entities_json||'[]')),correlationKey:row.correlation_key==null?null:String(row.correlation_key),idempotencyKey:row.idempotency_key==null?null:String(row.idempotency_key),payload:JSON.parse(String(row.payload_json||'{}')),createdAt:String(row.created_at)};}
  private capture(c:StoreChange){if(c.operation!=='put'||!c.after)return;const a=c.after,b=c.before,source='store.'+c.collection,emit=(type:string,payload:Record<string,unknown>,entities:CompanyEventEntity[],extra='')=>this.publish({type,source,occurredAt:a.updatedAt||a.createdAt||a.date,entities,correlationKey:String(a.conversationId||a.projectId||a.leadId||a.companyId||a.id),idempotencyKey:idem(c,type,extra),payload});
    switch(c.collection){
      case 'visitor-sessions': emit(b?'visitor.presence.updated':'visitor.session.started',{enabled:!!a.enabled,dismissed:!!a.dismissed,currentRoute:a.currentRoute||'/',firstSeen:a.firstSeen,lastSeen:a.lastSeen,hasCampaign:!!a.campaign,hasReferrer:!!a.referrer},refs(ref('visitor_session',a.id),ref('hosted_agent',a.agentId),ref('conversation',a.conversationId))); break;
      case 'hosted-agent-conversations':{
        if(!b)emit('hosted_agent.conversation.started',{status:a.status||'ACTIVE'},refs(ref('conversation',a.id),ref('hosted_agent',a.agentId)));
        const beforeCount=Array.isArray(b?.messages)?b!.messages.length:0,afterCount=Array.isArray(a.messages)?a.messages.length:0;if(afterCount>beforeCount){const last=a.messages[afterCount-1];emit('hosted_agent.message.created',{role:last?.role||'unknown',messageCount:afterCount},refs(ref('conversation',a.id),ref('hosted_agent',a.agentId),ref('message',last?.id)),String(last?.id||afterCount));}
        if(b&&a.status!==b.status)emit('hosted_agent.conversation.status_changed',{status:a.status,previousStatus:b.status},refs(ref('conversation',a.id),ref('hosted_agent',a.agentId)),String(a.status)); break;}
      case 'hosted-agent-leads': emit(b?'hosted_agent.lead.updated':'hosted_agent.lead.captured',{status:a.status||a.qualificationStatus||'captured',hasEmail:!!a.email,hasPhone:!!a.phone},refs(ref('lead',a.id),ref('hosted_agent',a.agentId),ref('conversation',a.conversationId))); break;
      case 'mailbox-messages': if(!b||changed(b,a,['status','isRead']))emit(!b&&a.direction==='INBOUND'?'mailbox.email.received':'mailbox.email.updated',{direction:a.direction,status:a.status,folder:a.folder,isRead:!!a.isRead,attachmentCount:Array.isArray(a.attachments)?a.attachments.length:0},refs(ref('mail_message',a.id),ref('company',a.companyId),ref('project',a.projectId)),String(a.status||'')); break;
      case 'crm_companies': emit(b?'crm.company.updated':'crm.company.created',{qualificationStatus:a.qualificationStatus,industry:a.industry,hasProposal:!!a.proposalId,hasProject:!!a.projectId},refs(ref('company',a.id),ref('proposal',a.proposalId),ref('project',a.projectId))); break;
      case 'crm_activities': if(!b)emit('crm.activity.logged',{kind:a.kind,visibility:a.visibility},refs(ref('crm_activity',a.id),ref('company',a.companyId),ref('project',a.projectId))); break;
      case 'proposals': if(!b||a.status!==b.status||a.viewCount!==b.viewCount){const type=a.status==='VIZUALIZAT'?'proposal.viewed':a.status==='REVENDICAT'?'proposal.claimed':!b?'proposal.created':'proposal.status_changed';emit(type,{status:a.status,previousStatus:b?.status,viewCount:a.viewCount||0,claimed:!!a.claimedAt},refs(ref('proposal',a.id),ref('lead',a.leadId),ref('project',a.projectId)),String(a.status||a.viewCount||''));} break;
      case 'projects': if(!b||changed(b,a,['status','validationStatus','deploymentStatus','publicVerified'])){const map:Record<string,string>={BUILDING:'project.build.started',VERIFYING:'project.build.verifying',PREVIEW:'project.build.completed',SOURCE_READY:'project.build.completed',BUILD_FAILED:'project.build.failed',DEPLOYING:'project.deployment.started',LIVE:'project.deployment.completed'};emit(map[a.status]||(!b?'project.created':'project.status_changed'),{status:a.status,previousStatus:b?.status,validationStatus:a.validationStatus,deploymentStatus:a.deploymentStatus,publicVerified:!!a.publicVerified,hasBuildError:!!a.buildError},refs(ref('project',a.id)),String(a.status||''));} break;
      case 'fulfillment-jobs': if(!b||a.status!==b.status){const type=a.status==='LIVE'?'deployment.completed':['FAILED','BLOCKED','NEEDS_REVIEW'].includes(a.status)?'deployment.blocked':!b?'deployment.queued':'deployment.progressed';emit(type,{status:a.status,previousStatus:b?.status,publicVerified:!!a.publicVerified,hasError:!!a.error},refs(ref('deployment_job',a.id),ref('project',a.projectId)),String(a.status||''));} break;
    }
  }
}
