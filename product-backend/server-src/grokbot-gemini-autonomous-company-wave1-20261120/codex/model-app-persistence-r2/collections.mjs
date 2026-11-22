import {randomUUID} from 'node:crypto';
import {validateAppSchema,validateRecord} from './schema.mjs';
const err=(code,status=422)=>{throw Object.assign(Error(code),{status})};
export function createCollectionRoutes({db,schema,routes,scope,authorizeRead,authorizeAndCommit}){
 validateAppSchema(schema,routes);
 if(!scope?.companyId||!scope?.projectId||typeof authorizeRead!=='function'||typeof authorizeAndCommit!=='function')err('TRUSTED_SCOPE_REQUIRED',503);
 db.exec("CREATE TABLE IF NOT EXISTS app_records(company_id TEXT NOT NULL,project_id TEXT NOT NULL,collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,PRIMARY KEY(company_id,project_id,collection,id))");
 const owner=[scope.companyId,scope.projectId];
 const item=row=>({id:row.id,...JSON.parse(row.data),_revision:row.revision});
 function collection(name){const c=schema.collections.find(x=>x.name===name);if(!c)err('COLLECTION_NOT_FOUND',404);return c}
 async function body(req){
  if(!String(req.headers['content-type']||'').startsWith('application/json'))err('JSON_REQUIRED',415);
  let value='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)err('BODY_TOO_LARGE',413);value+=chunk}
  try{return JSON.parse(value)}catch{err('BAD_JSON',400)}
 }
 return {async handle(req){
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname==='/api/app/schema'){if(req.method!=='GET')err('METHOD_NOT_ALLOWED',405);await authorizeRead(req);return {status:200,body:schema}}
  const match=/^\/api\/app\/([a-z][a-z0-9_]{0,39})(?:\/([a-f0-9-]{36}))?$/.exec(pathname);
  if(!match)err('APP_ROUTE_NOT_FOUND',404);const [,name,id]=match;collection(name);
  if(req.method==='GET'&&!id){await authorizeRead(req);return {status:200,body:{items:db.prepare('SELECT id,data,revision FROM app_records WHERE company_id=? AND project_id=? AND collection=? ORDER BY created_ms,id LIMIT 200').all(...owner,name).map(item)}}}
  if(!['POST','PATCH','DELETE'].includes(req.method)||req.method==='POST'&&id||req.method!=='POST'&&!id)err('METHOD_NOT_ALLOWED',405);
  const payload=req.method==='DELETE'?null:validateRecord(schema,name,await body(req));
  return await authorizeAndCommit(req,()=>{
   const old=id?db.prepare('SELECT id,data,revision FROM app_records WHERE company_id=? AND project_id=? AND collection=? AND id=?').get(...owner,name,id):null;
   if(id&&!old)err('RECORD_NOT_FOUND',404);
   if(req.method==='DELETE'){db.prepare('DELETE FROM app_records WHERE company_id=? AND project_id=? AND collection=? AND id=?').run(...owner,name,id);return {status:200,body:{deleted:true,id}}}
   const now=Date.now();
   if(req.method==='PATCH'){db.prepare('UPDATE app_records SET data=?,revision=revision+1,updated_ms=? WHERE company_id=? AND project_id=? AND collection=? AND id=?').run(JSON.stringify(payload),now,...owner,name,id);return {status:200,body:{id,...payload,_revision:old.revision+1}}}
   if(Number(db.prepare('SELECT count(*) n FROM app_records WHERE company_id=? AND project_id=?').get(...owner).n)>=1000)err('RECORD_QUOTA_EXCEEDED',429);
   const created=randomUUID();db.prepare('INSERT INTO app_records VALUES(?,?,?,?,?,1,?,?)').run(...owner,name,created,JSON.stringify(payload),now,now);return {status:201,body:{id:created,...payload,_revision:1}}
  });
 }};
}
