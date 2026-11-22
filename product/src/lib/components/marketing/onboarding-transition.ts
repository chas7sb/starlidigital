/**
 * W3 staging-only browser navigation proposal. This is NOT a native company creator.
 * A client event and sessionStorage are always untrusted. Only an independently
 * authenticated, same-origin server response may make a transition proposable.
 */
export const VERIFY_ROUTE = '/api/v1/starli/onboarding/transition/verify'; // PROPOSED, NOT MOUNTED
export const GUEST_INTENT_ROUTE = '/api/v1/starli/public/intents';
export const ONBOARDING_STORAGE_KEY = 'starli:w3:boss:onboarding:v1';
export const NATIVE_EVENT_SOURCE = 'native-bootstrap-sse';

export type Phase = 'IDLE' | 'DRAFT_ONLY' | 'PROPOSED' | 'RESTORED_UNVERIFIED' |
  'REVALIDATING' | 'VERIFYING' | 'READY_PROPOSED' | 'AUTH_REVOKED' | 'DENIED' | 'UNAVAILABLE';
export interface GuestIntent {
  schemaVersion:1; status:'PROPOSED'; intentId:string; requestId:string;
  originalPrompt:string; expiresAt:string; createdAt:string;
}
export interface NativeSignal {
  schemaVersion:1; source:typeof NATIVE_EVENT_SOURCE; origin:string; eventId:string;
  intentId:string; expectedRevision:number;
}
export interface VerifiedNativeRoom {
  schemaVersion:1; status:'ROOM_READY'; issuer:'starli-native-onboarding/v1';
  nativeAuthorityActive:true; authorizationStatus:'AUTHORIZED';
  serverSessionVerified:true; roomAccessVerified:true; transcriptPreserved:true;
  verifiedOrigin:string; eventId:string; intentId:string;
  bootstrapRevision:number; actorSessionRevision:number;
  companyId:string; bossBotId:string; bossDmRoomId:string; channelRoomId:string;
  targetRoomId:string; rootProjectId:string; sourceMessageId:string;
  originalPrompt:string; verifiedAt:string; expiresAt:string;
}
export interface TransitionProposal {
  receipt:VerifiedNativeRoom; intentId:string; originalPrompt:string; draft:string;
  scrollTop:number; sourceMessageId:string; navigationIsProposedOnly:true;
}
export interface PortableStore {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
}
export type FetchLike = (input:string,init?:RequestInit)=>Promise<Response>;
export interface ControllerOptions {
  origin:string; fetcher:FetchLike; storage?:PortableStore|null;
  now?:()=>number; verifyEndpoint?:string|null;
  onChange?:(snapshot:PublicSnapshot)=>void;
  onNavigationProposed?:(proposal:TransitionProposal)=>void;
}
export interface PublicSnapshot {
  phase:Phase; intentId:string|null; originalPrompt:string; draft:string;
  scrollTop:number; message:string; navigationProposed:boolean;
}
export interface Result { ok:boolean; reason?:string; status?:number; proposal?:TransitionProposal }
type Persisted = {
  version:1; intent:GuestIntent|null; draft:string; scrollTop:number;
  storedAt:number; consumedKey:string|null;
};

const INTENT_RE=/^[a-f0-9]{40}$/;
const OPAQUE_RE=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;
const ID_RE=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const BANNED_FIELDS=['guestBinding','guestSessionBinding','guestToken','authorizationToken',
  'bearerToken','password','apiKey','membershipBinding','rawCookie'];
const MAX_REHYDRATE_AGE=24*60*60*1000;

function obj(value:unknown):value is Record<string,unknown> {
  return !!value && typeof value==='object' && !Array.isArray(value);
}
function validUtc(s:unknown):s is string {
  return typeof s==='string' && s.length>=20 && Number.isFinite(Date.parse(s)) && /(?:Z|[+-]\d\d:\d\d)$/.test(s);
}
function validId(s:unknown):s is string { return typeof s==='string' && ID_RE.test(s); }
function strictlyPositive(n:unknown):n is number { return typeof n==='number' && Number.isSafeInteger(n) && n>0; }
function noneOfForbiddenFields(o:Record<string,unknown>) {
  return BANNED_FIELDS.every(k=>!Object.prototype.hasOwnProperty.call(o,k));
}
function onlySafeOrigin(value:string) {
  try {
    const url=new URL(value);
    return url.origin===value && ['http:','https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function parseGuestIntent(raw:unknown,now=Date.now()):GuestIntent|null {
  if(!obj(raw) || raw.schemaVersion!==1 || raw.status!=='PROPOSED' ||
     typeof raw.intentId!=='string' || !INTENT_RE.test(raw.intentId) ||
     typeof raw.requestId!=='string' || !OPAQUE_RE.test(raw.requestId) ||
     typeof raw.originalPrompt!=='string' || !raw.originalPrompt.trim() ||
     raw.originalPrompt.length>4000 || !validUtc(raw.createdAt) || !validUtc(raw.expiresAt)) return null;
  const expires=Date.parse(raw.expiresAt),created=Date.parse(raw.createdAt);
  if(expires<=now || created>now+30000 || expires<=created || expires-created>MAX_REHYDRATE_AGE+30000)return null;
  return Object.freeze({schemaVersion:1,status:'PROPOSED',intentId:raw.intentId,
    requestId:raw.requestId,originalPrompt:raw.originalPrompt,
    createdAt:raw.createdAt,expiresAt:raw.expiresAt}) as GuestIntent;
}

export function validNativeSignal(raw:unknown,origin:string,intentId:string):raw is NativeSignal {
  return obj(raw) && raw.schemaVersion===1 && raw.source===NATIVE_EVENT_SOURCE &&
    raw.origin===origin && typeof raw.eventId==='string' && OPAQUE_RE.test(raw.eventId) &&
    raw.intentId===intentId && strictlyPositive(raw.expectedRevision) &&
    noneOfForbiddenFields(raw);
}

/** Structural validation cannot authenticate a server. The caller MUST use the
 * native same-origin server-owned endpoint; staged fixture validation is TEST ONLY. */
export function parseServerVerifiedRoom(raw:unknown,signal:NativeSignal,
  intent:GuestIntent,origin:string,now=Date.now()):VerifiedNativeRoom|null {
  if(!obj(raw) || !noneOfForbiddenFields(raw) ||
     raw.schemaVersion!==1 || raw.status!=='ROOM_READY' ||
     raw.issuer!=='starli-native-onboarding/v1' || raw.nativeAuthorityActive!==true ||
     raw.authorizationStatus!=='AUTHORIZED' || raw.serverSessionVerified!==true ||
     raw.roomAccessVerified!==true || raw.transcriptPreserved!==true ||
     raw.verifiedOrigin!==origin || raw.eventId!==signal.eventId ||
     raw.intentId!==intent.intentId || raw.originalPrompt!==intent.originalPrompt ||
     raw.bootstrapRevision!==signal.expectedRevision ||
     !strictlyPositive(raw.bootstrapRevision) || !strictlyPositive(raw.actorSessionRevision) ||
     !validUtc(raw.verifiedAt) || !validUtc(raw.expiresAt))return null;
  const verified=Date.parse(raw.verifiedAt),expires=Date.parse(raw.expiresAt);
  if(verified>now+30000 || now<verified-30000 || expires<=now ||
     expires<=verified || expires-verified>300000)return null;
  for(const key of ['companyId','bossBotId','bossDmRoomId','channelRoomId','targetRoomId','rootProjectId','sourceMessageId']) {
    if(!validId(raw[key]))return null;
  }
  if(raw.targetRoomId!==raw.channelRoomId || raw.bossDmRoomId===raw.channelRoomId) return null;
  if(raw.fixtureOnly===true)return null;
  return Object.freeze({
    schemaVersion:1,status:'ROOM_READY',issuer:'starli-native-onboarding/v1',
    nativeAuthorityActive:true,authorizationStatus:'AUTHORIZED',
    serverSessionVerified:true,roomAccessVerified:true,transcriptPreserved:true,
    verifiedOrigin:origin,eventId:raw.eventId,intentId:intent.intentId,
    bootstrapRevision:raw.bootstrapRevision,actorSessionRevision:raw.actorSessionRevision,
    companyId:raw.companyId,bossBotId:raw.bossBotId,bossDmRoomId:raw.bossDmRoomId,
    channelRoomId:raw.channelRoomId,targetRoomId:raw.targetRoomId,
    rootProjectId:raw.rootProjectId,sourceMessageId:raw.sourceMessageId,
    originalPrompt:intent.originalPrompt,verifiedAt:raw.verifiedAt,expiresAt:raw.expiresAt
  }) as VerifiedNativeRoom;
}

export class OnboardingTransitionController {
  private origin:string;
  private fetcher:FetchLike;
  private storage:PortableStore|null;
  private now:()=>number;
  private verifyEndpoint:string|null;
  private onChange:(snapshot:PublicSnapshot)=>void;
  private onNavigationProposed:(proposal:TransitionProposal)=>void;
  private intent:GuestIntent|null=null;
  private draft='';
  private scrollTop=0;
  private phase:Phase='IDLE';
  private message='';
  private consumedKey:string|null=null;
  private lock=false;
  private navigationProposed=false;

  constructor(options:ControllerOptions) {
    if(!onlySafeOrigin(options.origin))throw Error('Valid same-origin context required');
    this.origin=options.origin;
    this.fetcher=options.fetcher;
    this.storage=options.storage??null;
    this.now=options.now??Date.now;
    this.onChange=options.onChange??(()=>{});
    this.onNavigationProposed=options.onNavigationProposed??(()=>{});
    if(options.verifyEndpoint!=null && options.verifyEndpoint!==VERIFY_ROUTE)
      throw Error('Only ULTRA native verify path may be used');
    this.verifyEndpoint=options.verifyEndpoint??null;
    this.publish();
  }

  get snapshot():PublicSnapshot {
    return Object.freeze({phase:this.phase,intentId:this.intent?.intentId??null,
      originalPrompt:this.intent?.originalPrompt??'',draft:this.draft,
      scrollTop:this.scrollTop,message:this.message,navigationProposed:this.navigationProposed});
  }
  private publish(phase?:Phase,message?:string) {
    if(phase)this.phase=phase;
    if(message!==undefined)this.message=message;
    this.onChange(this.snapshot);
  }
  private record():Persisted {return {version:1,intent:this.intent,draft:this.draft,
    scrollTop:this.scrollTop,storedAt:this.now(),consumedKey:this.consumedKey};}
  private persist():boolean {
    if(!this.storage)return false;
    try{this.storage.setItem(ONBOARDING_STORAGE_KEY,JSON.stringify(this.record()));return true}
    catch{return false}
  }
  restore():PublicSnapshot {
    if(!this.storage)return this.snapshot;
    try{
      const raw=this.storage.getItem(ONBOARDING_STORAGE_KEY);
      if(!raw)return this.snapshot;
      const parsed:unknown=JSON.parse(raw);
      if(!obj(parsed) || parsed.version!==1 || !Number.isFinite(parsed.storedAt) ||
         typeof parsed.storedAt!=='number' || this.now()-parsed.storedAt>MAX_REHYDRATE_AGE ||
         parsed.storedAt>this.now()+30000 || typeof parsed.draft!=='string' ||
         parsed.draft.length>4000 || typeof parsed.scrollTop!=='number' ||
         !Number.isFinite(parsed.scrollTop) || parsed.scrollTop<0 || parsed.scrollTop>10000000)throw Error('Invalid local draft');
      this.intent=parsed.intent==null?null:parseGuestIntent(parsed.intent,this.now());
      if(parsed.intent && !this.intent)throw Error('Expired local intent');
      this.draft=parsed.draft;
      this.scrollTop=parsed.scrollTop;
      this.consumedKey=typeof parsed.consumedKey==='string' && parsed.consumedKey.length<=400
        ?parsed.consumedKey:null;
      this.navigationProposed=Boolean(this.consumedKey);
      this.publish(this.intent?'RESTORED_UNVERIFIED':this.draft?'DRAFT_ONLY':'IDLE',
        this.intent?'Your saved request needs current-session verification before continuing.':'');
    }catch{
      this.storage.removeItem(ONBOARDING_STORAGE_KEY);
      this.intent=null;this.draft='';this.scrollTop=0;this.consumedKey=null;
      this.publish('IDLE','Prior local onboarding state was invalid or expired.');
    }
    return this.snapshot;
  }
  setDraft(draft:string,scrollTop=this.scrollTop):boolean {
    if(typeof draft!=='string'||draft.length>4000||!Number.isSafeInteger(Math.floor(scrollTop))||
       scrollTop<0||scrollTop>10000000)return false;
    this.draft=draft;this.scrollTop=Math.floor(scrollTop);
    // Failure to save editable draft is visible, but never grants navigation.
    const saved=this.persist();
    if(this.phase==='IDLE')this.publish('DRAFT_ONLY');
    else this.publish();
    return saved;
  }
  acceptIntent(raw:unknown):Result {
    const parsed=parseGuestIntent(raw,this.now());
    if(!parsed)return {ok:false,reason:'INVALID_OR_EXPIRED_INTENT'};
    if(this.intent && (this.intent.intentId!==parsed.intentId ||
       this.intent.requestId!==parsed.requestId || this.intent.originalPrompt!==parsed.originalPrompt))
      return {ok:false,reason:'CROSS_INTENT_DENIED'};
    if(this.navigationProposed)return {ok:false,reason:'ALREADY_PROPOSED'};
    this.intent=parsed;
    if(!this.draft)this.draft=parsed.originalPrompt;
    if(!this.persist()){this.publish('UNAVAILABLE','Session continuity storage is unavailable.');return {ok:false,reason:'STORAGE_UNAVAILABLE'}}
    this.publish('PROPOSED','Request saved. A company and native room have not been authorized.');
    return {ok:true};
  }
  async revalidateStoredIntent():Promise<Result> {
    if(!this.intent || !['RESTORED_UNVERIFIED','UNAVAILABLE'].includes(this.phase))
      return {ok:false,reason:'NOT_RESTORED'};
    if(this.lock)return {ok:false,reason:'BUSY'};
    this.lock=true;this.publish('REVALIDATING','Checking your saved request against the current guest session.');
    try{
      const response=await this.fetcher.call(globalThis,GUEST_INTENT_ROUTE+'/'+this.intent.intentId,{
        method:'GET',credentials:'include',cache:'no-store',redirect:'error'
      });
      if(response.status===401||response.status===403||response.status===404){
        this.revokeLocal('Guest session or saved intent is no longer authorized.');
        return {ok:false,reason:'AUTH_REVOKED',status:response.status};
      }
      if(!response.ok){this.publish('UNAVAILABLE','Could not verify saved intent; no company access granted.');return {ok:false,reason:'UNAVAILABLE',status:response.status}}
      const payload=await response.json();
      const parsed=parseGuestIntent(payload,this.now());
      if(!parsed || parsed.intentId!==this.intent.intentId ||
         parsed.requestId!==this.intent.requestId ||
         parsed.originalPrompt!==this.intent.originalPrompt)
        throw Error('Stored request did not match current server issuer.');
      if(!this.persist())throw Error('Session continuity storage unavailable.');
      this.publish('PROPOSED','Request reverified. Native room authorization is still pending.');
      return {ok:true};
    } catch {
      this.publish('UNAVAILABLE','Could not revalidate saved request. Native navigation remains blocked.');
      return {ok:false,reason:'VERIFY_FAILED'};
    } finally {this.lock=false;}
  }
  private revokeLocal(message:string) {
    try{this.storage?.removeItem(ONBOARDING_STORAGE_KEY)}catch{}
    this.intent=null;this.consumedKey=null;this.navigationProposed=false;
    // The person's editable draft stays in memory for copy, not persisted for another session.
    this.publish('AUTH_REVOKED',message);
  }
  async offerNativeEvent(raw:unknown):Promise<Result> {
    if(this.lock)return {ok:false,reason:'BUSY'};
    if(!this.verifyEndpoint)return {ok:false,reason:'NATIVE_VERIFY_NOT_MOUNTED'};
    if(!this.intent||this.phase!=='PROPOSED')return {ok:false,reason:'INTENT_NOT_CURRENT'};
    if(this.consumedKey)return {ok:false,reason:'ALREADY_PROPOSED'};
    if(!validNativeSignal(raw,this.origin,this.intent.intentId))
      return {ok:false,reason:'INVALID_OR_OFF_ORIGIN_SIGNAL'};
    const signal=raw;
    this.lock=true;this.publish('VERIFYING','Checking current native company, session and room authority.');
    try{
      const response=await this.fetcher.call(globalThis,this.verifyEndpoint,{
        method:'POST',credentials:'include',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json','X-Starli-Onboarding-Verify':'1'},
        body:JSON.stringify({intentId:signal.intentId,eventId:signal.eventId,
          expectedRevision:signal.expectedRevision})
      });
      if(response.status===401||response.status===403||response.status===404){
        this.revokeLocal('Native session, company or room access was revoked or denied.');
        return {ok:false,reason:'AUTH_REVOKED',status:response.status};
      }
      if(!response.ok){
        this.publish('DENIED',response.status===409?'Room revision changed; recheck in the native workspace.':
          'No current native room authorization was confirmed.');
        return {ok:false,reason:'NATIVE_DENIED',status:response.status};
      }
      if((response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')
        throw Error('Native response is not JSON');
      const payload=await response.json();
      const verified=parseServerVerifiedRoom(payload,signal,this.intent,this.origin,this.now());
      if(!verified)throw Error('Native receipt failed current-authority validation');
      const consumedKey=[this.intent.intentId,verified.companyId,verified.channelRoomId,
        verified.bootstrapRevision].join(':');
      this.consumedKey=consumedKey;
      // Persist exact draft & viewport BEFORE emitting. Never post another human message.
      if(!this.persist()){
        this.consumedKey=null;
        this.publish('UNAVAILABLE','Cannot preserve your draft and scroll; navigation was not proposed.');
        return {ok:false,reason:'STORAGE_UNAVAILABLE'};
      }
      this.navigationProposed=true;
      this.publish('READY_PROPOSED','Native room confirmed by server; waiting for authorized app navigation.');
      const proposal:Object=Object.freeze({
        receipt:verified,intentId:this.intent.intentId,originalPrompt:this.intent.originalPrompt,
        draft:this.draft,scrollTop:this.scrollTop,sourceMessageId:verified.sourceMessageId,
        navigationIsProposedOnly:true
      } as TransitionProposal);
      this.onNavigationProposed(proposal as TransitionProposal);
      return {ok:true,proposal:proposal as TransitionProposal};
    }catch{
      this.publish('DENIED','The native transition proof could not be verified. Nothing was created or navigated.');
      return {ok:false,reason:'INVALID_NATIVE_RECEIPT'};
    }finally{this.lock=false;}
  }
  clear():void {
    try{this.storage?.removeItem(ONBOARDING_STORAGE_KEY)}catch{}
    this.intent=null;this.draft='';this.scrollTop=0;this.consumedKey=null;
    this.navigationProposed=false;this.publish('IDLE','');
  }
}
