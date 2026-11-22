import {createHash,randomUUID} from 'node:crypto';
import type {Store} from '../store.js';
import type {
  FacebookCustomer,FacebookOAuthConnection,FacebookPageSelection,
  FacebookPageSelectionStore,FacebookPageSelectionWriteGuard,FacebookPageAudit,
} from './customer-page-selection.js';

/**
 * SQLite-backed Page selection and durable audit for the isolated customer pilot.
 * OAuth grant lookup is supplied by LCG2's trusted SERVER-ONLY synchronous helper;
 * no OAuth credentials or raw Page tokens enter this adapter or its audit records.
 * This uses the same Store SQLite connection and records schema as OAuth to make
 * BEGIN IMMEDIATE cover both the OAuth grant read and selection/audit writes.
 */
export class SQLiteFacebookPageSelectionStore implements FacebookPageSelectionStore {
  private static readonly CHOICES='facebook-page-selections';
  private static readonly AUDIT='facebook-page-selection-audit';
  constructor(
    private readonly store:Store,
    private readonly getGrant:(customer:FacebookCustomer,connectionId:string)=>FacebookOAuthConnection|null,
    private readonly now:()=>number=Date.now,
  ){}

  private key(customer:FacebookCustomer){
    if(!customer||typeof customer.tenantId!=='string'||typeof customer.userId!=='string'||
       !/^[A-Za-z0-9_.:-]{1,160}$/.test(customer.tenantId)||
       !/^[A-Za-z0-9_.:-]{1,160}$/.test(customer.userId))throw new Error('Authenticated customer required');
    return 'fb-choice-'+createHash('sha256').update(customer.tenantId+'\0'+customer.userId).digest('hex');
  }
  private auditPayload(customer:FacebookCustomer,audit:FacebookPageAudit){
    if(audit.tenantId!==customer.tenantId||audit.userId!==customer.userId)throw new Error('Facebook audit customer mismatch');
    if(!['FACEBOOK_PAGES_LIST','FACEBOOK_PAGE_SELECTED','FACEBOOK_PAGE_SELECTION_CLEARED','FACEBOOK_PAGE_REVALIDATED','FACEBOOK_PAGE_CURRENT'].includes(audit.action))throw new Error('Invalid Facebook audit action');
    return {id:'fb-audit-'+randomUUID(),action:audit.action,tenantId:customer.tenantId,userId:customer.userId,
      ...(audit.connectionId?{connectionId:audit.connectionId}:{}),...(audit.pageId?{pageId:audit.pageId}:{}),
      occurredAt:new Date(this.now()).toISOString()};
  }
  private write(collection:string,id:string,owner:string,payload:Record<string,unknown>){
    this.store.db.prepare('INSERT INTO records(collection,id,owner,payload) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET owner=excluded.owner,payload=excluded.payload')
      .run(collection,id,owner,JSON.stringify(payload));
  }
  async getConnection(customer:FacebookCustomer,connectionId:string){
    this.key(customer);
    const row=this.getGrant(customer,connectionId);
    if(!row)return null;
    if(row.id!==connectionId||row.tenantId!==customer.tenantId||row.userId!==customer.userId||row.platform!=='FACEBOOK')
      throw new Error('Facebook OAuth grant ownership mismatch');
    return {...row,scopes:[...row.scopes]};
  }
  async getSelection(customer:FacebookCustomer){
    const id=this.key(customer);
    const row=this.store.db.prepare('SELECT owner,payload FROM records WHERE collection=? AND id=?')
      .get(SQLiteFacebookPageSelectionStore.CHOICES,id) as {owner:unknown;payload:unknown}|undefined;
    if(!row)return null;
    if(row.owner!==customer.tenantId||typeof row.payload!=='string')throw new Error('Facebook Page selection ownership mismatch');
    let selection:FacebookPageSelection;
    try{selection=JSON.parse(row.payload) as FacebookPageSelection;}catch{throw new Error('Facebook Page selection unavailable');}
    if(!selection||selection.tenantId!==customer.tenantId||selection.userId!==customer.userId||
       typeof selection.pageId!=='string'||!/^[0-9]{1,32}$/.test(selection.pageId)||
       typeof selection.connectionRevision!=='string')throw new Error('Facebook Page selection ownership mismatch');
    return selection;
  }
  async commitSelection(customer:FacebookCustomer,selection:FacebookPageSelection|null,audit:FacebookPageAudit,
    guard:FacebookPageSelectionWriteGuard|null){
    const id=this.key(customer);
    const auditRow=this.auditPayload(customer,audit);
    if(selection){
      if(audit.action!=='FACEBOOK_PAGE_SELECTED'||!guard||selection.tenantId!==customer.tenantId||
        selection.userId!==customer.userId||selection.connectionId!==guard.connectionId||
        selection.connectionRevision!==guard.connectionRevision||audit.pageId!==selection.pageId)
        throw new Error('Invalid Facebook Page selection write');
    }else if(audit.action!=='FACEBOOK_PAGE_SELECTION_CLEARED'||guard!==null){
      throw new Error('Invalid Facebook Page selection clear');
    }
    this.store.db.exec('BEGIN IMMEDIATE');
    try{
      // Synchronous grant lookup intentionally happens INSIDE the SQL lock.
      if(selection&&guard){
        const live=this.getGrant(customer,guard.connectionId);
        if(!live||live.id!==guard.connectionId||live.tenantId!==customer.tenantId||
          live.userId!==customer.userId||live.platform!=='FACEBOOK'||live.status!=='CONNECTED'||
          live.revision!==guard.connectionRevision||!Array.isArray(live.scopes)||
          !guard.requiredScopes.every(scope=>live.scopes.includes(scope))||
          (live.expiresAt!==undefined&&(!Number.isFinite(Date.parse(live.expiresAt))||Date.parse(live.expiresAt)<=this.now())))
          throw new Error('Facebook connection changed before selection commit');
      }
      if(selection){
        const existing=this.store.db.prepare('SELECT owner FROM records WHERE collection=? AND id=?')
          .get(SQLiteFacebookPageSelectionStore.CHOICES,id) as {owner:unknown}|undefined;
        if(existing&&existing.owner!==customer.tenantId)throw new Error('Facebook Page selection ownership mismatch');
        this.write(SQLiteFacebookPageSelectionStore.CHOICES,id,customer.tenantId,{...selection,id});
      }else{
        this.store.db.prepare('DELETE FROM records WHERE collection=? AND id=? AND owner=?')
          .run(SQLiteFacebookPageSelectionStore.CHOICES,id,customer.tenantId);
      }
      this.write(SQLiteFacebookPageSelectionStore.AUDIT,auditRow.id,customer.tenantId,auditRow);
      this.store.db.exec('COMMIT');
    }catch(error){
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }
  async recordAccess(audit:FacebookPageAudit){
    const customer={tenantId:audit.tenantId,userId:audit.userId};
    this.key(customer);
    const row=this.auditPayload(customer,audit);
    this.write(SQLiteFacebookPageSelectionStore.AUDIT,row.id,customer.tenantId,row);
  }
}
