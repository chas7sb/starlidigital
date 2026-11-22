import {missionControlRuntime,missionDevice,missionSend} from '../mission-control-mcp.js';

import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { browserPair, browserRevoke, browserSetSend, browserDevices, browserSessions, browserEnqueue, browserCommand } from '../browser-bridge.js';

export function registerBrowserBridgeTools(ctx:ToolContext) {
  const {server,principal,store,auditCall}=ctx;
  const check=()=>principal.role==='admin' && (principal.scopes.includes('admin')||principal.scopes.includes('*'));
  const invoke=async(name:string, fn:()=>unknown, sensitive=false) => {
    const start=Date.now();
    if(!store||!check()) {auditCall(name,undefined,start,'DENIED');return errorResponse('Admin scope required','DENIED');}
    try {const result=await fn(); auditCall(name,undefined,start,'SUCCESS',undefined,sensitive?{redacted:true}:undefined);return jsonResponse(result);}
    catch(e:any) {auditCall(name,undefined,start,'FAILED',undefined,undefined,String(e.message));return errorResponse(String(e.message));}
  };
  server.tool('browser_pair_create','Create a scoped one-time device credential. Return it directly to the authorized operator for entry into the extension; never log or reuse it. Sending is disabled initially.',
    {name:z.string().min(1).max(80)},async({name})=>{
      const started=Date.now();
      if(!store||!check()){auditCall('browser_pair_create',undefined,started,'DENIED');return errorResponse('Admin scope required','DENIED');}
      try {
        const pair=browserPair(store,principal.id,name);
        auditCall('browser_pair_create',pair.deviceId,started,'SUCCESS',undefined,{paired:true});
        // Deliberately bypass generic JSON redaction ONLY for this one-time, admin-only pairing result.
        // No secret is ever written to audit records or device state (only its hash is persisted).
        return {content:[{type:'text' as const,text:JSON.stringify(pair)}]};
      } catch(e:any){auditCall('browser_pair_create',undefined,started,'FAILED');return errorResponse(String(e.message));}
    });
  server.tool('browser_devices_list','List paired browser devices and availability (admin only).',{},async()=>invoke('browser_devices_list',async()=>{const mc=await missionControlRuntime();return [...browserDevices(store!,principal.id),...(mc?mc.devices(mc.store,principal.id).map((d:any)=>({...d,transport:'mission-control'})):[])];}));
  server.tool('browser_device_set_send','Enable or disable sending on an explicitly paired browser device. The extension must separately opt in locally.',
    {deviceId:z.string().uuid(),enabled:z.boolean()},async({deviceId,enabled})=>invoke('browser_device_set_send',async()=>{if(await missionDevice(principal.id,deviceId))throw Error('MISSION_CONTROL_USE_OPERATOR_DEVICE_AUTHORIZATION');return browserSetSend(store!,principal.id,deviceId,enabled);}));
  server.tool('browser_device_revoke','Immediately revoke a paired browser device.',{deviceId:z.string().uuid()},
    async({deviceId})=>invoke('browser_device_revoke',async()=>{if(await missionDevice(principal.id,deviceId))throw Error('MISSION_CONTROL_USE_OPERATOR_DEVICE_REVOCATION');return browserRevoke(store!,principal.id,deviceId);}));
  server.tool('browser_sessions_list','List recent ChatGPT conversation tabs reported by an authenticated local browser extension.',{deviceId:z.string().uuid().optional()},
    async({deviceId})=>invoke('browser_sessions_list',async()=>{const mc=await missionControlRuntime();return [...browserSessions(store!,principal.id,deviceId),...(mc?mc.sessions(mc.store,principal.id,deviceId).map((s:any)=>({...s,transport:'mission-control'})):[])];}));
  server.tool('browser_session_read','Queue reading visible message text in one authorized ChatGPT tab; inspect result via browser_command_status. Never accesses non-ChatGPT pages.',
    {deviceId:z.string().uuid(),sessionId:z.string().regex(/^[0-9]{1,12}$/),idempotencyKey:z.string().min(8).max(120)},
    async({deviceId,sessionId,idempotencyKey})=>invoke('browser_session_read',async()=>{if(await missionDevice(principal.id,deviceId))throw Error('MISSION_CONTROL_USE_COLLECT_LATEST_RESPONSE');return browserEnqueue(store!,principal.id,{deviceId,sessionId,action:'read',idempotencyKey});}));
  server.tool('browser_session_send','Queue exactly one explicitly authorized message to a ChatGPT tab. Sending requires both backend and extension opt-in. Never retry an uncertain receipt.',
    {deviceId:z.string().uuid(),sessionId:z.string().regex(/^[0-9]{1,12}$/),text:z.string().min(1).max(6000),idempotencyKey:z.string().min(8).max(120)},
    async({deviceId,sessionId,text,idempotencyKey})=>invoke('browser_session_send',async()=>{const mc=await missionDevice(principal.id,deviceId);return mc?missionSend(mc,principal.id,{deviceId,sessionId,text,idempotencyKey}):browserEnqueue(store!,principal.id,{deviceId,sessionId,text,action:'send',idempotencyKey});},true));
  server.tool('browser_command_status','Get delivery or read result for one browser command; pending and uncertain are not success.',
    {commandId:z.string().regex(/^[0-9a-f]{64}$/)},
    async({commandId})=>invoke('browser_command_status',async()=>{const mc=await missionControlRuntime();const c=mc?.store.get('browser_bridge_commands',commandId);return c&&c.ownerId===principal.id?{...mc!.command(mc!.store,principal.id,commandId),transport:'mission-control'}:browserCommand(store!,principal.id,commandId);}));
}
