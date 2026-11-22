import {Store,id,now} from './store.js';

export type OperatorRunCancellation = {canceledIds:string[];uncertainIds:string[]};

/** Startup reconciliation never resumes unknown effects or leaves orphaned Windows jobs runnable. */
export function recoverInterruptedOperatorRuns(store:Store){
 let recovered=0;for(const run of store.list('operator-agent-runs')){if(run.status!=='RUNNING')continue;
  const canceled=cancelQueuedOperatorRunJobs(store,run.id,run.ownerId),uncertain=canceled.uncertainIds.length>0||store.list('operator-tool-receipts').some(r=>r.runId===run.id&&r.status==='NEEDS_REVIEW');
  store.put('operator-agent-runs',{...run,status:uncertain?'NEEDS_REVIEW':'INTERRUPTED',error:'Serviciul a fost repornit. Verifică rezultatele confirmate înainte de continuare; operațiunile externe nu au fost repetate.',unknownOutcome:uncertain,cancellation:canceled,completedAt:now(),updatedAt:now()},run.ownerId);recovered++;
 }return recovered;
}

/** Stop only work owned by this run. Already running effects cannot be proven canceled. */
export function cancelQueuedOperatorRunJobs(store:Store,runId:string,ownerId:string):OperatorRunCancellation {
 const result:OperatorRunCancellation={canceledIds:[],uncertainIds:[]};
 if(!runId||!ownerId)return result;
 const nested=store.db.isTransaction,savepoint='run_cancel_'+id().replace(/-/g,'');
 store.db.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');
 try{
  for(const candidate of store.list('operator-jobs')){
   if(candidate.runId!==runId||candidate.actorId!==ownerId)continue;
   const job=store.get('operator-jobs',candidate.id)!;
   if(!['PENDING','QUEUED_DEVICE','AWAITING_APPROVAL','RUNNING'].includes(job.status))continue;
   const uncertain=job.status==='RUNNING',timestamp=now();
   store.put('operator-jobs',{...job,status:uncertain?'INCERT':'CANCELED',cancelRequestedAt:timestamp,
    error:uncertain?'Rularea a fost oprită după preluarea lucrării. Execuția externă poate continua; verifică rezultatul înainte de repetare.':'Rularea a fost oprită înainte de preluarea lucrării.',
    leaseToken:null,leaseUntil:0,completedAt:timestamp,updatedAt:timestamp},ownerId);
   (uncertain?result.uncertainIds:result.canceledIds).push(job.id);
  }
  store.db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');return result;
 }catch(error){if(nested){store.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);store.db.exec(`RELEASE SAVEPOINT ${savepoint}`);}else if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
}
