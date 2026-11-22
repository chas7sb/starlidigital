export function fieldSchema(schema:any):any {
 if(!schema||typeof schema!=='object')return {type:'string'};
 const union=schema.anyOf||schema.oneOf;
 if(Array.isArray(union)){
  const choices=union.filter(s=>s?.type!=='null');
  if(choices.length===1){const {anyOf,oneOf,...base}=schema;return {...base,...choices[0],description:schema.description||choices[0].description};}
 }
 return schema;
}
export function fieldLabel(name:string):string{
 return name.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/\b[a-z]/g,s=>s.toUpperCase()).replace(/\bId\b/g,'ID').replace(/\bUrl\b/g,'URL');
}
export function initialArguments(input:any):Record<string,any>{
 const result:Record<string,any>={};
 for(const [name,raw] of Object.entries(input?.properties||{})){
  const s=fieldSchema(raw);
  if(s.default!==undefined)result[name]=structuredClone(s.default);
  else if(s.type==='boolean')result[name]=false;
  else if(s.type==='object'&&s.properties)result[name]=initialArguments(s);
 }
 return result;
}
export function toolArguments(schema:any,values:any,path=''):Record<string,any>{
 const out:Record<string,any>={};
 if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Arguments must be an object');
 for(const [name,raw] of Object.entries(schema?.properties||{})){
  const s=fieldSchema(raw),v=values[name],label=path+fieldLabel(name),required=(schema.required||[]).includes(name);
  const absent=v===undefined||v===null||typeof v==='string'&&!v.trim()||Array.isArray(v)&&!v.length;
  if(absent){if(required)throw Error(label+' is required');continue;}
  if(s.type==='object'&&s.properties){const nested=toolArguments(s,v,label+' / ');if(Object.keys(nested).length||required)out[name]=nested;continue;}
  if(s.type==='number'||s.type==='integer'){
   const n=Number(v);if(!Number.isFinite(n)||(s.type==='integer'&&!Number.isInteger(n)))throw Error(label+' must be '+(s.type==='integer'?'a whole number':'a number'));
   if(s.minimum!==undefined&&n<s.minimum)throw Error(label+' must be at least '+s.minimum);
   if(s.maximum!==undefined&&n>s.maximum)throw Error(label+' must be at most '+s.maximum);
   out[name]=n;continue;
  }
  if(s.enum&&!s.enum.includes(v))throw Error('Choose a valid '+label.toLowerCase());
  if(s.type==='string'){
   if(typeof v!=='string')throw Error(label+' must be text');
   if(s.minLength!==undefined&&v.length<s.minLength)throw Error(label+' is too short');
   if(s.maxLength!==undefined&&v.length>s.maxLength)throw Error(label+' is too long');
  }
  if(s.type==='array'){
   if(!Array.isArray(v))throw Error(label+' must be a list');
   if(s.minItems!==undefined&&v.length<s.minItems)throw Error(label+' needs at least '+s.minItems+' items');
   if(s.maxItems!==undefined&&v.length>s.maxItems)throw Error(label+' has too many items');
   if(s.items?.type==='integer'&&v.some(n=>!Number.isInteger(Number(n))))throw Error(label+' needs whole numbers');
   if(['number','integer'].includes(s.items?.type)&&v.some(n=>!Number.isFinite(Number(n))))throw Error(label+' needs numbers');
   out[name]=['number','integer'].includes(s.items?.type)?v.map(Number):v;continue;
  }
  out[name]=v;
 }
 // Schemas with open properties use the explicitly provided structured object.
 if(!schema?.properties&&schema?.additionalProperties)return {...values};
 return out;
}
export function toolGroup(name:string):string{
 if(/^(project|website|template)/.test(name))return 'Projects';
 if(/^(crm|company|prospect|pipeline|interaction|lead|proposal|client_workspace)/.test(name))return 'CRM';
 if(/^(inbox|outreach|mail)/.test(name))return 'Mail';
 if(/^(social|facebook|instagram|tiktok|recurring)/.test(name))return 'Social media';
 if(/^(video|brand|asset)/.test(name))return 'Media';
 if(/^(agent|starli|task_agent)/.test(name))return 'Agents';
 return 'Other';
}
export function resultData(data:any):any{
 if(!Array.isArray(data?.content))return data;
 const parts=data.content.filter(p=>p?.type==='text'&&typeof p.text==='string').map(p=>{try{return JSON.parse(p.text);}catch{return p.text;}});
 return parts.length===1?parts[0]:parts;
}
export function resultFailed(data:any):boolean{
 const value=resultData(data);
 const failed=(v:any):boolean=>!!v&&typeof v==='object'&&(v.isError===true||v.ok===false||!!v.error||['FAILED','ERROR','DENIED','UNCERTAIN','REJECTED'].includes(String(v.status||'')));
 return failed(data)||failed(value)||(Array.isArray(value)&&value.some(failed));
}
export function canonicalArguments(value:any):string{
 if(Array.isArray(value))return '['+value.map(canonicalArguments).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalArguments(value[k])).join(',')+'}';
 return JSON.stringify(value);
}

export function resultPending(data:any):boolean{
 const value=resultData(data);
 const pending=(v:any)=>!!v&&typeof v==='object'&&['QUEUED','PENDING','RUNNING','EXECUTING','BUILDING','RENDERING','CANCEL_REQUESTED'].includes(String(v.status||''));
 return pending(data)||pending(value)||(Array.isArray(value)&&value.some(pending));
}
