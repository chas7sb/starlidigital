import type { Events } from '../events.js';
import type { Store } from '../store.js';
import { AutonomyPolicyService } from '../autonomy-policy/service.js';
import { createOperatorJob, sanitizeJobOutput, type OperatorJobRecord } from '../operator-jobs.js';
import { pushJobToDeviceSocket, validateSafeDevicePath, validateStructuredCommandArgs, type DeviceRecord } from '../operator-devices.js';
import { redactSecrets } from '../operator-auth.js';
import { deviceCapabilityDefinition, normalizeAdvertisedDeviceCapabilities } from './catalog.js';
import type { DeviceCapabilityActor, DeviceCapabilityDescriptor, DeviceCapabilityId, DeviceJobReceipt } from './types.js';

const ID=/^[A-Za-z0-9_.:@-]{1,180}$/;
const TERMINAL=new Set(['SUCCEEDED','FAILED','CANCELED','TIMED_OUT','INCERT']);
const SENSITIVE_PATH=/(?:^|[\/])(?:\.env[^\/]*|private|secrets|credentials|data|\.git|\.ssh)(?:[\/]|$)|\.(?:sqlite(?:3)?|db|pem|key|p12|pfx)$|(?:credentials|production\.env|config\.json$)/i;

function identity(value:string,label:string){const clean=String(value||'').trim();if(!ID.test(clean))throw new Error(`INVALID_${label.toUpperCase()}`);return clean;}
function safePath(value:unknown,roots:string[]){const raw=String(value??'').trim();if(SENSITIVE_PATH.test(raw))throw new Error('SENSITIVE_PATH_DENIED');return validateSafeDevicePath(raw,roots);}
function publicOutput(value:string|null|undefined,max:number){const clean=sanitizeJobOutput(value)?.trim()||'';return clean?clean.slice(0,max):null;}

export function projectDeviceJobReceipt(job:OperatorJobRecord,dispatched:boolean|null=null):DeviceJobReceipt{
 const definition=deviceCapabilityDefinition(String(job.capabilityId||''));
 if(!definition||!job.deviceId)throw new Error('DEVICE_CAPABILITY_RECEIPT_UNAVAILABLE');
 return {jobId:job.id,deviceId:job.deviceId,capabilityId:definition.id,status:job.status,sideEffectLevel:definition.sideEffectLevel,
  approval:{required:job.requiresApproval,state:!job.requiresApproval?'NOT_REQUIRED':job.approvedAt?'APPROVED':'PENDING',approvedAt:job.approvedAt},
  leaseState:job.status==='RUNNING'?'ACTIVE':TERMINAL.has(job.status)?'RELEASED':'UNCLAIMED',dispatched,
  output:publicOutput(job.output,4096),error:publicOutput(job.error,1200),exitCode:job.exitCode,
  createdAt:job.createdAt,startedAt:job.startedAt,completedAt:job.completedAt,updatedAt:job.updatedAt};
}

export class DeviceCapabilityBridge {
 private readonly policy:AutonomyPolicyService;
 constructor(private readonly store:Store,private readonly events?:Events){this.policy=new AutonomyPolicyService(store,events);}
 private actor(input:DeviceCapabilityActor):DeviceCapabilityActor{return{tenantId:identity(input.tenantId,'tenant'),operatorId:identity(input.operatorId,'operator')};}
 private scopedDevice(actorInput:DeviceCapabilityActor,deviceId:string):DeviceRecord{
  const actor=this.actor(actorInput);const device=this.store.get('operator-devices',identity(deviceId,'device')) as DeviceRecord|undefined;
  if(!device)throw new Error('DEVICE_NOT_FOUND');
  const owner=String(device.pairedBy||device.ownerId||'');const tenant=String((device as any).tenantId||device.ownerId||device.pairedBy||'');
  if(owner!==actor.operatorId||tenant!==actor.tenantId)throw new Error('DEVICE_SCOPE_DENIED');
  if(device.status==='REVOKED'||device.revokedAt)throw new Error('DEVICE_REVOKED');return device;
 }
 private descriptors(device:DeviceRecord):DeviceCapabilityDescriptor[]{
  if(device.status!=='ONLINE')return[];
  return normalizeAdvertisedDeviceCapabilities(device.capabilities||[]).flatMap(id=>{const definition=deviceCapabilityDefinition(id);return definition?[{...definition,deviceId:device.id,deviceName:String(device.name||'Device').slice(0,120),deviceStatus:device.status,advertised:true as const}]:[];});
 }
 list(actorInput:DeviceCapabilityActor){const actor=this.actor(actorInput);return(this.store.list('operator-devices') as DeviceRecord[]).filter(device=>String(device.pairedBy||device.ownerId||'')===actor.operatorId).filter(device=>String((device as any).tenantId||device.ownerId||device.pairedBy||'')===actor.tenantId).slice(0,50).map(device=>({deviceId:device.id,deviceName:String(device.name||'Device').slice(0,120),status:device.status,capabilities:this.descriptors(device)}));}
 capabilities(actorInput:DeviceCapabilityActor,deviceId:string){return this.descriptors(this.scopedDevice(actorInput,deviceId));}
 receipt(actorInput:DeviceCapabilityActor,jobId:string){const actor=this.actor(actorInput);const job=this.store.get('operator-jobs',identity(jobId,'job')) as OperatorJobRecord|undefined;if(!job||!job.deviceId||!job.capabilityId)throw new Error('DEVICE_JOB_NOT_FOUND');if(String(job.actorId)!==actor.operatorId||String(job.tenantId||job.actorId)!==actor.tenantId)throw new Error('DEVICE_JOB_SCOPE_DENIED');this.scopedDevice(actor,job.deviceId);return projectDeviceJobReceipt(job);}
 submit(actorInput:DeviceCapabilityActor,input:{deviceId:string;capabilityId:string;input?:Record<string,unknown>;idempotencyKey?:string}){
  const actor=this.actor(actorInput),device=this.scopedDevice(actor,input.deviceId);if(device.status!=='ONLINE')throw new Error('DEVICE_OFFLINE');
  const definition=deviceCapabilityDefinition(input.capabilityId);if(!definition)throw new Error('UNKNOWN_DEVICE_CAPABILITY');
  if(!normalizeAdvertisedDeviceCapabilities(device.capabilities||[]).includes(definition.id))throw new Error('DEVICE_CAPABILITY_NOT_ADVERTISED');
  if(definition.authority!=='DEVICE_JOB')throw new Error('GOVERNED_MESSAGING_REQUIRED');
  if(definition.sideEffectLevel!=='READ'&&this.policy.record(actor.tenantId).pauseAll)throw new Error('GLOBAL_PAUSED');
  const key=String(input.idempotencyKey||'').trim();if(definition.sideEffectLevel!=='READ'&&(!key||key.length<8||key.length>120))throw new Error('IDEMPOTENCY_REQUIRED');
  if(key&&!/^[A-Za-z0-9_.:@-]{1,120}$/.test(key))throw new Error('INVALID_IDEMPOTENCY_KEY');
  const args=this.jobArgs(definition.id,input.input||{},device);
  const {job}=createOperatorJob(this.store,this.events,{actorId:actor.operatorId,tenantId:actor.tenantId,capabilityId:definition.id,sideEffectLevel:definition.sideEffectLevel,kind:definition.jobKind!,targetType:'device',targetId:device.id,deviceId:device.id,idempotencyKey:key?`device-cap:${actor.tenantId}:${definition.id}:${key}`:undefined,args,requiresApproval:definition.approvalRequired});
  const dispatched=job.status==='QUEUED_DEVICE'?pushJobToDeviceSocket(device.id,job):false;return projectDeviceJobReceipt(job,dispatched);
 }
 private jobArgs(capabilityId:DeviceCapabilityId,input:Record<string,unknown>,device:DeviceRecord):Record<string,unknown>{
  const keys=Object.keys(input);const only=(...allowed:string[])=>{if(keys.some(key=>!allowed.includes(key)))throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');};
  if(capabilityId==='device.fs.read'){only('path');return{path:safePath(input.path,device.allowedRoots)};}
  if(capabilityId==='device.fs.write'){only('path','content');const path=safePath(input.path,device.allowedRoots),content=String(input.content??'');if(Buffer.byteLength(content,'utf8')>250000)throw new Error('DEVICE_WRITE_TOO_LARGE');if(redactSecrets(content)!==content)throw new Error('SECRET_CONTENT_DENIED');return{path,content};}
  if(capabilityId==='device.dev.git'){only('operation','cwd');const cwd=safePath(input.cwd,device.allowedRoots),operation=String(input.operation||'');const args=operation==='version'?['--version']:operation==='status'?['status','--short']:operation==='diff_stat'?['diff','--stat']:null;if(!args)throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');return{cwd,...validateStructuredCommandArgs('git',args)};}
  if(capabilityId==='device.dev.node'||capabilityId==='device.dev.npm'){only('operation','cwd');if(input.operation!=='version')throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');const cwd=safePath(input.cwd,device.allowedRoots),tool=capabilityId==='device.dev.node'?'node':'npm';return{cwd,...validateStructuredCommandArgs(tool,['--version'])};}
  if(capabilityId==='device.adb.inventory'){only();return{};}
  if(capabilityId.startsWith('device.gui.')){
   const windowId=(value:unknown)=>{const id=String(value??'').trim();if(!/^\d{1,20}$/.test(id)||id==='0')throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');return id;};
   const integer=(value:unknown,min:number,max:number,fallback?:number)=>{if(value===undefined&&fallback!==undefined)return fallback;if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');return value;};
   if(capabilityId==='device.gui.windows.list'){only('limit');return{limit:integer(input.limit,1,50,30)};}
   if(capabilityId==='device.gui.foreground'||capabilityId==='device.gui.screen.info'){only();return{};}
   if(capabilityId==='device.gui.window.focus'){only('windowId');return{windowId:windowId(input.windowId)};}
   if(capabilityId==='device.gui.mouse.move'){only('windowId','x','y');return{windowId:windowId(input.windowId),x:integer(input.x,-32768,32767),y:integer(input.y,-32768,32767)};}
   if(capabilityId==='device.gui.mouse.click'){only('windowId','x','y','button','count');const button=String(input.button??'left').toLowerCase();if(!['left','right','middle'].includes(button))throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');return{windowId:windowId(input.windowId),x:integer(input.x,-32768,32767),y:integer(input.y,-32768,32767),button,count:integer(input.count,1,2,1)};}
   if(capabilityId==='device.gui.keyboard.text'){only('windowId','text');const text=String(input.text??'');if(!text||Buffer.byteLength(text,'utf8')>2000||/[\u0000-\u001f\u007f]/.test(text))throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');return{windowId:windowId(input.windowId),text};}
   if(capabilityId==='device.gui.keyboard.key'){only('windowId','keys');const allowed=new Set(['ENTER','TAB','ESCAPE','BACKSPACE','DELETE','LEFT','RIGHT','UP','DOWN','HOME','END','PAGEUP','PAGEDOWN','SPACE']);if(!Array.isArray(input.keys)||input.keys.length<1||input.keys.length>12)throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');const keys=input.keys.map(v=>String(v).toUpperCase());if(keys.some(k=>!allowed.has(k)))throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');return{windowId:windowId(input.windowId),keys};}
   if(capabilityId==='device.gui.capture'){only('scope','windowId','maxWidth','maxHeight','quality','maxEncodedBytes');const scope=String(input.scope??'desktop').toLowerCase();if(!['desktop','window'].includes(scope))throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');const out:Record<string,unknown>={scope,maxWidth:integer(input.maxWidth,160,1280,960),maxHeight:integer(input.maxHeight,120,720,540),quality:integer(input.quality,25,70,45),maxEncodedBytes:integer(input.maxEncodedBytes,4096,24000,24000)};if(scope==='window')out.windowId=windowId(input.windowId);else if(input.windowId!==undefined)throw new Error('INVALID_DEVICE_CAPABILITY_INPUT');return out;}
  }
  throw new Error('GOVERNED_MESSAGING_REQUIRED');
 }
}
