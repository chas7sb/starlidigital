import {GraphQLError} from 'graphql';
import type {Context} from '../security.js';
import {fail,limit,requireUser} from '../security.js';
import type {Store} from '../store.js';
import {MachineryAuditTimelineService} from '../machinery-audit/service.js';
import type {CanonicalMachineryExecutionRuntime} from './runtime.js';
import type {MachineryRunActor,MachineryRunSelectionInput,MachineryRunSnapshot} from './types.js';
import {MACHINERY_RUN_LIMITS} from './policy.js';

const MAX_PAYLOAD_BYTES=256*1024;
const MAX_RECENT_RUNS=20;
const STOP_REASON_MAX_BYTES=320;

const payload=(data:unknown)=>{
  const dataJson=JSON.stringify(data);
  if(Buffer.byteLength(dataJson,'utf8')>MAX_PAYLOAD_BYTES)fail('Machinery response is too large.','INTERNAL_SERVER_ERROR');
  return{schemaVersion:1,dataJson};
};
const customer=(context:Context,operation:string,max=60):MachineryRunActor=>{
  const user=requireUser(context);
  if(context.operatorTokenId)fail('Customer session authentication is required for Machinery.','FORBIDDEN');
  const id=String(user.id||'').trim();
  if(!id)fail('Authenticated customer identity is unavailable.','UNAUTHENTICATED');
  limit(`machinery:${operation}:${id}`,max,60_000);
  return{userId:id,workspaceTenantId:id,role:'CUSTOMER'};
};
const cleanStopReason=(value:unknown)=>{
  if(value===undefined||value===null||String(value).trim()==='')return'Stopped by customer';
  const reason=String(value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if(!reason||reason.length>160||Buffer.byteLength(reason,'utf8')>STOP_REASON_MAX_BYTES)fail('Machinery stop reason is too large.');
  return reason;
};
const safeError=(error:unknown):never=>{
  if(error instanceof GraphQLError)throw error;
  const message=error instanceof Error?error.message:'';
  if(/access denied|not found|unavailable/i.test(message))fail('Machinery run is unavailable.','NOT_FOUND');
  if(/cursor|limit|idempotency|invalid|too many|requires|select|objective|closed/i.test(message))fail('Invalid Machinery request. Refresh the run and check its selections.','BAD_USER_INPUT');
  if(/stale|revision conflict/i.test(message))fail('Machinery state changed. Refresh and try again.','CONFLICT');
  fail('Machinery operation is temporarily unavailable.','INTERNAL_SERVER_ERROR');
};
const recentSummary=(snapshot:MachineryRunSnapshot)=>({
  runId:snapshot.runId,
  objective:snapshot.objective,
  state:snapshot.state,
  counts:snapshot.counts,
  globalPaused:snapshot.globalPause.paused,
  cursor:snapshot.reconnect.cursor,
  observationSequence:snapshot.reconnect.observationSequence,
  lastObservedAt:snapshot.reconnect.lastObservedAt,
  generatedAt:snapshot.generatedAt
});

export function createMachineryGraphQL(options:{store:Store;runtime:CanonicalMachineryExecutionRuntime;audit?:MachineryAuditTimelineService}){
  const {store,runtime}=options;
  if(runtime.capabilityRuntime.store!==store)throw new Error('Machinery execution runtime store mismatch.');
  const audit=options.audit??new MachineryAuditTimelineService(store);
  const typeDefs=`
    type MachineryPayload { schemaVersion:Int! dataJson:String! }
    input MachineryRunSelectionInput { orchestrationPlanId:ID! workPackageIds:[ID!]! }
    extend type Query {
      machineryRun(runId:ID!):MachineryPayload!
      machineryReconnect(runId:ID!,cursor:String!):MachineryPayload!
      machineryRuns(limit:Int):MachineryPayload!
      machineryTimeline(runId:ID!,limit:Int,cursor:String):MachineryPayload!
    }
    extend type Mutation {
      startMachineryRun(objective:String!,idempotencyKey:String!,selections:[MachineryRunSelectionInput!]!):MachineryPayload!
      advanceMachineryRun(runId:ID!):MachineryPayload!
      stopMachineryRun(runId:ID!,reason:String):MachineryPayload!
    }`;
  const resolvers={
    Query:{
      machineryRun:(_:unknown,args:{runId:string},context:Context)=>{try{const actor=customer(context,'inspect',120),result=runtime.machineryDriver.inspect(actor,String(args.runId));return payload({operation:'INSPECT',...result});}catch(error){return safeError(error)}},
      machineryReconnect:(_:unknown,args:{runId:string;cursor:string},context:Context)=>{try{const actor=customer(context,'reconnect',120),snapshot=runtime.machineryRuns.reconnect(actor,String(args.runId),String(args.cursor));return payload({operation:'RECONNECT',snapshot});}catch(error){return safeError(error)}},
      machineryRuns:(_:unknown,args:{limit?:number},context:Context)=>{try{const actor=customer(context,'list',60),requested=Number(args.limit??10);if(!Number.isSafeInteger(requested)||requested<1||requested>MAX_RECENT_RUNS)fail(`Machinery run list limit must be between 1 and ${MAX_RECENT_RUNS}.`);const runs=runtime.machineryRuns.listRuns(actor,requested).map(run=>recentSummary(runtime.machineryRuns.refresh(actor,run.id)));return payload({operation:'LIST',runs});}catch(error){return safeError(error)}},
      machineryTimeline:(_:unknown,args:{runId:string;limit?:number;cursor?:string|null},context:Context)=>{try{const actor=customer(context,'timeline',60),timeline=audit.timeline(actor,String(args.runId),{limit:args.limit,cursor:args.cursor});return payload({operation:'TIMELINE',timeline});}catch(error){return safeError(error)}}
    },
    Mutation:{
      startMachineryRun:(_:unknown,args:{objective:string;idempotencyKey:string;selections:MachineryRunSelectionInput[]},context:Context)=>{try{const actor=customer(context,'start',12);if(!Array.isArray(args.selections)||args.selections.length<1||args.selections.length>MACHINERY_RUN_LIMITS.plans)fail(`Machinery requires between 1 and ${MACHINERY_RUN_LIMITS.plans} plan selections.`);const selections=args.selections.map(item=>{if(!Array.isArray(item.workPackageIds)||item.workPackageIds.length<1)fail('Every Machinery plan selection requires explicit work-package IDs.');return{orchestrationPlanId:String(item.orchestrationPlanId),workPackageIds:item.workPackageIds.map(String)}});const total=selections.reduce((n,item)=>n+item.workPackageIds.length,0);if(total>MACHINERY_RUN_LIMITS.workPackages)fail(`Machinery selection exceeds ${MACHINERY_RUN_LIMITS.workPackages} work packages.`);if(typeof args.objective!=='string'||Buffer.byteLength(args.objective,'utf8')>MACHINERY_RUN_LIMITS.objectiveBytes)fail('Machinery objective is too large.');const snapshot=runtime.machineryRuns.start(actor,{objective:args.objective,idempotencyKey:String(args.idempotencyKey),selections});return payload({operation:'START',snapshot});}catch(error){return safeError(error)}},
      advanceMachineryRun:async(_:unknown,args:{runId:string},context:Context)=>{try{const actor=customer(context,'advance',20),result=await runtime.machineryDriver.advance(actor,String(args.runId),actor.userId);return payload({operation:'ADVANCE',...result});}catch(error){return safeError(error)}},
      stopMachineryRun:(_:unknown,args:{runId:string;reason?:string|null},context:Context)=>{try{const actor=customer(context,'stop',20),result=runtime.machineryDriver.stop(actor,String(args.runId),cleanStopReason(args.reason));return payload({operation:'STOP',...result});}catch(error){return safeError(error)}}
    }
  };
  return{typeDefs,resolvers,runtime,audit};
}
