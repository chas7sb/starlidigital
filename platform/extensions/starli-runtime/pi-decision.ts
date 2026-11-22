/** A tool executes only from one complete validated decision envelope. */
export function parseDecision(text:string):any {
 const raw=String(text??'').trim();
 const cleaned=raw.replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'').trim();
 if(!cleaned)throw Error('INVALID_MODEL_DECISION');
 if(cleaned.startsWith('{')||cleaned.startsWith('[')){
  let value:any;try{value=JSON.parse(cleaned);}catch{throw Error('INVALID_MODEL_DECISION');}
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.tool!=='string')throw Error('INVALID_MODEL_DECISION');
  if(value.tool==='done'){
   if(typeof value.result!=='string'||!value.result.trim())throw Error('INVALID_MODEL_DECISION');
  }else if(value.args!==undefined&&(!value.args||typeof value.args!=='object'||Array.isArray(value.args)))throw Error('INVALID_MODEL_DECISION');
  return value;
 }
 // Conversational text is never interpreted as an embedded tool call.
 return {tool:'done',result:cleaned.slice(0,12000)};
}
