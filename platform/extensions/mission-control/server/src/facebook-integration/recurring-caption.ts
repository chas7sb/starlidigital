import {OutlierClient} from '../outlier-client.js';

export type CaptionInput = Readonly<{brief:string;localDate:string}>;
export type CaptionFallbackOptions = Readonly<{
 resolveServerCredential:(ref:'OPENAI_IMAGE_API_KEY')=>string;
 fetchImpl?:typeof fetch;
}>;
const INSTRUCTIONS = 'Write a concise Romanian Facebook caption using only the approved brand brief. Return only the caption, plain text. Do not invent claims, prices, offers, testimonials, links, or contact details. Preserve only approved contact details.';
const MODEL = 'gpt-5-nano';
function validateCaption(value:unknown):string {
 if(typeof value!=='string')throw Error('INVALID_CAPTION');
 const caption=value.trim();
 if(caption.length<12||caption.length>500||/[\x00-\x1f\x7f]/.test(caption)||/https?:\/\/|www\.|<[^>]+>/.test(caption))throw Error('INVALID_CAPTION');
 return caption;
}
export async function generateRecurringFacebookCaption(input:CaptionInput, fallback?:CaptionFallbackOptions):Promise<string>{
 const client=new OutlierClient({
  persistRuntime:false,allowGlobalConversation:false,
  systemPromptBuilder:()=>INSTRUCTIONS,
 });
 client.debug=false;
 try{
  return validateCaption(await client.ask(JSON.stringify({approvedBrandBrief:input.brief,publicationDate:input.localDate}),{
   signal:AbortSignal.timeout(25_000),
  }));
 }catch(primaryError){
  if(!fallback)throw primaryError;
 }
 // Exactly one fallback attempt; no retry on ambiguous upstream results.
 const apiKey=fallback.resolveServerCredential('OPENAI_IMAGE_API_KEY');
 if(!apiKey||!apiKey.trim())throw Error('CAPTION_FALLBACK_CREDENTIAL_UNAVAILABLE');
 const fetcher=fallback.fetchImpl??fetch;
 const response=await fetcher('https://api.openai.com/v1/responses',{
  method:'POST',
  headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
  body:JSON.stringify({model:MODEL,instructions:INSTRUCTIONS,input:JSON.stringify({approvedBrandBrief:input.brief,publicationDate:input.localDate}),max_output_tokens:350,store:false}),
  signal:AbortSignal.timeout(20_000),
 });
 if(!response.ok)throw Error('CAPTION_FALLBACK_UPSTREAM_FAILED');
 const raw=await response.text();
 if(raw.length>65_536)throw Error('CAPTION_FALLBACK_INVALID_RESPONSE');
 let data:unknown;
 try{data=JSON.parse(raw);}catch{throw Error('CAPTION_FALLBACK_INVALID_RESPONSE');}
 const result=data as {output_text?:unknown;output?:Array<{content?:Array<{type?:string;text?:unknown}>}>};
 const caption=typeof result.output_text==='string'?result.output_text:
  result.output?.flatMap(item=>item.content??[]).filter(part=>part.type==='output_text'&&typeof part.text==='string').map(part=>part.text as string).join('')??'';
 return validateCaption(caption);
}
