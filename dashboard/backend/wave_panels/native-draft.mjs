import {createHash} from 'node:crypto';
import {validate} from './studio.mjs';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
// Called ONLY from EmailCall's internal worker adapter. No public HTTP method exposes this.
export function nativeDraft(studio,ctx,resourceId,params){
 if(!/^[a-f0-9]{64}$/.test(params.nativeOperationId)||!Number.isInteger(params.expectedRevision)||params.expectedRevision<0||params.expectedRevision===0&&resourceId||params.expectedRevision>0&&!resourceId)throw Error('Native draft admission required');
 validate(params.document);studio.scope(ctx,'write');
 const fingerprint=createHash('sha256').update(canonical({ctx,resourceId,expectedRevision:params.expectedRevision,document:params.document})).digest('hex');
 studio.db.exec('CREATE TABLE IF NOT EXISTS email_native_mutations(operation TEXT PRIMARY KEY,fingerprint TEXT,state TEXT,result TEXT);');
 const old=studio.transaction(()=>{const row=studio.db.prepare('SELECT * FROM email_native_mutations WHERE operation=?').get(params.nativeOperationId);if(row){if(row.fingerprint!==fingerprint)throw Error('409 native draft collision');if(row.state!=='COMPLETED')throw Error('409 native draft uncertain no retry');return JSON.parse(row.result);}studio.db.prepare("INSERT INTO email_native_mutations VALUES(?,?,'INTENT',NULL)").run(params.nativeOperationId,fingerprint);return null;});
 if(old){studio.get(ctx,old.id,old.revision);return old;}
 try{const saved=params.expectedRevision===0?studio.create(ctx,params.document):studio.save(ctx,resourceId,params.expectedRevision,params.document);const result={id:saved.id,companyId:saved.companyId,revision:saved.revision};studio.db.prepare("UPDATE email_native_mutations SET state='COMPLETED',result=? WHERE operation=?").run(JSON.stringify(result),params.nativeOperationId);return result;}
 catch(error){studio.db.prepare("UPDATE email_native_mutations SET state='UNKNOWN' WHERE operation=? AND state='INTENT'").run(params.nativeOperationId);throw error;}
}
