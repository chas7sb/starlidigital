import {randomUUID} from 'node:crypto';
/**
 * Customer Facebook Page selection boundary for the Velour pilot.
 * NO Meta calls, tokens or persistence implementation live here. The OAuth owner
 * supplies an authenticated connection; the provider supplies CURRENT Page tasks;
 * the backing store atomically persists selection + its audit record.
 */
export type FacebookCustomer = Readonly<{ tenantId:string; userId:string }>;
export type FacebookOAuthStatus = 'CONNECTED'|'REAUTH_REQUIRED'|'DISCONNECTED'|'ERROR';
export type FacebookOAuthConnection = Readonly<{
  id:string; tenantId:string; userId:string; platform:'FACEBOOK'; status:FacebookOAuthStatus;
  revision:string; scopes:readonly string[]; expiresAt?:string;
}>;
export type FacebookManagedPage = Readonly<{ id:string; name:string; tasks?:readonly string[] }>;
export type FacebookPageView = Readonly<{
  pageId:string; label:string; canPublish:boolean;
  reason?:'MISSING_POST_SCOPE'|'MISSING_CREATE_CONTENT_TASK';
}>;
/**
 * SERVER-ONLY bridge for LCG4's FacebookPageGrant contract. Never expose this
 * object as a customer MCP tool response; it is a fresh authorization result,
 * NOT a Meta Page access token, immutable lease, or proof of provider posting.
 * The fields below are populated ONLY after OAuth + live Page task validation.
 */
export type FacebookDispatchPageGrant = Readonly<{
  tenantId:string; ownerUserId:string; connectionId:string; pageId:string;
  connectionRevision:string; targetType:'PAGE'; status:'CONNECTED';
  tasks:string[]; scopes:string[];
}>;
export type FacebookPageSelection = Readonly<{
  tenantId:string; userId:string; connectionId:string; connectionRevision:string;
  pageId:string; label:string; selectedAt:string;
  /** Server-only per-choice identity; never returned through customer tools. */
  selectionNonce?:string;
}>;
export type FacebookPageAudit = Readonly<{
  action:'FACEBOOK_PAGES_LIST'|'FACEBOOK_PAGE_SELECTED'|'FACEBOOK_PAGE_SELECTION_CLEARED'|'FACEBOOK_PAGE_REVALIDATED'|'FACEBOOK_PAGE_CURRENT';
  tenantId:string; userId:string; connectionId?:string; pageId?:string; occurredAt:string;
}>;
/**
 * OAuth row precondition to validate in the SAME database transaction as the
 * selection + audit write. The store MUST read the current credential record,
 * not rely on the previously returned connection snapshot.
 */
export type FacebookPageSelectionWriteGuard = Readonly<{
  connectionId:string;
  connectionRevision:string;
  requiredScopes:readonly string[];
}>;
/** All methods MUST use the authenticated tenant/user as part of their DB key. */
export interface FacebookPageSelectionStore {
  getConnection(customer:FacebookCustomer,connectionId:string):Promise<FacebookOAuthConnection|null>;
  getSelection(customer:FacebookCustomer):Promise<FacebookPageSelection|null>;
  /**
   * Atomic conditional write: for nonnull guard require current OAuth record
   * tenant/user/FACEBOOK, CONNECTED, identical revision, unexpired token and
   * required scopes, then replace selection + append audit or reject ALL.
   * No OAuth guard on clearing a revoked customer's selection.
   */
  commitSelection(customer:FacebookCustomer,selection:FacebookPageSelection|null,audit:FacebookPageAudit,
    guard:FacebookPageSelectionWriteGuard|null):Promise<void>;
  /** Durable read/audit write; reject the caller if the log cannot be recorded. */
  recordAccess(audit:FacebookPageAudit):Promise<void>;
}
/**
 * Provider MUST use the connection's server-side OAuth credential, fetch Page
 * inventory freshly (including pagination) and return Meta-authenticated Page
 * tasks. Untrusted caller-supplied page/tasks/access tokens are NOT permitted.
 * Page access tokens and raw Graph responses MUST NEVER reach this service API.
 */
export interface FacebookManagedPageProvider {
  listManagedPages(connection:FacebookOAuthConnection):Promise<readonly FacebookManagedPage[]>;
}
const REQUIRED_POST_SCOPES=['pages_show_list','pages_read_engagement','pages_manage_posts'] as const;
const IDENTIFIER=/^[A-Za-z0-9_.:-]{1,160}$/;
const PAGE_ID=/^[0-9]{1,32}$/;
function validId(id:string,label:string):string {
  if(typeof id!=='string'||!IDENTIFIER.test(id))throw new Error(`Invalid ${label}`);
  return id;
}
function validCustomer(customer:FacebookCustomer):FacebookCustomer {
  if(!customer||typeof customer!=='object')throw new Error('Authenticated customer required');
  return {tenantId:validId(customer.tenantId,'tenant'),userId:validId(customer.userId,'user')};
}
function labelOf(input:unknown):string {
  if(typeof input!=='string')return '';
  return input.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,160);
}
function eligibleScopes(connection:FacebookOAuthConnection){
  return REQUIRED_POST_SCOPES.every(scope=>connection.scopes.includes(scope));
}
function assertConnection(connection:FacebookOAuthConnection|null,customer:FacebookCustomer,connectionId:string,now:number){
  if(!connection||connection.id!==connectionId||connection.tenantId!==customer.tenantId||connection.userId!==customer.userId)
    throw new Error('Facebook connection unavailable for this customer');
  if(connection.platform!=='FACEBOOK')throw new Error('Facebook connection unavailable for this customer');
  if(connection.status!=='CONNECTED')throw new Error('Facebook reconnection required');
  validId(connection.revision,'OAuth connection revision');
  if(!Array.isArray(connection.scopes)||!connection.scopes.includes('pages_show_list'))throw new Error('Facebook Page listing permission required');
  if(connection.expiresAt!==undefined){
    const expiry=Date.parse(connection.expiresAt);
    if(!Number.isFinite(expiry)||expiry<=now)throw new Error('Facebook reconnection required');
  }
}
function sanitizePages(raw:readonly FacebookManagedPage[],hasPostScopes:boolean):FacebookPageView[]{
  if(!Array.isArray(raw)||raw.length>500)throw new Error('Facebook Page inventory unavailable');
  const seen=new Set<string>(); const pages:FacebookPageView[]=[];
  for(const page of raw){
    if(!page||typeof page!=='object'||typeof page.id!=='string'||!PAGE_ID.test(page.id))throw new Error('Facebook Page inventory unavailable');
    if(seen.has(page.id))throw new Error('Facebook Page inventory unavailable');
    seen.add(page.id);
    const label=labelOf(page.name);
    if(!label)throw new Error('Facebook Page inventory unavailable');
    const taskCanPost=Array.isArray(page.tasks)&&page.tasks.includes('CREATE_CONTENT');
    pages.push({pageId:page.id,label,canPublish:hasPostScopes&&taskCanPost,
      ...(!hasPostScopes?{reason:'MISSING_POST_SCOPE' as const}:!taskCanPost?{reason:'MISSING_CREATE_CONTENT_TASK' as const}:{})});
  }
  return pages;
}

export class CustomerFacebookPageSelection {
  constructor(
    private readonly store:FacebookPageSelectionStore,
    private readonly provider:FacebookManagedPageProvider,
    private readonly now:()=>number=Date.now,
  ){}

  private audit(customer:FacebookCustomer,action:FacebookPageAudit['action'],connectionId?:string,pageId?:string):FacebookPageAudit {
    return {action,tenantId:customer.tenantId,userId:customer.userId,...(connectionId?{connectionId}:{}),
      ...(pageId?{pageId}:{}),occurredAt:new Date(this.now()).toISOString()};
  }

  private async connection(customer:FacebookCustomer,connectionId:string):Promise<FacebookOAuthConnection> {
    const connected=await this.store.getConnection(customer,connectionId);
    assertConnection(connected,customer,connectionId,this.now());
    return connected!;
  }

  /** Every request uses a fresh provider inventory and checks for OAuth rotation. */
  private async currentPages(customer:FacebookCustomer,connectionId:string){
    const connection=await this.connection(customer,connectionId);
    let raw:readonly FacebookManagedPage[];
    try { raw=await this.provider.listManagedPages(connection); }
    catch { throw new Error('Facebook Page inventory unavailable'); }
    const renewed=await this.connection(customer,connectionId);
    if(connection.revision!==renewed.revision||connection.status!==renewed.status||
       connection.scopes.slice().sort().join(',')!==renewed.scopes.slice().sort().join(','))
      throw new Error('Facebook connection changed; refresh Page selection');
    return {connection:renewed,pages:sanitizePages(raw,eligibleScopes(renewed))};
  }

  /** Only called after verified customer session; never outputs OAuth/Page tokens. */
  async listPages(authenticatedCustomer:FacebookCustomer,accountConnectionId:string){
    const customer=validCustomer(authenticatedCustomer);
    const connectionId=validId(accountConnectionId,'Facebook connection');
    const {connection,pages}=await this.currentPages(customer,connectionId);
    const saved=await this.store.getSelection(customer);
    const current=saved?.tenantId===customer.tenantId&&saved.userId===customer.userId&&
      saved.connectionId===connectionId&&saved.connectionRevision===connection.revision&&
      pages.some(page=>page.pageId===saved.pageId&&page.canPublish);
    await this.store.recordAccess(this.audit(customer,'FACEBOOK_PAGES_LIST',connectionId));
    return {connectionId,pages,selectedPageId:current?saved!.pageId:null};
  }

  /** Page selection is not publication authorization; it records explicit scope. */
  async selectPage(authenticatedCustomer:FacebookCustomer,accountConnectionId:string,requestedPageId:string){
    const customer=validCustomer(authenticatedCustomer);
    const connectionId=validId(accountConnectionId,'Facebook connection');
    if(typeof requestedPageId!=='string'||!PAGE_ID.test(requestedPageId))throw new Error('Invalid Facebook Page ID');
    const {connection,pages}=await this.currentPages(customer,connectionId);
    const page=pages.find(candidate=>candidate.pageId===requestedPageId);
    if(!page||!page.canPublish)throw new Error('Facebook Page posting permission unavailable');
    const selected:FacebookPageSelection={tenantId:customer.tenantId,userId:customer.userId,
      connectionId,connectionRevision:connection.revision,pageId:page.pageId,
      label:page.label,selectedAt:new Date(this.now()).toISOString(),selectionNonce:randomUUID()};
    await this.store.commitSelection(customer,selected,
      this.audit(customer,'FACEBOOK_PAGE_SELECTED',connectionId,page.pageId),
      {connectionId,connectionRevision:connection.revision,requiredScopes:REQUIRED_POST_SCOPES});
    return {connectionId,pageId:selected.pageId,label:selected.label,selectedAt:selected.selectedAt};
  }

  /**
   * Customer-facing CURRENT lookup. Never trust a stored selection by itself:
   * verify CURRENT OAuth binding and fresh Page CREATE_CONTENT task first.
   * Missing selection returns null; revoked or stale selection fails CLOSED.
   * No internal OAuth revision, provider token, or task array leaks to clients.
   */
  async currentPage(authenticatedCustomer:FacebookCustomer){
    const customer=validCustomer(authenticatedCustomer);
    const saved=await this.store.getSelection(customer);
    if(!saved){
      await this.store.recordAccess(this.audit(customer,'FACEBOOK_PAGE_CURRENT'));
      return {selectedPage:null};
    }
    if(saved.tenantId!==customer.tenantId||saved.userId!==customer.userId)
      throw new Error('Facebook selection ownership mismatch');
    const verified=await this.requireSelectedPublishPage(customer,saved.pageId);
    if(verified.connectionId!==saved.connectionId||verified.connectionRevision!==saved.connectionRevision)
      throw new Error('Facebook connection changed; select Page again');
    await this.store.recordAccess(this.audit(customer,'FACEBOOK_PAGE_CURRENT',verified.connectionId,verified.pageId));
    return {selectedPage:{connectionId:verified.connectionId,pageId:verified.pageId,
      label:verified.label,selectedAt:saved.selectedAt}};
  }

  /** Clear is always permitted for the authenticated customer, even after revoke. */
  async clearPage(authenticatedCustomer:FacebookCustomer){
    const customer=validCustomer(authenticatedCustomer);
    const saved=await this.store.getSelection(customer);
    if(saved&&(saved.tenantId!==customer.tenantId||saved.userId!==customer.userId))throw new Error('Facebook selection ownership mismatch');
    await this.store.commitSelection(customer,null,this.audit(customer,'FACEBOOK_PAGE_SELECTION_CLEARED',saved?.connectionId,saved?.pageId),null);
    return {selectedPageId:null};
  }

  /**
   * Resolve the exact LCG4 post-now `FacebookPageGrant` shape from a verified
   * server principal and the CURRENT saved, managed Facebook Page only.
   * The optional customer tool-selected Page ID MUST NOT supply rights/tasks.
   * Call again immediately before each dispatch; do not cache for scheduled jobs.
   * IMPORTANT: no provider token or media bytes are returned here.
   */
  async requireSelectedDispatchGrant(authenticatedCustomer:FacebookCustomer,expectedConnectionId:string):Promise<FacebookDispatchPageGrant>{
    const customer=validCustomer(authenticatedCustomer);
    const connectionId=validId(expectedConnectionId,'Facebook connection');
    const current=await this.requireSelectedPublishPage(customer);
    if(current.connectionId!==connectionId)
      throw new Error('Facebook connection does not match selected Page');
    return {tenantId:customer.tenantId,ownerUserId:customer.userId,
      connectionId:current.connectionId,pageId:current.pageId,
      connectionRevision:current.connectionRevision,targetType:'PAGE',status:'CONNECTED',
      tasks:['CREATE_CONTENT'],scopes:[...REQUIRED_POST_SCOPES]};
  }

  /**
   * LCG4/5 MUST invoke this immediately before a provider write. No raw pageId
   * may bypass the stored customer selection, fresh OAuth binding and Page task.
   * Publishing authorization/idempotency/receipts remain in their own owners.
   */
  async requireSelectedPublishPage(authenticatedCustomer:FacebookCustomer,requestedPageId?:string){
    const customer=validCustomer(authenticatedCustomer);
    const selected=await this.store.getSelection(customer);
    if(!selected||selected.tenantId!==customer.tenantId||selected.userId!==customer.userId)
      throw new Error('No Facebook Page selected for this customer');
    if(typeof requestedPageId!=='undefined'&&requestedPageId!==selected.pageId)
      throw new Error('Facebook Page does not match selected Page');
    const connectionId=validId(selected.connectionId,'Facebook connection');
    const {connection,pages}=await this.currentPages(customer,connectionId);
    if(selected.connectionRevision!==connection.revision)
      throw new Error('Facebook connection changed; select Page again');
    // Inventory involves an async provider read. The customer can CLEAR or
    // SELECT a different Page during that await; an earlier selection is not
    // durable dispatch authority. A new nonce detects even same-Page reselection
    // when the customer clock has not advanced.
    const latest=await this.store.getSelection(customer);
    if(!latest||latest.tenantId!==customer.tenantId||latest.userId!==customer.userId||
      latest.connectionId!==selected.connectionId||latest.pageId!==selected.pageId||
      latest.connectionRevision!==selected.connectionRevision||
      latest.selectionNonce!==selected.selectionNonce||latest.selectedAt!==selected.selectedAt)
      throw new Error('Facebook Page selection changed during verification');
    const page=pages.find(candidate=>candidate.pageId===selected.pageId&&candidate.canPublish);
    if(!page)throw new Error('Facebook Page posting permission unavailable');
    await this.store.recordAccess(this.audit(customer,'FACEBOOK_PAGE_REVALIDATED',connectionId,page.pageId));
    return {connectionId,pageId:page.pageId,label:page.label,connectionRevision:connection.revision};
  }
}
