import {createHash} from 'node:crypto';
import type {ConversationBindings,ConversationCard,ConversationCardAction,ConversationReference,ConversationTaskState} from './types.js';

const ID=/^[A-Za-z0-9_.:@-]{1,180}$/;
const KEY=/^[A-Za-z0-9_.:-]{1,128}$/;
export const CONVERSATION_LIMITS={messageBytes:12_000,cards:8,references:24,actionsPerCard:6,replay:100,sessions:100,titleChars:160,cardBodyChars:1200} as const;
const TASK_STATES=new Set<ConversationTaskState>(['IDLE','AWAITING_ASSISTANT','AWAITING_CUSTOMER','ACTIVE','PAUSED','CLOSED']);
const CARD_KINDS=new Set(['QUESTION','APPROVAL','WORK_STATUS','RECEIPT','ARTIFACT','CONNECTION','NOTICE']);
const ACTION_KINDS=new Set(['OPEN_WORK','OPEN_APPROVAL','OPEN_CONNECTION','ANSWER_QUESTION','INSPECT_RECEIPT','OPEN_ARTIFACT']);
const RECEIPT_KINDS=new Set(['ORCHESTRATION','AGENCY_EXECUTION','CAPABILITY']);

export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const safeId=(value:unknown,label='identifier')=>{const v=String(value||'').trim();if(!ID.test(v))throw new Error(`Invalid ${label}.`);return v};
export const safeKey=(value:unknown,label='idempotency key')=>{const v=String(value||'').trim();if(!KEY.test(v))throw new Error(`Invalid ${label}.`);return v};
const cleanInline=(value:unknown,max:number,label:string)=>{const v=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();if(!v)throw new Error(`${label} is required.`);if(v.length>max)throw new Error(`${label} is too large.`);return v};
export const cleanOptionalInline=(value:unknown,max:number)=>{const raw=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();if(!raw)return null;if(raw.length>max)throw new Error('Text value is too large.');return raw};
export const cleanMessage=(value:unknown)=>{if(typeof value!=='string')throw new Error('Conversation message must be text.');const bytes=Buffer.byteLength(value,'utf8');if(bytes<1||bytes>CONVERSATION_LIMITS.messageBytes)throw new Error('Conversation message is empty or too large.');const v=value.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();if(!v)throw new Error('Conversation message is empty or too large.');return v};
export const normalizeTaskState=(value:ConversationTaskState)=>{if(!TASK_STATES.has(value))throw new Error('Invalid conversation task state.');return value};
const optionalId=(value:unknown,label:string)=>value===undefined||value===null||value===''?undefined:safeId(value,label);
const optionalRevision=(value:unknown)=>{if(value===undefined)return undefined;const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new Error('Invalid orchestration revision.');return n};

export function normalizeReference(raw:ConversationReference):ConversationReference{
 if(!raw||typeof raw!=='object')throw new Error('Invalid conversation reference.');
 switch(raw.kind){
  case'INTENT':return{kind:'INTENT',id:safeId(raw.id,'intent id')};
  case'ORCHESTRATION_PLAN':{const revision=optionalRevision(raw.revision);return revision===undefined?{kind:'ORCHESTRATION_PLAN',id:safeId(raw.id,'orchestration plan id')}:{kind:'ORCHESTRATION_PLAN',id:safeId(raw.id,'orchestration plan id'),revision}}
  case'QUESTION':{const workPackageId=optionalId(raw.workPackageId,'work package id');return workPackageId?{kind:'QUESTION',id:safeId(raw.id,'question id'),workPackageId}:{kind:'QUESTION',id:safeId(raw.id,'question id')}}
  case'APPROVAL':{const actionPlanId=optionalId(raw.actionPlanId,'action plan id');return actionPlanId?{kind:'APPROVAL',id:safeId(raw.id,'approval id'),actionPlanId}:{kind:'APPROVAL',id:safeId(raw.id,'approval id')}}
  case'WORK':{const executionRequestId=optionalId(raw.executionRequestId,'execution request id');const base={kind:'WORK' as const,id:safeId(raw.id,'work package id'),orchestrationPlanId:safeId(raw.orchestrationPlanId,'orchestration plan id')};return executionRequestId?{...base,executionRequestId}:base}
  case'RECEIPT':if(!RECEIPT_KINDS.has(raw.receiptKind))throw new Error('Invalid receipt reference kind.');return{kind:'RECEIPT',id:safeId(raw.id,'receipt id'),receiptKind:raw.receiptKind};
  case'ARTIFACT':{const projectId=optionalId(raw.projectId,'artifact project id');return projectId?{kind:'ARTIFACT',id:safeId(raw.id,'artifact id'),projectId}:{kind:'ARTIFACT',id:safeId(raw.id,'artifact id')}}
  default:throw new Error('Invalid conversation reference kind.');
 }
}
export function normalizeReferences(values:ConversationReference[]|undefined,max=CONVERSATION_LIMITS.references){if(values===undefined)return[];if(!Array.isArray(values)||values.length>max)throw new Error('Too many conversation references.');const out=values.map(normalizeReference),seen=new Set<string>();return out.filter(ref=>{const key=JSON.stringify(ref);if(seen.has(key))return false;seen.add(key);return true})}
function normalizeAction(raw:ConversationCardAction):ConversationCardAction{if(!raw||typeof raw!=='object'||!ACTION_KINDS.has(raw.kind))throw new Error('Invalid conversation card action.');const reference=raw.reference?normalizeReference(raw.reference):undefined,requiredKind:Partial<Record<ConversationCardAction['kind'],ConversationReference['kind']>>={OPEN_WORK:'WORK',OPEN_APPROVAL:'APPROVAL',ANSWER_QUESTION:'QUESTION',INSPECT_RECEIPT:'RECEIPT',OPEN_ARTIFACT:'ARTIFACT'};if(requiredKind[raw.kind]&&reference?.kind!==requiredKind[raw.kind])throw new Error('Conversation card action reference kind mismatch.');return reference?{id:safeId(raw.id,'card action id'),kind:raw.kind,label:cleanInline(raw.label,80,'Card action label'),reference}:{id:safeId(raw.id,'card action id'),kind:raw.kind,label:cleanInline(raw.label,80,'Card action label')}}
export function normalizeCards(values:ConversationCard[]|undefined){if(values===undefined)return[];if(!Array.isArray(values)||values.length>CONVERSATION_LIMITS.cards)throw new Error('Too many conversation cards.');return values.map(raw=>{if(!raw||typeof raw!=='object'||!CARD_KINDS.has(raw.kind))throw new Error('Invalid conversation card.');if(!Array.isArray(raw.actions)||raw.actions.length>CONVERSATION_LIMITS.actionsPerCard)throw new Error('Too many conversation card actions.');return{id:safeId(raw.id,'card id'),kind:raw.kind,title:cleanInline(raw.title,CONVERSATION_LIMITS.titleChars,'Card title'),body:raw.body===null?null:cleanOptionalInline(raw.body,CONVERSATION_LIMITS.cardBodyChars),references:normalizeReferences(raw.references),actions:raw.actions.map(normalizeAction)}})}

export const emptyBindings=():ConversationBindings=>({intentRef:null,orchestrationPlanRef:null,questionRefs:[],approvalRefs:[],runningWorkRefs:[],receiptRefs:[],artifactRefs:[]});
export function normalizeBindings(input:Partial<ConversationBindings>,current:ConversationBindings):ConversationBindings{
 const next:ConversationBindings=structuredClone(current);
 if('intentRef'in input)next.intentRef=input.intentRef?{id:safeId(input.intentRef.id,'intent id')}:null;
 if('orchestrationPlanRef'in input)next.orchestrationPlanRef=input.orchestrationPlanRef?{id:safeId(input.orchestrationPlanRef.id,'orchestration plan id'),...(input.orchestrationPlanRef.revision===undefined?{}:{revision:optionalRevision(input.orchestrationPlanRef.revision)})}:null;
 if('questionRefs'in input){if(!Array.isArray(input.questionRefs)||input.questionRefs.length>CONVERSATION_LIMITS.references)throw new Error('Too many question references.');next.questionRefs=input.questionRefs.map(x=>{const ref=normalizeReference({kind:'QUESTION',...x});return{ id:ref.id,...('workPackageId'in ref&&ref.workPackageId?{workPackageId:ref.workPackageId}:{})}})}
 if('approvalRefs'in input){if(!Array.isArray(input.approvalRefs)||input.approvalRefs.length>CONVERSATION_LIMITS.references)throw new Error('Too many approval references.');next.approvalRefs=input.approvalRefs.map(x=>{const ref=normalizeReference({kind:'APPROVAL',...x});return{id:ref.id,...('actionPlanId'in ref&&ref.actionPlanId?{actionPlanId:ref.actionPlanId}:{})}})}
 if('runningWorkRefs'in input){if(!Array.isArray(input.runningWorkRefs)||input.runningWorkRefs.length>CONVERSATION_LIMITS.references)throw new Error('Too many running work references.');next.runningWorkRefs=input.runningWorkRefs.map(x=>{const ref=normalizeReference({kind:'WORK',...x});if(ref.kind!=='WORK')throw new Error('Invalid running work reference.');return{id:ref.id,orchestrationPlanId:ref.orchestrationPlanId,...(ref.executionRequestId?{executionRequestId:ref.executionRequestId}:{})}})}
 if('receiptRefs'in input){if(!Array.isArray(input.receiptRefs)||input.receiptRefs.length>CONVERSATION_LIMITS.references)throw new Error('Too many receipt references.');next.receiptRefs=input.receiptRefs.map(x=>{const ref=normalizeReference({kind:'RECEIPT',...x});if(ref.kind!=='RECEIPT')throw new Error('Invalid receipt reference.');return{id:ref.id,receiptKind:ref.receiptKind}})}
 if('artifactRefs'in input){if(!Array.isArray(input.artifactRefs)||input.artifactRefs.length>CONVERSATION_LIMITS.references)throw new Error('Too many artifact references.');next.artifactRefs=input.artifactRefs.map(x=>{const ref=normalizeReference({kind:'ARTIFACT',...x});if(ref.kind!=='ARTIFACT')throw new Error('Invalid artifact reference.');return{id:ref.id,...(ref.projectId?{projectId:ref.projectId}:{})}})}
 return next;
}

export const cursorFor=(tenantId:string,conversationId:string,sequence:number)=>`v1:${digest({tenantId,conversationId}).slice(0,16)}:${sequence}`;
export function parseCursor(cursor:string|undefined,tenantId:string,conversationId:string){if(!cursor)return 0;const match=/^v1:([a-f0-9]{16}):(\d+)$/.exec(cursor);if(!match||match[1]!==digest({tenantId,conversationId}).slice(0,16))throw new Error('Conversation replay cursor does not belong to this session.');const sequence=Number(match[2]);if(!Number.isSafeInteger(sequence)||sequence<0)throw new Error('Invalid conversation replay cursor.');return sequence}
