import {createServer} from 'node:http';
import {isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {lstatSync,readFileSync} from 'node:fs';
import {Store} from '../store.js';
import {Lcg2MissionControlQueue} from './lcg2-queue.js';
import {mountMissionControlOperatorHost} from './codex-operator-host.js';

export async function startMissionControlStage(state:string,port:number,origin:string){
 if(!isAbsolute(state)||!Number.isInteger(port)||port<0||port>65535||
    !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))throw Error('MISSION_CONTROL_STAGE_CONFIGURATION_INVALID');
 const directory=lstatSync(state);
 if(!directory.isDirectory()||directory.uid!==process.getuid?.()||(directory.mode&0o077)!==0)
  throw Error('MISSION_CONTROL_PRIVATE_STATE_REQUIRED');
 const witnessId=process.env.MC_STAGE_WITNESS_ID;
 let witness:{witnessId:string;witnessPublicKeyPem:string}|undefined;
 if(witnessId){
  const file=join(state,'witness-public.pem'),meta=lstatSync(file);
  if(!meta.isFile()||meta.nlink!==1||meta.size>4096||meta.uid!==process.getuid?.()||(meta.mode&0o077)!==0)
   throw Error('MC_STAGE_WITNESS_FILE_NOT_PRIVATE');
  witness={witnessId,witnessPublicKeyPem:readFileSync(file,'utf8')};
 }
 const database=join(state,'mission-control.sqlite'),store=new Store(database);
 let host:ReturnType<typeof mountMissionControlOperatorHost>|undefined;
 const server=createServer((req,res)=>{
  if(req.method==='GET'&&req.url==='/healthz'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
   res.end(JSON.stringify({status:host?'ok':'initializing',mode:'isolated-stage',liveCommands:false}));return;
  }
  if(!host){res.writeHead(503);res.end();return;}
  void host.handleHttp(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}})
   .catch(()=>{if(!res.headersSent)res.writeHead(503);res.end();});
 });
 try{
  new Lcg2MissionControlQueue(database).close();
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  const address=server.address();
  if(!address||typeof address==='string')throw Error('MC_STAGE_ADDRESS_UNAVAILABLE');
  host=mountMissionControlOperatorHost({store,server,operatorOrigin:'http://127.0.0.1:'+address.port,
   extensionOrigins:[origin],isolatedLoopbackTest:true,witness});
  server.on('upgrade',(req,socket)=>{
   if(!host?.ownsUpgrade(req.url?.split('?')[0]??''))socket.destroy();
  });
  return {server,close:async()=>{
   host?.close();server.closeAllConnections();
   await new Promise<void>((ok,fail)=>server.close(error=>error?fail(error):ok()));store.close();
  }};
 }catch(error){
  host?.close();server.closeAllConnections();
  if(server.listening)await new Promise<void>(ok=>server.close(()=>ok()));
  store.close();throw error;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 process.umask(0o077);
 const app=await startMissionControlStage(
  process.env.STATE_DIRECTORY??'',Number(process.env.MC_STAGE_PORT??'4140'),process.env.MC_STAGE_EXTENSION_ORIGIN??'');
 const stop=()=>{void app.close().catch(()=>{process.exitCode=1;});};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
