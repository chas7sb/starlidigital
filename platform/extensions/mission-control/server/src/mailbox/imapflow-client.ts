import {ImapFlow} from 'imapflow';
import type {ImapClient,ImapClientConfig,ImapFetchResult,ImapMailboxStatus} from './imap-client.js';

const MAX_SOURCE_BYTES=2*1024*1024;
/** Maintained IMAP parser, verified TLS and EXAMINE/read-only mailbox access. */
export class ManagedImapClient implements ImapClient {
  private client:ImapFlow;
  constructor(config:ImapClientConfig){
    if(!config.secure&&!['127.0.0.1','::1','localhost'].includes(config.host))throw new Error('External IMAP connections require TLS');
    this.client=new ImapFlow({host:config.host,port:config.port,secure:config.secure,auth:{user:config.user,pass:config.pass},
      logger:false,disableAutoIdle:true,connectionTimeout:20000,greetingTimeout:15000,socketTimeout:30000,
      maxLiteralSize:MAX_SOURCE_BYTES+65536,maxResponseSize:MAX_SOURCE_BYTES+262144,maxLineLength:65536,tls:{rejectUnauthorized:true}});
    this.client.on('error',()=>{/* surfaced by the active command; never log protocol or credentials */});
  }
  async connect(){await this.client.connect();}
  async selectFolder(folder:string):Promise<ImapMailboxStatus>{
    const mailbox=await this.client.mailboxOpen(folder,{readOnly:true});
    return {name:folder,uidValidity:Number(mailbox.uidValidity),uidNext:mailbox.uidNext || 1,exists:mailbox.exists,recent:0};
  }
  async fetchRange(startUid:number,endUid?:number):Promise<ImapFetchResult[]>{
    const result:ImapFetchResult[]=[];
    for await(const item of this.client.fetch(`${startUid}:${endUid || '*'}`,{uid:true,flags:true,size:true,source:{start:0,maxLength:MAX_SOURCE_BYTES}},{uid:true})){
      result.push({seq:item.seq,uid:item.uid,flags:[...(item.flags || [])],raw:item.source?.toString('utf8'),sourceTruncated:(item.size || 0)>MAX_SOURCE_BYTES});
    }
    return result;
  }
  async findUids(startUid:number,limit:number){
    const uids=await this.client.search({uid:`${startUid}:*`},{uid:true});
    if(!Array.isArray(uids))throw new Error('IMAP UID search failed');
    return uids.filter(uid=>uid>=startUid).sort((a,b)=>a-b).slice(0,limit);
  }
  async close(){try{if(this.client.usable)await this.client.logout();}finally{this.client.close();}}
}
