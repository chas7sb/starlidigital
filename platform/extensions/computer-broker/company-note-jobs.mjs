import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,timingSafeEqual,createHmac} from 'node:crypto';
const MAX=16384;
const canon=v=>{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canon).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}'};
export const digest=v=>createHash('sha256').update(canon(v)).digest('hex');
const tokenHash=v=>createHash('sha256').update(v).digest('hex');
const deny=()=>{throw Error('COMPANY_NOTE_DENIED')};
const fields=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const ident=v=>typeof v==='string'&&v.length>0&&v.length<=160;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validateJob(j){
 const keys=['companyId','computerId','workerId','actorUserId','botId','roomId','runId','assistantMessageId','toolCallId','operationId','membershipRevision','text','noteSha256'];
 if(!fields(j,keys)||!uuid(j.companyId)||!uuid(j.computerId)||!keys.filter(k=>!['membershipRevision','text'].includes(k)).every(k=>ident(j[k]))||!Number.isSafeInteger(j.membershipRevision)||j.membershipRevision<1)deny();
 if(typeof j.text!=='string'||!j.text.length||j.text.length>500||Buffer.byteLength(j.text)>2000||/[\x00-\x08\x0b-\x1f\x7f]/.test(j.text)||!hex(j.noteSha256)||createHash('sha256').update(j.text).digest('hex')!==j.noteSha256)deny();
 return j;
}
export class CompanyNoteJobs{
 constructor(path,{authorize,verifySubmission,signReply,resolveBinding,clock=()=>Date.now()}){
  if([authorize,verifySubmission,signReply,resolveBinding].some(fn=>typeof fn!=='function'))throw Error('REQUIRED_COMPANY_SECURITY_HOOK_MISSING');
  this.db=new DatabaseSync(path);
  // Viewer authorization reads this database on a separate native connection.
  // WAL lets a nonce/claim commit while that reader's enrollment snapshot is open.
  this.db.exec('PRAGMA busy_timeout=1500');
  this.db.exec('PRAGMA journal_mode=WAL');
  this.authorize=authorize;this.verifySubmission=verifySubmission;this.signReply=signReply;this.resolveBinding=resolveBinding;this.clock=clock;
  this.db.exec(`CREATE TABLE IF NOT EXISTS company_note_principals(id TEXT PRIMARY KEY,company TEXT NOT NULL,computer TEXT NOT NULL,worker TEXT NOT NULL,role TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,enrollment_revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS company_note_jobs(company TEXT,operation TEXT,worker TEXT NOT NULL,job TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL,claim TEXT,receipt TEXT,binding TEXT,PRIMARY KEY(company,operation));
CREATE TABLE IF NOT EXISTS company_note_nonces(principal TEXT,nonce TEXT,expires INTEGER,PRIMARY KEY(principal,nonce));`);
  if(!this.db.prepare('PRAGMA table_info(company_note_principals)').all().some(r=>r.name==='enrollment_revision'))this.db.exec('ALTER TABLE company_note_principals ADD COLUMN enrollment_revision INTEGER NOT NULL DEFAULT 1');
  if(!this.db.prepare('PRAGMA table_info(company_note_jobs)').all().some(r=>r.name==='binding'))this.db.exec('ALTER TABLE company_note_jobs ADD COLUMN binding TEXT');
 }
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{let r=fn();this.db.exec('COMMIT');return r}catch(e){this.db.exec('ROLLBACK');throw e}}
 register({id,company,computer,worker,role},operatorProof,verifyOperator){
  if(!uuid(company)||!uuid(computer)||!ident(id)||!ident(worker)||!['producer','worker','publisher'].includes(role)||verifyOperator({id,company,computer,worker,role},operatorProof)!==true)deny();
  const secret=(role==='publisher'?'starli_company_publisher_':'starli_company_note_')+randomBytes(32).toString('hex');
  this.db.prepare('INSERT INTO company_note_principals(id,company,computer,worker,role,token_hash,revoked) VALUES(?,?,?,?,?,?,0)').run(id,company,computer,worker,role,tokenHash(secret));
  return secret; // one-time private operator intake only, never public GraphQL enrollment
 }
 principal(token,role){
  if(typeof token!=='string'||token.length>150||!token.startsWith(role==='publisher'?'starli_company_publisher_':'starli_company_note_'))deny();
  const p=this.db.prepare('SELECT * FROM company_note_principals WHERE token_hash=? AND revoked=0 AND role=?').get(tokenHash(token),role);if(!p)deny();return p;
 }
 async fresh(p,j,phase){
  if(!this.db.prepare('SELECT 1 FROM company_note_principals WHERE id=? AND revoked=0').get(p.id)||(j.companyId!==p.company||j.computerId!==p.computer||j.workerId!==p.worker)||await this.authorize(j,phase)!==true)deny();
  if(!this.db.prepare('SELECT 1 FROM company_note_principals WHERE id=? AND revoked=0').get(p.id))deny();
 }
 async submit(token,envelope){
  const p=this.principal(token,'producer');const j=validateJob(await this.verifySubmission(envelope));await this.fresh(p,j,'submit');const hash=digest(j);
  this.tx(()=>{if(this.db.prepare('SELECT COUNT(*) AS n FROM company_note_jobs').get().n>=10000)deny();const old=this.db.prepare('SELECT digest FROM company_note_jobs WHERE company=? AND operation=?').get(j.companyId,j.operationId);if(old){if(old.digest!==hash)deny();return}this.db.prepare('INSERT INTO company_note_jobs VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL)').run(j.companyId,j.operationId,j.workerId,JSON.stringify(j),hash,'QUEUED',this.clock()+60000)});
  await this.fresh(p,j,'submitted');return {operationId:j.operationId,state:'QUEUED',jobDigest:hash};
 }
 parse(message){if(typeof message!=='string'||Buffer.byteLength(message)>MAX)deny();let m;try{m=JSON.parse(message)}catch{deny()}if(!m||typeof m.nonce!=='string'||!/^[a-f0-9]{32}$/.test(m.nonce))deny();return m}
 async exchange(token,message){
  const p=this.principal(token,'worker'),m=this.parse(message);
  this.tx(()=>{this.db.prepare('DELETE FROM company_note_nonces WHERE expires<?').run(this.clock());if(this.db.prepare('SELECT COUNT(*) AS n FROM company_note_nonces WHERE principal=?').get(p.id).n>=120)deny();this.db.prepare('INSERT INTO company_note_nonces VALUES(?,?,?)').run(p.id,m.nonce,this.clock()+120000)});
  let result;
  if(m.action==='claim'){
   if(!fields(m,['action','nonce']))deny();
   const row=this.db.prepare("SELECT * FROM company_note_jobs WHERE company=? AND worker=? AND state='QUEUED' AND expires>? ORDER BY expires LIMIT 1").get(p.company,p.worker,this.clock());
   if(!row)result={state:'EMPTY'};
   else{const j=JSON.parse(row.job);await this.fresh(p,j,'claim');const claim=randomBytes(16).toString('hex');const changed=this.db.prepare("UPDATE company_note_jobs SET state='CLAIMED',claim=? WHERE company=? AND operation=? AND state='QUEUED' AND expires>?").run(claim,p.company,j.operationId,this.clock());result=changed.changes===1?{state:'CLAIMED',job:j,jobDigest:row.digest,claim}: {state:'EMPTY'}}
  }else{
   const keys=m.action==='authorize'?['action','nonce','operationId','jobDigest','claim']:m.action==='complete'?['action','nonce','operationId','jobDigest','claim','receipt']:[];
   if(!keys.length||!fields(m,keys)||!ident(m.operationId)||!hex(m.jobDigest)||typeof m.claim!=='string'||!/^[a-f0-9]{32}$/.test(m.claim))deny();
   const row=this.db.prepare('SELECT * FROM company_note_jobs WHERE company=? AND operation=? AND worker=?').get(p.company,m.operationId,p.worker);
   if(!row||row.digest!==m.jobDigest||row.claim!==m.claim||row.expires<=this.clock())deny();
   const j=JSON.parse(row.job);await this.fresh(p,j,m.action);
   if(m.action==='authorize'){
    if(!['CLAIMED','DISPATCHING'].includes(row.state))deny();
    if(typeof this.resolveBinding!=='function')deny();
    const scope=await this.resolveBinding(j);if(!scope||scope.company_id!==j.companyId||scope.native_actor_id!==j.actorUserId||scope.agent_id!==j.botId||scope.conversation_id!==j.roomId||scope.run_id!==j.runId||scope.assistant_id!==j.assistantMessageId||scope.request_id!==j.toolCallId||scope.membership_revision!==j.membershipRevision||scope.actor!=='agent'||!ident(scope.viewer_id)||!ident(scope.membership_id)||!ident(scope.node_actor_id))deny();
    if(row.binding&&digest(JSON.parse(row.binding))!==digest(scope))deny();
    await this.fresh(p,j,'pre-effect-binding');
    this.db.prepare("UPDATE company_note_jobs SET state='DISPATCHING',binding=? WHERE company=? AND operation=?").run(JSON.stringify(scope),p.company,m.operationId);
    result={state:'AUTHORIZED',operationId:m.operationId,jobDigest:row.digest,nonce:m.nonce,scope};
   }else{
    if(row.state==='DISPLAYED'){if(digest(JSON.parse(row.receipt))!==digest(m.receipt))deny();result={state:'DISPLAYED',operationId:m.operationId}}
    else{
     if(row.state!=='DISPATCHING'||!fields(m.receipt,['state','companyId','computerId','actorUserId','workerId','operationId','runId','assistantMessageId','toolCallId','noteSha256','frameSha256','epoch','physicalReceiptDigest','signedPhysicalReceipt','viewerId','physicalReceipt'])||m.receipt.state!=='DISPLAYED'||!hex(m.receipt.frameSha256)||!hex(m.receipt.physicalReceiptDigest)||!Number.isSafeInteger(m.receipt.epoch)||m.receipt.epoch<1||!ident(m.receipt.viewerId)||typeof m.receipt.signedPhysicalReceipt!=='string'||m.receipt.signedPhysicalReceipt.length>8192)deny();
     if(!row.binding||m.receipt.viewerId!==JSON.parse(row.binding).viewer_id)deny();
     for(const k of ['companyId','computerId','actorUserId','workerId','operationId','runId','assistantMessageId','toolCallId','noteSha256'])if(m.receipt[k]!==j[k])deny();
     if(await this.authorize(j,'verify-physical-receipt',m.receipt)!==true)deny();
     this.db.prepare("UPDATE company_note_jobs SET state='DISPLAYED',receipt=? WHERE company=? AND operation=? AND state='DISPATCHING'").run(JSON.stringify(m.receipt),p.company,m.operationId);
     result={state:'DISPLAYED',operationId:m.operationId,receiptDigest:digest(m.receipt)};
    }
   }
  }
  return this.signReply(p,{nonce:m.nonce,requestDigest:digest(m),result});
 }
 publisherIdentity(token,request,sign){
  const p=this.principal(token,'publisher');
  if(!fields(request,['companyId','computerId','workerId','purpose','method','path','nonce','bodySha256'])||request.companyId!==p.company||request.computerId!==p.computer||request.workerId!==p.worker||!hex(request.bodySha256)||typeof request.nonce!=='string'||!/^[a-f0-9]{32}$/.test(request.nonce))deny();
  if(!((request.purpose==='frame.work'&&request.method==='GET'&&request.path==='/api/v1/company-computer/relay/publisher/work'&&request.bodySha256===createHash('sha256').update('').digest('hex'))||(request.purpose==='frame.publish'&&request.method==='POST'&&request.path==='/api/v1/company-computer/relay/publisher/frames')))deny();
  this.tx(()=>{this.db.prepare('DELETE FROM company_note_nonces WHERE expires<?').run(this.clock());if(this.db.prepare('SELECT COUNT(*) AS n FROM company_note_nonces WHERE principal=?').get(p.id).n>=2400)deny();this.db.prepare('INSERT INTO company_note_nonces VALUES(?,?,?)').run(p.id,request.nonce,this.clock()+120000)});
  return sign(p,{...request,servicePrincipalId:p.id,enrollmentRevision:p.enrollment_revision,authorized:true,requestDigest:digest(request)});
 }
 async status(token,operation){
  const p=this.principal(token,'producer');if(!ident(operation))deny();
  const row=this.db.prepare('SELECT * FROM company_note_jobs WHERE company=? AND operation=? AND worker=?').get(p.company,operation,p.worker);if(!row)deny();
  await this.fresh(p,JSON.parse(row.job),'delivery-status');
  return {operationId:operation,state:row.state,jobDigest:row.digest,receipt:row.receipt?JSON.parse(row.receipt):null};
 }
 revoke(id){this.db.prepare('UPDATE company_note_principals SET revoked=1,enrollment_revision=enrollment_revision+1 WHERE id=?').run(id)}
 close(){this.db.close()}
}
export function companyNoteGraphQL(service){return {
 typeDefs:`type CompanyNoteExchange { message:String! } extend type Mutation { companyComputerNoteExchange(deviceToken:String!,message:String!):CompanyNoteExchange! companyComputerNoteSubmit(serviceToken:String!,envelope:String!):CompanyNoteExchange! companyComputerNoteStatus(serviceToken:String!,operationId:String!):CompanyNoteExchange! }`,
 resolvers:{Mutation:{companyComputerNoteStatus:async(_,{serviceToken,operationId})=>({message:JSON.stringify(await service.status(serviceToken,operationId))}),companyComputerNoteExchange:async(_,{deviceToken,message})=>({message:JSON.stringify(await service.exchange(deviceToken,message))}),companyComputerNoteSubmit:async(_,{serviceToken,envelope})=>{if(typeof envelope!=='string'||Buffer.byteLength(envelope)>MAX)deny();return {message:JSON.stringify(await service.submit(serviceToken,JSON.parse(envelope)))}}}}
}}
