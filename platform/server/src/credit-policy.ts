import{creditOwnerId,billingAccount}from'./subscriptions.js';
import{createHash}from'node:crypto';import{Store,id,now,type RecordData}from'./store.js';import{creditsWallet,reserveCredits,settleCredits,releaseCredits}from'./credits.js';import{fail,type Context}from'./security.js';
export type CreditAction='build'|'edit'|'images'|'research';
function cost(key:string,fallback:number){const raw=process.env[key];if(raw===undefined)return fallback;const n=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(n)||n<1||n>100000)throw Error('Costul în credite nu este configurat corect.');return n;}
export function creditCosts(){return{enabled:process.env.CREDITS_ENFORCED==='true',build:cost('CREDIT_COST_BUILD',100),edit:cost('CREDIT_COST_EDIT',25),images:cost('CREDIT_COST_IMAGES',40),research:cost('CREDIT_COST_RESEARCH',10)};}
export function buildCreditCost(project:RecordData|undefined,images=false){const c=creditCosts();return (project?.files?.length?c.edit:c.build)+(images?c.images:0);}
function atomic<T>(store:Store,fn:()=>T){const nested=store.db.isTransaction;store.db.exec(nested?'SAVEPOINT credit_policy':'BEGIN IMMEDIATE');try{const r=fn();store.db.exec(nested?'RELEASE SAVEPOINT credit_policy':'COMMIT');return r;}catch(e){if(nested){store.db.exec('ROLLBACK TO SAVEPOINT credit_policy');store.db.exec('RELEASE SAVEPOINT credit_policy');}else store.db.exec('ROLLBACK');throw e;}}
export function admitFreeChat(store:Store,ctx:Context){if(!creditCosts().enabled||ctx.user?.role==='ADMIN')return;const day=new Date().toISOString().slice(0,10);const who=ctx.user?.id||ctx.guest||ctx.ip;const key='chat:'+day+':'+createHash('sha256').update(who).digest('hex');atomic(store,()=>{const usage=store.get('credit-free-usage',key)||{id:key,count:0};if(usage.count>=(ctx.user?100:10))fail('Ai atins limita de conversații pentru astăzi. Revino mâine sau scrie-i lui Alex.','RATE_LIMITED');store.put('credit-free-usage',{...usage,count:usage.count+1,updatedAt:now()});});}
export function reserveCreditAction(store:Store,ctx:Context,{amount,maxCredits=0,action,projectId,requestId}:{amount:number;maxCredits?:number;action:CreditAction;projectId?:string;requestId?:string}):string|null{
 if(!creditCosts().enabled||ctx.user?.role==='ADMIN')return null;
 if(!ctx.user){
  if(action!=='build')throw Error('Creează un cont și alimentează portofelul pentru această operațiune.');
  const day=new Date().toISOString().slice(0,10);const key='demo:'+day+':'+createHash('sha256').update(ctx.ip).digest('hex');
  atomic(store,()=>{if(store.get('credit-free-usage',key))throw Error('Demonstrația gratuită a fost folosită. Creează un cont pentru a continua cu credite.');store.put('credit-free-usage',{id:key,count:1,createdAt:now()});});return null;
 }
 if(billingAccount(store,ctx.user.id).blocked)fail('Contul de facturare necesită verificare. Scrie-i lui Alex înainte de o nouă operațiune.','PAYMENT_REQUIRED');
 if(!Number.isSafeInteger(maxCredits)||maxCredits<amount)fail(`Această operațiune necesită ${amount} credite. Autorizează costul din conversație înainte de construire.`,'BAD_USER_INPUT');
 const ownerId=creditOwnerId(ctx.user.id);const key='ai:'+ownerId+':'+(requestId||id());
 return atomic(store,()=>{let reservation;try{reservation=reserveCredits(store,{ownerId,amount,key,action,projectId});}catch(error){if(error instanceof Error&&error.message==='Nu ai suficiente credite pentru această operațiune.')fail(error.message,'PAYMENT_REQUIRED');throw error;}
 if(reservation.status!=='RESERVED')throw Error('Această cerere a fost deja finalizată. Reîncarcă proiectul înainte de o cerere nouă.');
 store.put('credit-operations',{id:key,ownerId,amount,action,projectId:projectId||null,status:'RESERVED',createdAt:now()});return key;});
}
export function finishCreditAction(store:Store,key:string|null,success:boolean){if(!key)return;const op=store.get('credit-operations',key);if(!op)return;if(success)settleCredits(store,key);else releaseCredits(store,key,'Operațiunea nu s-a finalizat; creditele au fost eliberate.');store.put('credit-operations',{...op,status:success?'SETTLED':'RELEASED',updatedAt:now()});}
