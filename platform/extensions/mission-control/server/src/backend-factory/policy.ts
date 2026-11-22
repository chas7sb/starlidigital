import {createHash} from 'node:crypto';
import {BACKEND_TEMPLATE_VERSION,type BackendSpecification,type BackendFieldType,type RuntimePolicy,type EnvironmentRequirement} from './domain.js';

export const SPEC_MAX_BYTES=32768;
export const MAX_MODELS=12;
export const MAX_FIELDS_PER_MODEL=24;
export const MAX_DESCRIPTION=1200;
export const MODEL_NAME=/^[A-Z][A-Za-z0-9]{0,47}$/;
export const FIELD_NAME=/^[a-z][A-Za-z0-9]{0,47}$/;
const FIELD_TYPES=new Set<BackendFieldType>(['string','int','float','boolean','dateTime','json','uuid']);
export const DEFAULT_RUNTIME_POLICY:RuntimePolicy={nodeVersion:'24',maxMemoryMb:256,maxCpuMillisPerSecond:500,requestTimeoutMs:15000,outboundNetwork:'DENY_BY_DEFAULT',filesystem:'APP_READONLY_WITH_TMP'};
export const DEFAULT_ENVIRONMENT_REQUIREMENTS:EnvironmentRequirement[]=[
 {name:'DATABASE_URL',kind:'SECRET_REFERENCE',required:true,description:'Managed PostgreSQL connection secret reference.'},
 {name:'PORT',kind:'PLATFORM_VALUE',required:true,description:'Platform-assigned unprivileged service port.'},
 {name:'NODE_ENV',kind:'PLATFORM_VALUE',required:true,description:'Platform runtime environment.'}
];
export const FIXED_DEPENDENCIES={
 '@prisma/client':'6.19.0',
 'express':'5.1.0',
 'pino':'9.14.0',
 'pino-http':'10.5.0',
 'zod':'4.1.12',
 'supertest':'7.1.4'
} as const;
export const FIXED_DEV_DEPENDENCIES={
 '@types/express':'5.0.5',
 '@types/node':'24.10.0',
 '@types/supertest':'6.0.3',
 'prisma':'6.19.0',
 'tsx':'4.20.6',
 'typescript':'5.9.3'
} as const;
export const FIXED_SCRIPTS={build:'tsc --noEmit',start:'node --import tsx src/index.ts',test:'node --import tsx --test test/*.test.ts','prisma:validate':'prisma validate'} as const;

export function stableJson(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stableJson(v)).join(',')+'}';
 return JSON.stringify(value);
}
export const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
export function sanitizeText(value:unknown,max:number):string{
 if(typeof value!=='string')return '';
 return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
export function validateSpecification(input:unknown):BackendSpecification{
 const raw=typeof input==='object'&&input!==null?input as Record<string,unknown>:null;
 if(!raw)throw new Error('Backend specification must be an object.');
 for(const key of Object.keys(raw))if(!['templateVersion','displayName','description','models','features'].includes(key))throw new Error(`Unsupported specification property: ${key}.`);
 if(Buffer.byteLength(JSON.stringify(raw),'utf8')>SPEC_MAX_BYTES)throw new Error('Backend specification exceeds the allowed size.');
 if(raw.templateVersion!==BACKEND_TEMPLATE_VERSION)throw new Error('Unsupported backend template version.');
 const displayName=sanitizeText(raw.displayName,80);if(!displayName)throw new Error('Backend display name is required.');
 const description=sanitizeText(raw.description,MAX_DESCRIPTION);
 if(!Array.isArray(raw.models)||raw.models.length<1||raw.models.length>MAX_MODELS)throw new Error(`Backend specification requires 1-${MAX_MODELS} models.`);
 const seenModels=new Set<string>();
 const models=raw.models.map((model,index)=>{
  if(!model||typeof model!=='object')throw new Error(`Model ${index+1} is invalid.`);
  const item=model as Record<string,unknown>;for(const key of Object.keys(item))if(!['name','fields'].includes(key))throw new Error(`Unsupported model property: ${key}.`);const name=String(item.name||'');
  if(!MODEL_NAME.test(name)||['Prisma','UserInput','Health','Readiness'].includes(name))throw new Error(`Unsafe model name: ${name||'(empty)'}.`);
  if(seenModels.has(name))throw new Error(`Duplicate model name: ${name}.`);seenModels.add(name);
  if(!Array.isArray(item.fields)||item.fields.length<1||item.fields.length>MAX_FIELDS_PER_MODEL)throw new Error(`Model ${name} requires 1-${MAX_FIELDS_PER_MODEL} fields.`);
  const seenFields=new Set<string>();
  const fields=item.fields.map((field,fieldIndex)=>{
   if(!field||typeof field!=='object')throw new Error(`Field ${fieldIndex+1} in ${name} is invalid.`);
   const f=field as Record<string,unknown>;for(const key of Object.keys(f))if(!['name','type','required','unique'].includes(key))throw new Error(`Unsupported field property: ${key}.`);const fieldName=String(f.name||'');
   if(!FIELD_NAME.test(fieldName)||['id','createdAt','updatedAt','constructor','prototype','toString','valueOf'].includes(fieldName))throw new Error(`Unsafe field name: ${fieldName||'(empty)'}.`);
   if(seenFields.has(fieldName))throw new Error(`Duplicate field name: ${name}.${fieldName}.`);seenFields.add(fieldName);
   const type=String(f.type||'') as BackendFieldType;if(!FIELD_TYPES.has(type))throw new Error(`Unsupported field type: ${String(f.type||'')}.`);
   if(typeof f.required!=='boolean')throw new Error(`Field ${name}.${fieldName} must declare required.`);
   if(f.unique!==undefined&&typeof f.unique!=='boolean')throw new Error(`Field ${name}.${fieldName} has invalid unique flag.`);
   return {name:fieldName,type,required:f.required,...(f.unique===true?{unique:true}:{})};
  });
  return {name,fields};
 });
 const featuresRaw=raw.features;
 if(featuresRaw!==undefined&&(typeof featuresRaw!=='object'||featuresRaw===null||Array.isArray(featuresRaw)))throw new Error('Features must be an object.');
 const featuresObj=(featuresRaw||{}) as Record<string,unknown>;
 for(const key of Object.keys(featuresObj))if(!['cors','requestLogging'].includes(key))throw new Error(`Unsupported feature: ${key}.`);
 for(const key of ['cors','requestLogging'])if(featuresObj[key]!==undefined&&typeof featuresObj[key]!=='boolean')throw new Error(`Feature ${key} must be boolean.`);
 return {templateVersion:BACKEND_TEMPLATE_VERSION,displayName, ...(description?{description}:{}),models,features:{cors:featuresObj.cors===true,requestLogging:featuresObj.requestLogging!==false}};
}
export const specificationHash=(spec:BackendSpecification)=>sha256(stableJson(spec));
