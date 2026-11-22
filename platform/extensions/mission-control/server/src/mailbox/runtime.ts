import type {Store} from '../store.js';
import type {Events} from '../events.js';
import {createAgencyMailbox} from './agency-mailbox.js';
import {redactSecrets} from './sanitizer.js';

/** API process owns polling; folder leases coordinate it with manual/MCP sync. */
export function startMailboxSync(store:Store,events:Events){
  const mailbox=createAgencyMailbox({store,events});
  const configured=mailbox.getAccount().imapConfigured&&process.env.MAILBOX_SYNC_ENABLED!=='false';
  let pending:Promise<void>|undefined,stopped=false;
  const intervalValue=Number(process.env.MAILBOX_SYNC_INTERVAL_MS || 60000),interval=Number.isFinite(intervalValue)?Math.max(30000,Math.min(900000,intervalValue)):60000;
  store.put('mailbox-runtime',{id:'default',configured,pollIntervalMs:interval,updatedAt:new Date().toISOString()});
  const run=()=>{
    if(stopped||!configured||pending)return;
    pending=(async()=>{
      const startedAt=new Date().toISOString();
      try{
        let hasMore=false;
        for(const folder of ['INBOX',...(process.env.IMAP_SENT_FOLDER?[process.env.IMAP_SENT_FOLDER]:[])]){
          let result:{hasMore?:boolean};
          for(let batch=0;batch<4;batch++){result=await mailbox.syncMailbox(folder);if(!result.hasMore)break;if(batch===3)hasMore=true;}
        }
        store.put('mailbox-runtime',{id:'default',configured:true,pollIntervalMs:interval,hasMore,lastAttemptAt:startedAt,lastSuccessAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      }catch(error){
        const previous=store.get('mailbox-runtime','default');
        store.put('mailbox-runtime',{...previous,id:'default',configured:true,pollIntervalMs:interval,lastAttemptAt:startedAt,lastError:redactSecrets(error instanceof Error?error.message:'Mailbox sync failed').slice(0,400),updatedAt:new Date().toISOString()});
      }
    })().finally(()=>{pending=undefined;});
  };
  const first=setTimeout(run,5000);first.unref();const timer=setInterval(run,interval);timer.unref();
  return async()=>{stopped=true;clearTimeout(first);clearInterval(timer);await pending;};
}
