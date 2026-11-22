import {createServer} from 'node:http';
import {lstatSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../store.js';
import {Lcg2MissionControlQueue} from './lcg2-queue.js';
import {mountMissionControlOperatorHost} from './codex-operator-host.js';
import {attachReadOnlyOperatorAuth} from './preview-auth.js';

export async function startAuthenticatedPreview(config:{state:string;authDatabase:string;port:number;extensionOrigin:string;operatorOrigin:string;prefix?:string}){
 const meta=lstatSync(config.state);
 if(!isAbsolute(config.state)||!meta.isDirectory()||meta.uid!==process.getuid?.()||(meta.mode&0o077)!==0||
  !Number.isInteger(config.port)||config.port<0||config.port>65535)throw Error('MC_PREVIEW_PRIVATE_STATE_REQUIRED');
 const path=join(config.state,'mission-control.sqlite');
 if(resolve(path)===resolve(config.authDatabase))throw Error('MC_PREVIEW_STATE_MUST_BE_SEPARATE');
 const store=new Store(path);let host:ReturnType<typeof mountMissionControlOperatorHost>|undefined;
 const server=createServer((req,res)=>{
  if(req.url==='/healthz'&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
   res.end(JSON.stringify({status:host?'ok':'initializing',mode:'authenticated-preview',productionReady:false,
    release:process.env.MC_PREVIEW_RELEASE_SHA??null}));return;
  }
  if(!host){res.writeHead(503);res.end();return;}
  void host.handleHttp(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}})
   .catch(()=>{if(!res.headersSent)res.writeHead(503);res.end();});
 });
 try{
  attachReadOnlyOperatorAuth(store,config.authDatabase);
  new Lcg2MissionControlQueue(path).close();
  host=mountMissionControlOperatorHost({store,server,operatorOrigin:config.operatorOrigin,extensionOrigins:[config.extensionOrigin],
   isolatedLoopbackTest:config.operatorOrigin.startsWith('http://127.0.0.1:'),operatorPathPrefix:config.prefix});
  server.on('upgrade',(req,socket)=>{if(!host?.ownsUpgrade(req.url?.split('?')[0]??''))socket.destroy();});
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(config.port,'127.0.0.1',ok);});
  return {server,store,close:async()=>{host?.close();server.closeAllConnections();
   await new Promise<void>((ok,fail)=>server.close(e=>e?fail(e):ok()));store.close();}};
 }catch(e){host?.close();if(server.listening)server.close();store.close();throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 process.umask(0o077);
 const app=await startAuthenticatedPreview({state:process.env.STATE_DIRECTORY??'',authDatabase:process.env.MC_PREVIEW_AUTH_DATABASE??'',
  port:Number(process.env.MC_PREVIEW_PORT??'4141'),extensionOrigin:process.env.MC_PREVIEW_EXTENSION_ORIGIN??'',
  operatorOrigin:process.env.MC_PREVIEW_OPERATOR_ORIGIN??'http://127.0.0.1:4141',prefix:process.env.MC_PREVIEW_PATH_PREFIX??'/mission-control-preview'});
 let closing=false;const close=()=>{if(closing)return;closing=true;void app.close().catch(()=>{process.exitCode=1;});};
 process.once('SIGTERM',close);process.once('SIGINT',close);
}
