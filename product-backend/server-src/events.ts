import type { Store } from './store.js';
import { CompanyEventLedger, type CompanyEventInput, type CompanyEventListOptions } from './company-events.js';
export * from './company-events.js';

export class Events {
  private listeners=new Map<string,Set<(value:any)=>void>>();
  readonly companyEvents?: CompanyEventLedger;
  constructor(store?:Store){ if(store)this.companyEvents=new CompanyEventLedger(store); }
  publish(topic:string,value:any=null) { for(const listener of this.listeners.get(topic)||[])listener(value); }
  company(input:CompanyEventInput){ if(!this.companyEvents)throw new Error('Company event ledger unavailable'); return this.companyEvents.publish(input); }
  listCompanyEvents(options:CompanyEventListOptions={}){ return this.companyEvents?.list(options)||[]; }
  getCompanyEvent(id:string){ return this.companyEvents?.get(id); }
  companyEventSummary(options:Omit<CompanyEventListOptions,'limit'|'afterCursor'>={}){ return this.companyEvents?.summary(options)||{total:0,lastSequence:0,byType:{},bySource:{}}; }
  acknowledgeCompanyEvents(consumer:string,cursor:number){ if(!this.companyEvents)throw new Error('Company event ledger unavailable'); return this.companyEvents.acknowledge(consumer,cursor); }
  companyEventAcknowledgement(consumer:string){ return this.companyEvents?.acknowledgement(consumer)||0; }
  iterator(topic:string):AsyncIterableIterator<any> {
    const queue:any[]=[];let resolve:((value:IteratorResult<any>)=>void)|undefined;let closed=false;
    const listener=(value:any)=>{if(resolve){const r=resolve;resolve=undefined;r({value,done:false});}else{if(queue.length>=50)queue.shift();queue.push(value);}};
    if(!this.listeners.has(topic))this.listeners.set(topic,new Set());this.listeners.get(topic)!.add(listener);
    return {[Symbol.asyncIterator](){return this;},next:()=>{if(closed)return Promise.resolve({value:undefined,done:true});if(queue.length)return Promise.resolve({value:queue.shift(),done:false});return new Promise(r=>{resolve=r;});},return:()=>{closed=true;this.listeners.get(topic)?.delete(listener);resolve?.({value:undefined,done:true});return Promise.resolve({value:undefined,done:true});}};
  }
}
