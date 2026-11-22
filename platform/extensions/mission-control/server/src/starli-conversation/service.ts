import type {RecordData,Store} from '../store.js';
import type {Events} from '../events.js';
import type {AppendAssistantResponseInput,ConversationActor,ConversationReplayPage,CreateConversationInput,StarliConversationMessage,StarliConversationSession,SubmitCustomerMessageInput,UpdateConversationBindingsInput} from './types.js';
import {STARLI_CONVERSATION_SCHEMA_VERSION} from './types.js';
import {CONVERSATION_LIMITS,cleanMessage,cleanOptionalInline,cursorFor,digest,emptyBindings,normalizeBindings,normalizeCards,normalizeReferences,normalizeTaskState,parseCursor,safeId,safeKey} from './policy.js';

export const STARLI_CONVERSATION_COLLECTIONS={sessions:'starli-conversation-sessions',messages:'starli-conversation-messages',idempotency:'starli-conversation-idempotency'} as const;
type IdempotencyRecord=RecordData&{tenantId:string;ownerId:string;conversationId:string|null;kind:'SESSION'|'CUSTOMER_MESSAGE'|'ASSISTANT_RESPONSE';key:string;fingerprint:string;resultId:string;createdAt:string};
const clone=<T>(value:T):T=>structuredClone(value);

export class StarliConversationService{
 constructor(private store:Store,private events?:Events,private clock=()=>Date.now()){}
 private tenant(actor:ConversationActor){return actor.workspaceTenantId||actor.userId}
 private time(){return new Date(this.clock()).toISOString()}
 private actorScope(actor:ConversationActor){const tenantId=safeId(this.tenant(actor),'tenant id'),ownerId=safeId(actor.userId,'owner id');return{tenantId,ownerId}}
 private authorize(actor:ConversationActor,session:Pick<StarliConversationSession,'tenantId'|'ownerId'>){const scope=this.actorScope(actor);if(session.tenantId!==scope.tenantId||session.ownerId!==scope.ownerId)throw new Error('Conversation access denied.')}
 private load(actor:ConversationActor,id:string){const session=this.store.get(STARLI_CONVERSATION_COLLECTIONS.sessions,safeId(id,'conversation id')) as StarliConversationSession|undefined;if(!session)throw new Error('Conversation not found.');this.authorize(actor,session);return session}

 createConversation(actor:ConversationActor,input:CreateConversationInput){
  const {tenantId,ownerId}=this.actorScope(actor),key=safeKey(input.idempotencyKey),title=input.title===undefined||input.title===null?null:cleanOptionalInline(input.title,CONVERSATION_LIMITS.titleChars),fingerprint=digest({tenantId,ownerId,title}),idemId=`conversation-idem:${digest({tenantId,ownerId,kind:'SESSION',key}).slice(0,40)}`,createdAt=this.time();
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   const old=this.store.get(STARLI_CONVERSATION_COLLECTIONS.idempotency,idemId) as IdempotencyRecord|undefined;
   if(old){if(old.fingerprint!==fingerprint||old.tenantId!==tenantId||old.ownerId!==ownerId)throw new Error('Conversation idempotency key conflict.');const existing=this.store.get(STARLI_CONVERSATION_COLLECTIONS.sessions,old.resultId) as StarliConversationSession|undefined;if(!existing)throw new Error('Idempotent conversation result unavailable.');this.authorize(actor,existing);this.store.db.exec('COMMIT');return clone(existing)}
   const id=`conversation:${digest({tenantId,ownerId,key}).slice(0,32)}`,session:StarliConversationSession={id,schemaVersion:STARLI_CONVERSATION_SCHEMA_VERSION,tenantId,ownerId,title,taskState:'IDLE',bindings:emptyBindings(),revision:1,lastSequence:0,createdAt,updatedAt:createdAt};
   this.store.put(STARLI_CONVERSATION_COLLECTIONS.sessions,session,ownerId);this.store.put(STARLI_CONVERSATION_COLLECTIONS.idempotency,{id:idemId,tenantId,ownerId,conversationId:null,kind:'SESSION',key,fingerprint,resultId:id,createdAt},ownerId);this.store.db.exec('COMMIT');
   this.emit('starli.conversation.created',session,{revision:session.revision});return clone(session);
  }catch(error){this.store.db.exec('ROLLBACK');throw error}
 }

 getConversation(actor:ConversationActor,id:string){return clone(this.load(actor,id))}
 listConversations(actor:ConversationActor,limit=50){const {tenantId,ownerId}=this.actorScope(actor),n=Math.max(1,Math.min(CONVERSATION_LIMITS.sessions,Number(limit)||50));return (this.store.list(STARLI_CONVERSATION_COLLECTIONS.sessions,ownerId) as StarliConversationSession[]).filter(x=>x.tenantId===tenantId&&x.ownerId===ownerId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id)).slice(0,n).map(clone)}

 submitCustomerMessage(actor:ConversationActor,conversationId:string,input:SubmitCustomerMessageInput){
  const content=cleanMessage(input.content),key=safeKey(input.idempotencyKey),scope=this.actorScope(actor),id=safeId(conversationId,'conversation id'),fingerprint=digest({conversationId:id,role:'CUSTOMER',content}),idemId=`conversation-idem:${digest({...scope,conversationId:id,kind:'CUSTOMER_MESSAGE',key}).slice(0,40)}`;
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   const session=this.load(actor,id),old=this.store.get(STARLI_CONVERSATION_COLLECTIONS.idempotency,idemId) as IdempotencyRecord|undefined;
   if(old){if(old.fingerprint!==fingerprint||old.tenantId!==scope.tenantId||old.ownerId!==scope.ownerId||old.conversationId!==id)throw new Error('Conversation message idempotency key conflict.');const message=this.store.get(STARLI_CONVERSATION_COLLECTIONS.messages,old.resultId) as StarliConversationMessage|undefined;if(!message)throw new Error('Idempotent conversation message unavailable.');this.store.db.exec('COMMIT');return{session:clone(session),message:clone(message)}}
   if(session.taskState==='CLOSED')throw new Error('Conversation is closed.');
   const sequence=session.lastSequence+1,createdAt=this.time(),messageId=`conversation-message:${digest({conversationId:id,key,role:'CUSTOMER'}).slice(0,40)}`,message:StarliConversationMessage={id:messageId,schemaVersion:STARLI_CONVERSATION_SCHEMA_VERSION,conversationId:id,tenantId:scope.tenantId,ownerId:scope.ownerId,sequence,role:'CUSTOMER',content,cards:[],references:[],createdAt};
   session.lastSequence=sequence;session.revision++;session.updatedAt=createdAt;session.taskState='AWAITING_ASSISTANT';
   this.store.put(STARLI_CONVERSATION_COLLECTIONS.messages,message,scope.ownerId);this.store.put(STARLI_CONVERSATION_COLLECTIONS.sessions,session,scope.ownerId);this.store.put(STARLI_CONVERSATION_COLLECTIONS.idempotency,{id:idemId,tenantId:scope.tenantId,ownerId:scope.ownerId,conversationId:id,kind:'CUSTOMER_MESSAGE',key,fingerprint,resultId:messageId,createdAt},scope.ownerId);this.store.db.exec('COMMIT');
   this.emit('starli.conversation.message.appended',session,{role:'CUSTOMER',sequence,cardCount:0,referenceKinds:[]});return{session:clone(session),message:clone(message)};
  }catch(error){this.store.db.exec('ROLLBACK');throw error}
 }

 appendAssistantResponse(actor:ConversationActor,conversationId:string,expectedRevision:number,input:AppendAssistantResponseInput){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new Error('Invalid expected conversation revision.');
  const content=cleanMessage(input.content),cards=normalizeCards(input.cards),references=normalizeReferences(input.references),taskState=input.taskState===undefined?'ACTIVE':normalizeTaskState(input.taskState),key=safeKey(input.idempotencyKey),scope=this.actorScope(actor),id=safeId(conversationId,'conversation id'),fingerprint=digest({conversationId:id,role:'ASSISTANT',content,cards,references,taskState}),idemId=`conversation-idem:${digest({...scope,conversationId:id,kind:'ASSISTANT_RESPONSE',key}).slice(0,40)}`;
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   const session=this.load(actor,id),old=this.store.get(STARLI_CONVERSATION_COLLECTIONS.idempotency,idemId) as IdempotencyRecord|undefined;
   if(old){if(old.fingerprint!==fingerprint||old.tenantId!==scope.tenantId||old.ownerId!==scope.ownerId||old.conversationId!==id)throw new Error('Assistant response idempotency key conflict.');const message=this.store.get(STARLI_CONVERSATION_COLLECTIONS.messages,old.resultId) as StarliConversationMessage|undefined;if(!message)throw new Error('Idempotent assistant response unavailable.');this.store.db.exec('COMMIT');return{session:clone(session),message:clone(message)}}
   if(session.taskState==='CLOSED')throw new Error('Conversation is closed.');if(session.revision!==expectedRevision)throw new Error('Conversation revision conflict.');
   const sequence=session.lastSequence+1,createdAt=this.time(),messageId=`conversation-message:${digest({conversationId:id,key,role:'ASSISTANT'}).slice(0,40)}`,message:StarliConversationMessage={id:messageId,schemaVersion:STARLI_CONVERSATION_SCHEMA_VERSION,conversationId:id,tenantId:scope.tenantId,ownerId:scope.ownerId,sequence,role:'ASSISTANT',content,cards,references,createdAt};
   session.lastSequence=sequence;session.revision++;session.updatedAt=createdAt;session.taskState=taskState;
   this.store.put(STARLI_CONVERSATION_COLLECTIONS.messages,message,scope.ownerId);this.store.put(STARLI_CONVERSATION_COLLECTIONS.sessions,session,scope.ownerId);this.store.put(STARLI_CONVERSATION_COLLECTIONS.idempotency,{id:idemId,tenantId:scope.tenantId,ownerId:scope.ownerId,conversationId:id,kind:'ASSISTANT_RESPONSE',key,fingerprint,resultId:messageId,createdAt},scope.ownerId);this.store.db.exec('COMMIT');
   this.emit('starli.conversation.message.appended',session,{role:'ASSISTANT',sequence,cardCount:cards.length,referenceKinds:[...new Set(references.map(x=>x.kind))]});return{session:clone(session),message:clone(message)};
  }catch(error){this.store.db.exec('ROLLBACK');throw error}
 }

 updateBindings(actor:ConversationActor,conversationId:string,expectedRevision:number,input:UpdateConversationBindingsInput){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new Error('Invalid expected conversation revision.');const id=safeId(conversationId,'conversation id');
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   const session=this.load(actor,id);if(session.revision!==expectedRevision)throw new Error('Conversation revision conflict.');const nextBindings=normalizeBindings(input.bindings,session.bindings),nextState=input.taskState===undefined?session.taskState:normalizeTaskState(input.taskState),changed=JSON.stringify(nextBindings)!==JSON.stringify(session.bindings)||nextState!==session.taskState;if(!changed){this.store.db.exec('COMMIT');return clone(session)}if(session.taskState==='CLOSED')throw new Error('Conversation is closed.');
   session.bindings=nextBindings;session.taskState=nextState;session.revision++;session.updatedAt=this.time();this.store.put(STARLI_CONVERSATION_COLLECTIONS.sessions,session,session.ownerId);this.store.db.exec('COMMIT');
   this.emit('starli.conversation.context.updated',session,{taskState:session.taskState,revision:session.revision,bindingCounts:{questions:session.bindings.questionRefs.length,approvals:session.bindings.approvalRefs.length,runningWork:session.bindings.runningWorkRefs.length,receipts:session.bindings.receiptRefs.length,artifacts:session.bindings.artifactRefs.length}});return clone(session);
  }catch(error){this.store.db.exec('ROLLBACK');throw error}
 }

 replay(actor:ConversationActor,conversationId:string,options:{afterCursor?:string;limit?:number}={}):ConversationReplayPage{
  const session=this.load(actor,conversationId),after=parseCursor(options.afterCursor,session.tenantId,session.id);if(after>session.lastSequence)throw new Error('Conversation replay cursor is ahead of the session.');const limit=Math.max(1,Math.min(CONVERSATION_LIMITS.replay,Number(options.limit)||50)),all=(this.store.list(STARLI_CONVERSATION_COLLECTIONS.messages,session.ownerId) as StarliConversationMessage[]).filter(x=>x.tenantId===session.tenantId&&x.ownerId===session.ownerId&&x.conversationId===session.id&&x.sequence>after).sort((a,b)=>a.sequence-b.sequence||a.id.localeCompare(b.id)),messages=all.slice(0,limit),last=messages.at(-1)?.sequence??after;return{session:clone(session),messages:messages.map(clone),nextCursor:messages.length?cursorFor(session.tenantId,session.id,last):null,hasMore:all.length>messages.length,lastSequence:session.lastSequence};
 }

 private emit(type:string,session:StarliConversationSession,payload:Record<string,unknown>){try{this.events?.company({type,source:'starli-conversation',entities:[{kind:'starli_conversation',id:session.id}],correlationKey:session.id,idempotencyKey:`starli-conversation:${session.id}:${session.revision}:${type}`,payload})}catch{}}
}
