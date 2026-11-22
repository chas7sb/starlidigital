import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const error=code=>Object.assign(Error(code),{code});
export function createAsyncNativeVerifier(config){
 const fixed={nativeRoot:resolve(config.nativeRoot),authorityPackage:resolve(config.authorityPackage),orchestrationPackage:resolve(config.orchestrationPackage),contextModule:resolve(config.contextModule||join(root,'../preview-lifecycle-r1/verified-context.mjs'))};
 const active=new Set(),queue=[];let closed=false;
 const maxWorkers=2,maxQueued=8,deadlineMs=48000;
 function pump(){
  while(!closed&&active.size<maxWorkers&&queue.length){
   const job=queue.shift();const remaining=deadlineMs-(Date.now()-job.enqueuedAt);if(remaining<=0){job.reject(error('NATIVE_VERIFICATION_DEADLINE'));continue;}let worker;
   try{worker=new Worker(new URL('./context-worker.mjs',import.meta.url),{workerData:{operation:job.operation,config:fixed,input:job.input},resourceLimits:{maxOldGenerationSizeMb:128}});}catch{job.reject(error('NATIVE_VERIFICATION_WORKER_UNAVAILABLE'));continue;}
   const record={worker,cancel:()=>finish(error('NATIVE_VERIFICATION_CANCELLED'))};active.add(record);let settled=false;
   const timer=setTimeout(()=>finish(error('NATIVE_VERIFICATION_DEADLINE')),remaining);
   function finish(err,result){if(settled)return;settled=true;clearTimeout(timer);active.delete(record);worker.removeAllListeners();worker.terminate().catch(()=>{});err?job.reject(err):job.resolve(result);pump();}
   worker.once('message',m=>{if(m?.ok===true)finish(null,m.result);else finish(error(typeof m?.code==='string'?m.code:'NATIVE_VERIFICATION_FAILED'));});
   worker.once('error',()=>finish(error('NATIVE_VERIFICATION_WORKER_FAILED')));
   worker.once('exit',()=>finish(error('NATIVE_VERIFICATION_WORKER_EXITED')));
  }
 }
 function call(operation,input){if(closed)return Promise.reject(error('NATIVE_VERIFIER_CLOSED'));if(queue.length>=maxQueued)return Promise.reject(error('NATIVE_VERIFICATION_BUSY'));return new Promise((resolve,reject)=>{queue.push({operation,input,resolve,reject,enqueuedAt:Date.now()});pump();});}
 async function close(){closed=true;while(queue.length)queue.shift().reject(error('NATIVE_VERIFICATION_CANCELLED'));const workers=[...active];for(const r of workers)r.cancel();await Promise.allSettled(workers.map(r=>r.worker.terminate()));}
 return {context:({intentId,nativeJwt,allowStoppedGraph=false})=>call('context',{intentId,nativeJwt,allowStoppedGraph}),nativeJwt:(companyId,nativeJwt)=>call('nativeJwt',{companyId,nativeJwt}),close,stats:()=>({active:active.size,queued:queue.length,maxWorkers,maxQueued,deadlineMs})};
}
