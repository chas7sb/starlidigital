/** Captured company credential transport. Native subscriptions retain their SDK driver. */
import {accountDriver} from './runtime/company_bot_runtime/sdk/account-driver.mts';
import {lookup} from 'node:dns/promises';
import https from 'node:https';
import {Readable} from 'node:stream';
export function publicIPv4(address:string){
 const p=address.split('.').map(Number);
 if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 const [a,b,c]=p;
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===192&&b===0||a===192&&b===2||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
}
export async function configure(envelope:any,signal:AbortSignal){
 if(envelope?.version!=='starli.company-provider.v1'||envelope.provider==='hosted'||!envelope.credential)throw Error('COMPANY_SELECTED_PROVIDER_REQUIRED');
 return {selectedFactory:async({authorize,refreshCredential}:any)=>{
  const credential=envelope.credential;
  const options:any={selection:{provider:envelope.provider,model:envelope.model,modelsState:envelope.catalogState,credentials:{[envelope.provider]:credential}},signal,authorize,saveCredential:refreshCredential};
  if(credential.endpointKind){
   if(!/^endpoint-[a-f0-9-]{36}$/.test(envelope.provider)||!['ollama','openai-compatible'].includes(credential.endpointKind)||credential.type!=='api_key'||typeof credential.key!=='string'||!credential.key||!Array.isArray(credential.models)||!credential.models.includes(envelope.model)||credential.models.length>2000||credential.models.some((m:any)=>typeof m!=='string'||!m.length||m.length>180))throw Error('CUSTOM_PROVIDER_DESCRIPTOR_INVALID');
   const base=new URL(credential.baseUrl);
   if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.port&&base.port!=='443')throw Error('CUSTOM_PROVIDER_ENDPOINT_DENIED');
   const check=async()=>{signal.throwIfAborted();if(await authorize()!==true)throw Error('CUSTOM_PROVIDER_AUTHORIZATION_DENIED');signal.throwIfAborted();};
   const pinnedFetch:typeof fetch=async(input,init)=>{
    await check();const request=new Request(input,init);const url=new URL(request.url);
    const prefix=base.pathname.replace(/\/$/,'')+'/';
    if(url.origin!==base.origin||!url.pathname.startsWith(prefix)||url.username||url.password)throw Error('CUSTOM_PROVIDER_ENDPOINT_CHANGED');
    const addresses=await lookup(url.hostname,{family:4,all:true});
    if(!addresses.length||addresses.some(item=>!publicIPv4(item.address)))throw Error('CUSTOM_PROVIDER_PRIVATE_DESTINATION_DENIED');
    const address=addresses[0].address;await check();
    const body=request.method==='GET'||request.method==='HEAD'?undefined:Buffer.from(await request.arrayBuffer());
    if(body&&body.length>4*1024*1024)throw Error('CUSTOM_PROVIDER_REQUEST_LIMIT');
    const combined=AbortSignal.any([signal,request.signal]);
    return await new Promise<Response>((resolve,reject)=>{
     const req=https.request(url,{method:request.method,headers:Object.fromEntries(request.headers),signal:combined,servername:url.hostname,
      lookup:(_host:any,opts:any,callback:any)=>opts?.all?callback(null,[{address,family:4}]):callback(null,address,4)},response=>{
       if((response.statusCode??500)>=300&&(response.statusCode??500)<400){response.resume();reject(Error('CUSTOM_PROVIDER_REDIRECT_DENIED'));return;}
       const headers=new Headers();for(const [key,value]of Object.entries(response.headers)){if(Array.isArray(value))for(const item of value)headers.append(key,item);else if(value!==undefined)headers.set(key,String(value));}
       resolve(new Response(Readable.toWeb(response)as any,{status:response.statusCode??502,headers}));
      });
     req.on('error',()=>reject(Error('CUSTOM_PROVIDER_NETWORK_ERROR')));if(body)req.write(body);req.end();
    });
   };
   const sdk=process.env.STARLI_COMPANY_PI_SDK;
   if(!sdk?.startsWith('/')||sdk.split('/').includes('..'))throw Error('COMPANY_SDK_INSTALL_REQUIRED');
   const {ModelRuntime}=await import(sdk+'/pi-coding-agent/dist/index.js');
   const {streamSimple}=await import(sdk+'/pi-ai/dist/api/openai-completions.js');
   options.fetch=pinnedFetch;
   options.ModelRuntime={async create(config:any){
    const runtime=await ModelRuntime.create(config);
    runtime.registerNativeProvider({id:envelope.provider,name:'Company endpoint',
     auth:{apiKey:{name:'Stored company endpoint key',async resolve(){return{auth:{apiKey:credential.key}};},async check(){return true;}}},
     getModels(){return credential.models.map((id:string)=>({id,name:id,provider:envelope.provider,api:'openai-completions',baseUrl:base.toString().replace(/\/$/,''),reasoning:false,input:['text'],contextWindow:32768,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsDeveloperRole:false,supportsStore:false}}));},
     stream:streamSimple,streamSimple});return runtime;
   }};
  }
  const driver=await accountDriver(options);return {...driver,publicReceipt(){return driver.receipt;},dispose(){}};
 }};
}
