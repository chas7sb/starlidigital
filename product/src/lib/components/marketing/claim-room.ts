/** Wave 4 stage-only extra owner-claim/room-ACL gate.
 * Zero client authority: verifying server is exclusively responsible for
 * registered JWT, claim ledger, room ACL and original human message.
 */
import type {TransitionProposal} from './onboarding-transition';
export const CLAIM_VERIFY_ROUTE='/api/v1/starli/onboarding/claim-navigation/verify'; // NOT MOUNTED
export type ClaimPhase='DISABLED'|'IDLE'|'VERIFYING'|'CLAIMED_ROOM_PROPOSED'|'REVOKED'|'DENIED'|'UNAVAILABLE';
export interface ClaimReceipt {
  schemaVersion:1;
  status:'CLAIMED_ROOM_READY';
  issuer:'starli-native-claim-room/v1';
  registeredPersonVerified:true;
  nativeClaimCommitted:true;
  roomAclFresh:true;
  guestCapabilityRevoked:true;
  originalHumanMessageConfirmed:true;
  intentId:string;
  eventId:string;
  companyId:string;
  channelRoomId:string;
  bossDmRoomId:string;
  sourceMessageId:string;
  bootstrapRevision:number;
  claimRevision:number;
  verifiedAt:string;
  expiresAt:string;
}
export interface VerifiedNavigation {
  receipt:ClaimReceipt;
  initialIntentId:string;
  originalPrompt:string;
  originalHumanMessageId:string;
  companyId:string;
  channelRoomId:string;
  bossDmRoomId:string;
  draft:string;
  scrollTop:number;
  navigationIsProposedOnly:true;
}
export interface ClaimStatus {
  phase:ClaimPhase;
  reason:string;
  claimedRoomId:string|null;
  navigationProposed:boolean;
}
type Fetcher=(url:string, init?:RequestInit)=>Promise<Response>;
const KEY_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRIVATE_KEYS=new Set(['guestBinding','guestSessionBinding','claimToken','bearerToken','rawCookie','authorization','accessToken','password','apiKey','ownerToken','sessionToken']);
const EXACT_FIELDS=new Set(['schemaVersion','status','issuer','registeredPersonVerified','nativeClaimCommitted','roomAclFresh','guestCapabilityRevoked','originalHumanMessageConfirmed','intentId','eventId','companyId','channelRoomId','bossDmRoomId','sourceMessageId','bootstrapRevision','claimRevision','verifiedAt','expiresAt']);
const isObj=(value:unknown): value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const positive=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const canonical=(v:unknown)=>typeof v==='string'&&KEY_RE.test(v);
const dateVal=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&/(Z|[+-]\d\d:\d\d)$/.test(s);
export function verifyClaimReceipt(raw:unknown, proposal:TransitionProposal,
  now=Date.now()):ClaimReceipt|null {
  if(!isObj(raw) || [...Object.keys(raw)].some(k=>!EXACT_FIELDS.has(k)||PRIVATE_KEYS.has(k)))return null;
  if(raw.schemaVersion!==1 || raw.status!=='CLAIMED_ROOM_READY' ||
    raw.issuer!=='starli-native-claim-room/v1' ||
    raw.registeredPersonVerified!==true || raw.nativeClaimCommitted!==true ||
    raw.roomAclFresh!==true || raw.guestCapabilityRevoked!==true ||
    raw.originalHumanMessageConfirmed!==true ||
    !positive(raw.claimRevision) || !positive(raw.bootstrapRevision) ||
    !dateVal(raw.verifiedAt) || !dateVal(raw.expiresAt))return null;
  for(const field of ['intentId','eventId','companyId','channelRoomId','bossDmRoomId','sourceMessageId']) {
    if(!canonical(raw[field]))return null;
  }
  const original=proposal.receipt;
  if(raw.intentId!==proposal.intentId || raw.eventId!==original.eventId ||
     raw.companyId!==original.companyId || raw.channelRoomId!==original.channelRoomId ||
     raw.bossDmRoomId!==original.bossDmRoomId ||
     raw.sourceMessageId!==proposal.sourceMessageId ||
     raw.bootstrapRevision!==original.bootstrapRevision ||
     original.originalPrompt!==proposal.originalPrompt ||
     raw.channelRoomId===raw.bossDmRoomId || (raw.claimRevision as number)<(raw.bootstrapRevision as number))return null;
  const verified=Date.parse(raw.verifiedAt as string),expiry=Date.parse(raw.expiresAt as string);
  if(expiry<=now || verified>now+30000 || verified<now-30000 ||
     expiry<=verified || expiry-verified>5*60*1000)return null;
  return Object.freeze({...raw}) as unknown as ClaimReceipt;
}
export class ClaimedRoomController {
  private enabled:boolean;
  private origin:string;
  private fetcher:Fetcher;
  private now:()=>number;
  private onChange:(status:ClaimStatus)=>void;
  private onVerified:(value:VerifiedNavigation)=>void;
  private phase:ClaimPhase='DISABLED';
  private reason='';
  private consumed=new Set<string>();
  private lock=false;
  private roomId:string|null=null;
  constructor({origin,enabled=false,fetcher,onChange=()=>{},onVerified=()=>{},now=Date.now}:{
    origin:string;enabled?:boolean;fetcher:Fetcher;onChange?:(status:ClaimStatus)=>void;
    onVerified?:(value:VerifiedNavigation)=>void;now?:()=>number;
  }) {
    if(typeof origin!=='string' || !/^https?:\/\/[^/]+$/.test(origin) ||
      new URL(origin).origin!==origin)throw Error('Claim gate requires exact same origin');
    if(typeof fetcher!=='function')throw Error('Native claim verifier fetch required');
    this.origin=origin;this.enabled=enabled;this.fetcher=fetcher;
    this.now=now;this.onChange=onChange;this.onVerified=onVerified;
    this.phase=enabled?'IDLE':'DISABLED';this.publish();
  }
  get snapshot():ClaimStatus {
    return Object.freeze({phase:this.phase,reason:this.reason,
      claimedRoomId:this.roomId,navigationProposed:this.consumed.size>0});
  }
  private publish(phase?:ClaimPhase, reason?:string) {
    if(phase)this.phase=phase;if(reason!==undefined)this.reason=reason;
    this.onChange(this.snapshot);
  }
  async check(proposal:unknown, signedIn:boolean):Promise<{ok:boolean;reason:string;status?:number}> {
    if(!this.enabled)return{ok:false,reason:'CAPABILITY_DISABLED'};
    if(!signedIn)return{ok:false,reason:'REGISTERED_PERSON_REQUIRED'};
    if(this.lock)return{ok:false,reason:'VERIFYING'};
    if(!isObj(proposal) || proposal.navigationIsProposedOnly!==true ||
      !isObj(proposal.receipt) || proposal.receipt.status!=='ROOM_READY' ||
      proposal.receipt.nativeAuthorityActive!==true ||
      proposal.receipt.transcriptPreserved!==true ||
      !canonical(proposal.intentId) || !canonical(proposal.sourceMessageId) ||
      typeof proposal.originalPrompt!=='string' || !proposal.originalPrompt.trim() ||
      typeof proposal.draft!=='string' || proposal.draft.length>4000 ||
      typeof proposal.scrollTop!=='number' || proposal.scrollTop<0 ||
      !Number.isFinite(proposal.scrollTop))return{ok:false,reason:'UNTRUSTED_ROOM_PROPOSAL'};
    const ready=proposal as unknown as TransitionProposal;
    const key=[ready.intentId,ready.receipt.companyId,ready.receipt.channelRoomId,
      ready.receipt.bootstrapRevision,ready.receipt.eventId].join(':');
    if(this.consumed.has(key))return{ok:false,reason:'ALREADY_PROPOSED'};
    this.lock=true;this.publish('VERIFYING','Checking the current registered claim and native room membership.');
    try {
      const response=await this.fetcher.call(globalThis,CLAIM_VERIFY_ROUTE,{
        method:'POST',credentials:'include',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json','X-Starli-Claim-Verify':'1'},
        body:JSON.stringify({
          intentId:ready.intentId,companyId:ready.receipt.companyId,
          channelRoomId:ready.receipt.channelRoomId,bossDmRoomId:ready.receipt.bossDmRoomId,
          sourceMessageId:ready.sourceMessageId,eventId:ready.receipt.eventId,
          bootstrapRevision:ready.receipt.bootstrapRevision
        })
      });
      if(response.status===401||response.status===403||response.status===404){
        this.publish('REVOKED','Registered-owner claim or room access was denied or revoked.');
        return{ok:false,reason:'REVOKED',status:response.status};
      }
      if(!response.ok){
        this.publish('DENIED','Claim/room state not verified. No company route opened.');
        return{ok:false,reason:'CLAIM_NOT_READY',status:response.status};
      }
      if((response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')
        throw Error('Native verification response is not JSON');
      const payload=await response.json();
      const checked=verifyClaimReceipt(payload,ready,this.now());
      if(!checked){
        this.publish('DENIED','Native claim receipt did not match the original session and room.');
        return{ok:false,reason:'INVALID_CLAIM_RECEIPT'};
      }
      this.consumed.add(key);
      this.roomId=checked.channelRoomId;
      this.publish('CLAIMED_ROOM_PROPOSED','Registered claim and room membership verified for routing review.');
      const nav:Object=Object.freeze({receipt:checked,initialIntentId:ready.intentId,
        originalPrompt:ready.originalPrompt,originalHumanMessageId:ready.sourceMessageId,
        companyId:checked.companyId,channelRoomId:checked.channelRoomId,
        bossDmRoomId:checked.bossDmRoomId,draft:ready.draft,scrollTop:ready.scrollTop,
        navigationIsProposedOnly:true});
      this.onVerified(nav as VerifiedNavigation);
      return{ok:true,reason:'PROPOSAL_EMITTED'};
    }catch {
      this.publish('UNAVAILABLE','Current claim status could not be verified; no navigation.');
      return{ok:false,reason:'VERIFY_UNAVAILABLE'};
    }finally{this.lock=false;}
  }
  revoke():void {
    this.consumed.clear();this.roomId=null;this.publish('REVOKED','This claim and room must be reauthorized.');
  }
}
