import {pathToFileURL} from 'node:url';
import {isAbsolute,join} from 'node:path';
import type {Store} from '../../server/src/store.js';

type Runtime={store:Store; sessions:Function;devices:Function;enqueue:Function;command:Function;dispatch:Function};
let pending:Promise<Runtime|undefined>|undefined;
export async function missionControlRuntime():Promise<Runtime|undefined>{
 const root=process.env.MC_MCP_RUNTIME_ROOT,db=process.env.MC_MCP_DATABASE_PATH,auth=process.env.DATABASE_PATH||(process.env.NODE_ENV==='production'?'/var/lib/starlidigital/starli.sqlite':undefined);
 if(!root&&!db)return undefined;
 if(!root||!db||!auth||![root,db,auth].every(isAbsolute)||db===auth)throw Error('MISSION_CONTROL_CONFIG_INVALID');
 if(!pending)pending=(async()=>{
  const load=(p:string)=>import(pathToFileURL(join(root,p)).href);
  const [{Store},bridge,authority,automatic]=await Promise.all([
   load('server/src/store.ts'),load('control-plane/src/browser-bridge.ts'),
   load('server/src/mission-control/preview-auth.ts'),load('server/src/mission-control/automatic-command.ts')]);
  const store=new Store(db);
  try{authority.attachReadOnlyOperatorAuth(store,auth);}catch(e){store.close();throw e;}
  return {store,sessions:bridge.browserSessions,devices:bridge.browserDevices,enqueue:bridge.browserEnqueue,
   command:bridge.browserCommand,dispatch:automatic.dispatchAutomaticCommand};
 })().catch(e=>{pending=undefined;throw e;});
 return pending;
}
export async function missionDevice(owner:string,id:string){
 const runtime=await missionControlRuntime();if(!runtime)return;
 const device=runtime.store.get('browser_bridge_devices',id);
 if(device){if(device.ownerId!==owner)throw Error('DEVICE_UNAVAILABLE');return runtime;}
}
export async function missionSend(runtime:Runtime,owner:string,args:{deviceId:string;sessionId:string;text:string;idempotencyKey:string}){
 const {store}=runtime;
 const device=store.get('browser_bridge_devices',args.deviceId);
 if(device?.ownerId!==owner||device?.automaticSendEnabled!==true)throw Error('MISSION_CONTROL_AUTOMATIC_AUTHORIZATION_REQUIRED');
 const binding=store.db.prepare('SELECT * FROM mc_verified_tab_bindings WHERE tenant=? AND device_id=? AND tab_id=?')
  .get(owner,args.deviceId,Number(args.sessionId));
 if(!binding)throw Error('MISSION_CONTROL_TARGET_UNVERIFIED');
 // The canonical queue validates current URL, consent, tenant and grant before mutation.
 const result=runtime.enqueue(store,owner,{...args,action:'send'});
 const command=store.get('browser_bridge_commands',result.commandId)!;
 // Never replay an existing offer or uncertain attempt under the same key.
 if(command.status!=='queued'||command.missionControlNonce)return {...result,transport:'mission-control',executed:false};
 store.put('browser_bridge_commands',{...command,autoRequestedTabSessionId:binding.session_id,
  autoRequestedOperatorSessionHash:binding.session_hash,autoRequestedSessionEpoch:binding.session_epoch},owner);
 runtime.dispatch(store,owner,result.commandId,String(binding.session_hash));
 const updated=store.get('browser_bridge_commands',result.commandId)!;
 return {commandId:result.commandId,status:updated.status,transport:'mission-control',executed:false};
}
