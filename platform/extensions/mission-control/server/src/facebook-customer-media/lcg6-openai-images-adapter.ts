/** LCG6: isolated server-side OpenAI Images API adapter.
 * P0 IS NOT wired to customer MCP or allowed to spend without a separately
 * reviewed tenant-scoped, durable budget reservation and authenticated gate.
 * No API key, raw response, raw prompt, or image bytes may be logged.
 */
import {createHash} from 'node:crypto';

export const LCG6_OPENAI_IMAGE_PROVIDER = 'https://api.openai.com/v1/images/generations' as const;
export const LCG6_OPENAI_IMAGE_KEY_REF = 'OPENAI_IMAGE_API_KEY' as const;
export const LCG6_OPENAI_MODEL = 'gpt-image-2' as const;
export const LCG6_OPENAI_MAX_IMAGE_BYTES = 8_000_000 as const;
/** Maximum ledger reservation per one low-quality image, NOT an upstream billing guarantee. */
export const LCG6_OPENAI_RESERVE_CEILING_USD = 0.05 as const;
export const LCG6_OPENAI_IMAGE_REQUEST = Object.freeze({
  model: LCG6_OPENAI_MODEL,
  size: '1024x1024',
  quality: 'low',
  output_format: 'png',
  n: 1,
} as const);
const MAX_PROVIDER_JSON_BYTES = Math.ceil(LCG6_OPENAI_MAX_IMAGE_BYTES/3)*4 + 16_384;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a','hex');
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const STRICT_B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type Lcg6GenerationErrorCode =
  'GENERATION_DISABLED'|'INVALID_REQUEST'|'BUDGET_DENIED'|'CREDENTIAL_UNAVAILABLE'|
  'UPSTREAM_FAILED'|'UPSTREAM_RATE_LIMIT'|'UPSTREAM_TIMEOUT_UNCERTAIN'|'INVALID_PROVIDER_IMAGE';
export class Lcg6GenerationError extends Error {
  constructor(readonly code:Lcg6GenerationErrorCode) {
    super(code); this.name='Lcg6GenerationError';
  }
}
function fail(code:Lcg6GenerationErrorCode):never {throw new Lcg6GenerationError(code); }

/** This identity MUST come from authenticated server scope verification, not tool JSON. */
export type Lcg6TrustedGenerationRequest = Readonly<{
  tenantId:string;
  subjectId:string;
  /** Stable server-approved idempotency key, consumed by durable reserveAttempt. */
  requestId:string;
  prompt:string;
}>;
export type Lcg6GenerationReservation = Readonly<{
  tenantId:string;subjectId:string;requestId:string;
  model:typeof LCG6_OPENAI_MODEL;size:typeof LCG6_OPENAI_IMAGE_REQUEST.size;
  quality:typeof LCG6_OPENAI_IMAGE_REQUEST.quality;
  /** Exactly one billable attempt; budget implementation must reject duplicate request IDs. */
  maxProviderCalls:1;
  /** The integrator must verify current provider pricing BEFORE enabling calls. */
  reservedSpendCeilingUsd:typeof LCG6_OPENAI_RESERVE_CEILING_USD;
  /** Prevents one client requestId from being reused for a changed prompt. */
  promptSha256:string;
}>;
export type Lcg6GeneratedBytes = Readonly<{
  /** Never log or expose publicly. Consume only through tenant-verified media ingestion. */
  bytes:Buffer;
  contentType:'image/png';
  sha256:string;
  width:number;height:number;
  model:typeof LCG6_OPENAI_MODEL;
  /** A server-observed API response, not proof of the rendered picture's true origin. */
  provenance:'SERVER_OPENAI_IMAGES_RESPONSE_UNATTESTED';
}>;
export type Lcg6GenerationDependencies = Readonly<{
  /** Must be false unless separate owner approval and staging budget validation. */
  enabled:boolean;
  /** Resolver wired only to server-owned encrypted secret source; NEVER from user input. */
  resolveServerCredential:(ref:typeof LCG6_OPENAI_IMAGE_KEY_REF)=>string;
  /** Must atomically reserve unique tenant/request budget before any paid API attempt.
   * A timeout/unknown acknowledgment MUST remain reserved; adapter never retries. */
  reserveAttempt:(reservation:Lcg6GenerationReservation)=>Promise<boolean>;
  /** For OFFLINE tests, inject a fake; production uses the built-in fetch. */
  fetchImpl?:typeof fetch;
  timeoutMs?:number;
}>;

function validatePrompt(request:Lcg6TrustedGenerationRequest):void {
  if(!request||typeof request!=='object'||
    !SAFE_IDENTIFIER.test(request.tenantId)||!SAFE_IDENTIFIER.test(request.subjectId)||
    !SAFE_IDENTIFIER.test(request.requestId)||
    typeof request.prompt!=='string'||request.prompt.trim().length<12||
    request.prompt.length>1200||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(request.prompt)) {
      fail('INVALID_REQUEST');
  }
}

async function readBoundedResponse(response:Response,signal:AbortSignal):Promise<string> {
  const declared=response.headers.get('content-length');
  if(declared!==null && (!/^\d+$/.test(declared)||Number(declared)>MAX_PROVIDER_JSON_BYTES))fail('INVALID_PROVIDER_IMAGE');
  const mime=response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
  if(mime!=='application/json')fail('INVALID_PROVIDER_IMAGE');
  if(!response.body)fail('INVALID_PROVIDER_IMAGE');
  const reader=response.body.getReader();
  let total=0;const chunks:Uint8Array[]=[];
  try {
    while(true){
      if(signal.aborted)fail('UPSTREAM_TIMEOUT_UNCERTAIN');
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>MAX_PROVIDER_JSON_BYTES)fail('INVALID_PROVIDER_IMAGE');
      chunks.push(value);
    }
    return Buffer.concat(chunks.map(value=>Buffer.from(value)),total).toString('utf8');
  } finally {try{await reader.cancel();}catch{}}
}

function parsePng(body:string):Lcg6GeneratedBytes {
  let parsed:unknown;
  try{parsed=JSON.parse(body);}catch{fail('INVALID_PROVIDER_IMAGE');}
  if(!parsed||typeof parsed!=='object')fail('INVALID_PROVIDER_IMAGE');
  const obj=parsed as Record<string,unknown>;
  if(!Array.isArray(obj.data)||obj.data.length!==1||!obj.data[0]||typeof obj.data[0]!=='object')fail('INVALID_PROVIDER_IMAGE');
  const image=obj.data[0] as Record<string,unknown>;
  if(typeof image.b64_json!=='string'||image.url!==undefined)fail('INVALID_PROVIDER_IMAGE');
  const value=image.b64_json;
  if(!value.length||value.length%4!==0||value.length>Math.ceil(LCG6_OPENAI_MAX_IMAGE_BYTES/3)*4||
    !STRICT_B64.test(value))fail('INVALID_PROVIDER_IMAGE');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length<45||bytes.length>LCG6_OPENAI_MAX_IMAGE_BYTES||bytes.toString('base64')!==value||
    !bytes.subarray(0,8).equals(PNG_SIGNATURE)||bytes.readUInt32BE(8)!==13||
    bytes.toString('ascii',12,16)!=='IHDR')fail('INVALID_PROVIDER_IMAGE');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<1||height<1||width>2048||height>2048)fail('INVALID_PROVIDER_IMAGE');
  // Only a bounded header inspection. LCG17/private media ingestion MUST still
  // validate CRC, full PNG structure, actual pixels, tenant and authorization.
  return Object.freeze({bytes,contentType:'image/png' as const,sha256:createHash('sha256').update(bytes).digest('hex'),
    width,height,model:LCG6_OPENAI_MODEL,provenance:'SERVER_OPENAI_IMAGES_RESPONSE_UNATTESTED' as const});
}

export function createLcg6OpenAIImagesAdapter(deps:Lcg6GenerationDependencies) {
  if(!deps||typeof deps.resolveServerCredential!=='function'||typeof deps.reserveAttempt!=='function'||
    (deps.timeoutMs!==undefined && (!Number.isInteger(deps.timeoutMs)||deps.timeoutMs<25||deps.timeoutMs>60_000))) {
    fail('INVALID_REQUEST');
  }
  const timeoutMs=deps.timeoutMs??30_000;
  const transport=deps.fetchImpl??fetch;
  return Object.freeze({
    async generate(request:Lcg6TrustedGenerationRequest):Promise<Lcg6GeneratedBytes> {
      if(deps.enabled!==true)fail('GENERATION_DISABLED');
      validatePrompt(request);
      let permitted=false;
      try{permitted=await deps.reserveAttempt(Object.freeze({
        tenantId:request.tenantId,subjectId:request.subjectId,requestId:request.requestId,
        model:LCG6_OPENAI_MODEL,size:LCG6_OPENAI_IMAGE_REQUEST.size,
        quality:LCG6_OPENAI_IMAGE_REQUEST.quality,maxProviderCalls:1 as const,
        reservedSpendCeilingUsd:LCG6_OPENAI_RESERVE_CEILING_USD,
        promptSha256:createHash('sha256').update(request.prompt.trim()).digest('hex'),
      }));}catch{fail('BUDGET_DENIED');}
      if(permitted!==true)fail('BUDGET_DENIED');
      let key:string;
      try{key=deps.resolveServerCredential(LCG6_OPENAI_IMAGE_KEY_REF);}catch{fail('CREDENTIAL_UNAVAILABLE');}
      if(typeof key!=='string'||key.trim().length<12||/[\s\r\n]/.test(key))fail('CREDENTIAL_UNAVAILABLE');
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try {
        const response=await transport(LCG6_OPENAI_IMAGE_PROVIDER,{
          method:'POST',redirect:'error',
          headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({...LCG6_OPENAI_IMAGE_REQUEST,prompt:request.prompt.trim()}),
          signal:controller.signal,
        });
        if(!response.ok){
          if(controller.signal.aborted)fail('UPSTREAM_TIMEOUT_UNCERTAIN');
          fail(response.status===429?'UPSTREAM_RATE_LIMIT':'UPSTREAM_FAILED');
        }
        const body=await readBoundedResponse(response,controller.signal);
        return parsePng(body);
      }catch(error){
        if(error instanceof Lcg6GenerationError)throw error;
        fail(controller.signal.aborted?'UPSTREAM_TIMEOUT_UNCERTAIN':'UPSTREAM_FAILED');
      }finally{clearTimeout(timer);}
    },
  });
}
