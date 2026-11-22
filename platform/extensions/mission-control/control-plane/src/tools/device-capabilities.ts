import { z } from 'zod';
import { DeviceCapabilityBridge } from '../../../server/src/device-capabilities/service.js';
import type { ToolContext } from './common.js';
import { errorResponse, jsonResponse } from './common.js';
import { hasScope } from './security.js';

const id=z.string().min(1).max(180).regex(/^[A-Za-z0-9_.:@-]+$/);
const capability=z.string().min(3).max(80).regex(/^device\.[a-z0-9_.-]+$/);
const idem=z.string().min(8).max(120).regex(/^[A-Za-z0-9_.:@-]+$/).optional();
const errorCode=(error:unknown)=>{const raw=error instanceof Error?error.message:'';return /^[A-Z][A-Z0-9_]{2,79}$/.test(raw)?raw:'DEVICE_BRIDGE_FAILED';};

export function registerDeviceCapabilityTools(ctx:ToolContext){
 const {server,store,events,principal}=ctx;
 const run=async(name:string,write:boolean,args:unknown,fn:(bridge:DeviceCapabilityBridge)=>unknown)=>{
  const start=Date.now();
  if(principal.role!=='admin'||!hasScope(principal,write?'write':'read')){ctx.auditCall(name,undefined,start,'DENIED',undefined,undefined,'Permission denied');return errorResponse('Administrator and matching scope required','FORBIDDEN');}
  if(!store){ctx.auditCall(name,undefined,start,'FAILED',undefined,undefined,'Platform database unavailable');return errorResponse('Platform database unavailable','SERVICE_UNAVAILABLE');}
  try{const result=await fn(new DeviceCapabilityBridge(store,events));ctx.auditCall(name,undefined,start,'SUCCESS',undefined,{bounded:true});return jsonResponse(result);}
  catch(error){const code=errorCode(error);ctx.auditCall(name,undefined,start,'FAILED',undefined,undefined,code);return errorResponse('Device capability operation could not complete. Inspect current device, policy and approval state before retrying.',code);}
 };
 server.tool('device_capabilities_list','List only capabilities currently advertised by operator-owned paired devices.',{deviceId:id.optional()},{readOnlyHint:true,destructiveHint:false,idempotentHint:true},async raw=>{
  const args=z.object({deviceId:id.optional()}).strict().parse(raw);return run('device_capabilities_list',false,args,bridge=>args.deviceId?{deviceId:args.deviceId,capabilities:bridge.capabilities({tenantId:principal.id,operatorId:principal.id},args.deviceId)}:{devices:bridge.list({tenantId:principal.id,operatorId:principal.id})});
 });
 server.tool('device_job_submit','Submit one typed device capability through the existing leased operator-job authority. Mutations may require approval.',{deviceId:id,capabilityId:capability,inputJson:z.string().max(262144).default('{}'),idempotencyKey:idem},{readOnlyHint:false,destructiveHint:true,idempotentHint:true},async raw=>{
  const args=z.object({deviceId:id,capabilityId:capability,inputJson:z.string().max(262144).default('{}'),idempotencyKey:idem}).strict().parse(raw);let input:Record<string,unknown>;try{const parsed=JSON.parse(args.inputJson);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();input=parsed;}catch{return errorResponse('inputJson must be a JSON object','BAD_USER_INPUT');}
  return run('device_job_submit',true,args,bridge=>bridge.submit({tenantId:principal.id,operatorId:principal.id},{deviceId:args.deviceId,capabilityId:args.capabilityId,input,idempotencyKey:args.idempotencyKey}));
 });
 server.tool('device_job_get','Inspect a bounded device job receipt without raw arguments, secrets or lease tokens.',{jobId:id},{readOnlyHint:true,destructiveHint:false,idempotentHint:true},async raw=>{
  const args=z.object({jobId:id}).strict().parse(raw);return run('device_job_get',false,args,bridge=>bridge.receipt({tenantId:principal.id,operatorId:principal.id},args.jobId));
 });
}
