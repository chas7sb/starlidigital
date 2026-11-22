/** Metadata/auth adapter. Credentials enter stdin only; no inference operation. */
import{createInterface}from'node:readline';
const rows=createInterface({input:process.stdin})[Symbol.asyncIterator]();
const first=await rows.next();if(first.done)throw Error('REQUEST_REQUIRED');
const request=JSON.parse(first.value),controller=new AbortController();
const sdk=process.env.STARLI_COMPANY_PI_SDK;
if(!sdk||sdk.includes('..'))throw Error('COMPANY_SDK_REQUIRED');
const{ModelRuntime}=await import(sdk+'/pi-coding-agent/dist/index.js');
const credential=request.credential;
const data=new Map(credential?[[request.provider,credential]]:[]);
const modelStates=new Map<string,any>();
const credentials={async read(id:string){return data.get(id);},async list(){return[...data].map(([providerId,c]:any)=>({providerId,type:c.type}));},
 async modify(id:string,change:any){if(id!==request.provider)throw Error('CREDENTIAL_SCOPE_DENIED');const next=await change(data.get(id));if(next!==undefined)data.set(id,next);return data.get(id);},async delete(){throw Error('CREDENTIAL_SCOPE_DENIED');}};
try{
 if(credential&&(!['api_key','oauth'].includes(credential.type)||credential.env&&Object.keys(credential.env).length))throw Error('CREDENTIAL_INVALID');
 const runtime=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{async read(id:string){return modelStates.get(id);},async write(id:string,value:any){modelStates.set(id,value);},async delete(id:string){modelStates.delete(id);}},allowModelNetwork:false,refreshOnCreate:false,signal:controller.signal});
 const ids=(p:string)=>runtime.getAllModels(p).filter((m:any)=>m.input?.includes('text')&&typeof m.api==='string').map((m:any)=>m.id);
 let result:any;
 if(request.operation==='catalog'){
  result={providers:runtime.getProviders().filter((p:any)=>p.auth?.apiKey||p.auth?.oauth).map((p:any)=>({id:p.id,models:ids(p.id)}))};
 }else if(request.operation==='probe'){
  const models=runtime.getAllModels(request.provider).filter((m:any)=>m.input?.includes('text'));
  if(!models.length)throw Error('PROVIDER_UNSUPPORTED');
  const auth=await runtime.getAuth(models[0],{signal:controller.signal});
  const key=credential.type==='oauth'?credential.access:credential.key;
  if(!auth?.auth||auth.auth.apiKey!==key)throw Error('CREDENTIAL_INVALID');
  result={configured:true};
 }else if(request.operation==='refresh'){
  const refreshed=await runtime.refresh({allowNetwork:true,providers:[request.provider],force:true,signal:controller.signal});
  if(refreshed.errors.size)throw Error('MODEL_REFRESH_FAILED');
  result={models:ids(request.provider),modelsState:modelStates.get(request.provider)??null,credential:data.get(request.provider)};
 }else throw Error('OPERATION_UNSUPPORTED');
 process.stdout.write(JSON.stringify({ok:true,...result})+'\n');
}catch{process.stdout.write('{"ok":false,"code":"COMPANY_PROVIDER_METADATA_FAILED"}\n');process.exitCode=1;}
finally{controller.abort();rows.return?.();process.stdin.pause();}
