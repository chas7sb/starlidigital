import {config} from 'dotenv';import {Store} from '../server/src/store.ts';import {hashToken} from '../server/src/security.ts';
config({path:'.env',quiet:true});const url=`http://127.0.0.1:${process.env.PORT||4100}/graphql`;let cookie='';
async function query(query,variables={}){const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(process.env.PUBLIC_APP_URL).origin,Cookie:cookie},body:JSON.stringify({query,variables})});if(res.headers.getSetCookie().length)cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');const body=await res.json();if(body.errors)throw new Error(body.errors[0].message);return body.data;}
try{
 await query('mutation($username:String!,$password:String!){login(username:$username,password:$password){role}}',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD});
 await query('mutation{verifyProject(id:"qa-next-lut-lumina"){status}}');
 let project;for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,2000));const data=await query('{projects{id status validationStatus validationProvider buildError}}');project=data.projects.find(p=>p.id==='qa-next-lut-lumina');if(project.status!=='VERIFYING')break;}
 if(project?.validationStatus!=='PASSED')throw new Error(project?.buildError||'Verificarea workerului din serviciu nu s-a finalizat.');
 console.log(JSON.stringify({scheduledTaskWorker:'PASS',project:project.id,provider:project.validationProvider,status:project.status}));
}finally{const token=cookie.match(/starli_session=([^;]+)/)?.[1];if(token){const store=new Store();try{store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));}finally{store.close();}}}
