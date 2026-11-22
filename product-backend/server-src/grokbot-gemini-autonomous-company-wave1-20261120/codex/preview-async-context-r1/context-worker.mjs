import {parentPort,workerData} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const pins={context:'d08fa96fb90855dc711022b66e4f11b39c946a2540541be10e77948f25c85a70',native:'f0aea65eaad194834b6e3e65f3f06e26b5e279d6be743e155d96bb4380818367'};
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
try{
 const {operation,config,input}=workerData;
 const nativeModule=join(config.authorityPackage,'server/native-authority.ts');
 if(sha(nativeModule)!==pins.native)throw Error('NATIVE_VERIFIER_SOURCE_DRIFT');
 process.env.GB3_DISPOSABLE_PARENT=dirname(resolve(config.nativeRoot));
 let result;
 if(operation==='context'){
  if(sha(config.contextModule)!==pins.context)throw Error('NATIVE_CONTEXT_SOURCE_DRIFT');
  const {resolveVerifiedContext}=await import(pathToFileURL(config.contextModule).href);
  result=await resolveVerifiedContext({...config,...input});
 }else if(operation==='nativeJwt'){
  const {verifyNativeJwt}=await import(pathToFileURL(nativeModule).href);
  result=verifyNativeJwt(config.nativeRoot,input.companyId,input.nativeJwt);
 }else throw Error('UNRECOGNIZED_VERIFICATION_OPERATION');
 parentPort.postMessage({ok:true,result});
}catch(e){const raw=e.code||e.message||'NATIVE_VERIFICATION_FAILED';parentPort.postMessage({ok:false,code:/^[A-Z0-9_]{1,100}$/.test(raw)?raw:'NATIVE_VERIFICATION_FAILED'});}
