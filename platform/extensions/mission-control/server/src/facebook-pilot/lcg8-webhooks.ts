/** Facebook Pages pilot webhook verification primitives, disabled until the
 * customer callback endpoint is registered by the authorized integration owner.
 * Never trust a post-success event or perform writes merely because a callback
 * claims an object ID: LCG4 performs provider-status reconciliation separately.
 */
import {createHmac,timingSafeEqual} from 'node:crypto';

const MAX_WEBHOOK_BYTES=1_000_000;
function fixedEquals(a:Buffer,b:Buffer):boolean{return a.length===b.length&&timingSafeEqual(a,b);}

export function verifyFacebookWebhookSignature(rawBody:Buffer,signature:string|undefined,appSecret:string):boolean{
 if(!Buffer.isBuffer(rawBody)||rawBody.length>MAX_WEBHOOK_BYTES||!appSecret||appSecret.length<8||typeof signature!=='string'||!/^sha256=[a-fA-F0-9]{64}$/.test(signature))return false;
 const expected=createHmac('sha256',appSecret).update(rawBody).digest();
 return fixedEquals(expected,Buffer.from(signature.slice(7),'hex'));
}

export function verifyFacebookWebhookChallenge(input:{mode:unknown;verifyToken:unknown;challenge:unknown;expectedToken:string}):string|undefined{
 if(input.mode!=='subscribe'||typeof input.verifyToken!=='string'||typeof input.challenge!=='string'||!input.expectedToken||input.expectedToken.length<8)return;
 if(input.challenge.length<1||input.challenge.length>200||!/^[A-Za-z0-9_.:-]+$/.test(input.challenge))return;
 const a=Buffer.from(input.verifyToken),b=Buffer.from(input.expectedToken);
 if(!fixedEquals(a,b))return;
 return input.challenge;
}

export interface FacebookPageWebhookSignal {pageId:string;changeField:string;verifiedSignature:true}
/** Return only bounded metadata for audit/reconciliation. Never return raw payload
 * or claim the Page post was published. App subscription permission is separate.
 */
export function verifiedFacebookPageWebhookSignals(rawBody:Buffer,signature:string|undefined,secret:string):FacebookPageWebhookSignal[]{
 if(!verifyFacebookWebhookSignature(rawBody,signature,secret))throw Error('FACEBOOK_WEBHOOK_SIGNATURE_DENIED');
 let payload:unknown;
 try{payload=JSON.parse(rawBody.toString('utf8'));}catch{throw Error('FACEBOOK_WEBHOOK_PAYLOAD_INVALID');}
 if(!payload||typeof payload!=='object'||(payload as Record<string,unknown>).object!=='page')return [];
 const entries=(payload as Record<string,unknown>).entry;
 if(!Array.isArray(entries)||entries.length>100)throw Error('FACEBOOK_WEBHOOK_PAYLOAD_INVALID');
 const signals:FacebookPageWebhookSignal[]=[];
 for(const entry of entries){
  if(!entry||typeof entry!=='object')continue;
  const item=entry as Record<string,unknown>;
  if(typeof item.id!=='string'||!/^[0-9]{1,30}$/.test(item.id))continue;
  const changes=item.changes;
  if(!Array.isArray(changes)||changes.length>100)continue;
  for(const change of changes){
   if(!change||typeof change!=='object')continue;
   const field=(change as Record<string,unknown>).field;
   if(typeof field==='string'&&/^[a-z_]{1,50}$/.test(field)&&signals.length<100)signals.push({pageId:item.id,changeField:field,verifiedSignature:true});
  }
 }
 return signals;
}
