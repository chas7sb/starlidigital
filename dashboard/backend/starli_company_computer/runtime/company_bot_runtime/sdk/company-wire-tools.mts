import {createHash} from 'node:crypto';
import type {ToolSpec,Checkpoint} from './pi-live-agent.mts';
export function accountWireTools(tools:ToolSpec[]){
 const canonicalByWire=new Map<string,string>();
 const toWire=(name:string)=>{
  if(!/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(name))throw Error('NATIVE_PI_TOOL_NAME_INVALID');
  if(/^[A-Za-z0-9_-]{1,64}$/.test(name)&&!name.startsWith('sd_'))return name;
  const encoded='sd_n_'+name.replace(/_/g,'__').replace(/\./g,'_d').replace(/:/g,'_c');
  // Long registered names resolve through the checked table, just like short names.
  return encoded.length<=64?encoded:'sd_h_'+createHash('sha256').update(name).digest('hex').slice(0,59);
 };
 const remember=(name:string)=>{
  const wire=toWire(name), prior=canonicalByWire.get(wire);
  if(prior!==undefined&&prior!==name)throw Error('NATIVE_PI_TOOL_NAME_COLLISION');
  canonicalByWire.set(wire,name);
  return wire;
 };
 const declarations=tools.map(t=>({...t,name:remember(t.name)}));
 // Authorization is tied to the current catalog. History may name a retired
 // tool, but it must never extend this dispatch map.
 const allowed=new Map(canonicalByWire);
 function canonical(wire:string){
  const name=allowed.get(wire);
  if(name===undefined)throw Error('NATIVE_PI_TOOL_DENIED');
  return name;
 }
 function checkpoint(snapshot:Checkpoint,restoring:boolean):Checkpoint{
  // Preserve unknown assistant proposals in history as inert transcript data.
  // A provider can choose a wrong name even though Pi will reject execution.
  const convert=(name:string)=>restoring?remember(name):(canonicalByWire.get(name)??name);
  const named=(entry:any)=>typeof entry?.name==='string'?{...entry,name:convert(entry.name)}:entry;
  const messages=snapshot.messages.map((m:any)=>{
   if(m.role==='assistant'&&Array.isArray(m.content))return {...m,content:m.content.map((c:any)=>c.type==='toolCall'?named(c):c)};
   if(m.role==='toolResult'&&typeof m.toolName==='string')return {...m,toolName:convert(m.toolName)};
   if(m.role==='system')return {...m,...(Array.isArray(m.toolsAdded)?{toolsAdded:m.toolsAdded.map(named)}:{}),...(Array.isArray(m.toolsRemoved)?{toolsRemoved:m.toolsRemoved.map(named)}:{})};
   return m;
  });
  return {...snapshot,messages,inFlight:snapshot.inFlight.map(named),receipts:snapshot.receipts.map(named)};
 }
 return {declarations,canonical,toWireCheckpoint:(snapshot:Checkpoint)=>checkpoint(snapshot,true),toCanonicalCheckpoint:(snapshot:Checkpoint)=>checkpoint(snapshot,false)};
}
