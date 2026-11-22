import {config} from 'dotenv';import {Store} from '../server/src/store.ts';import {hashToken} from '../server/src/security.ts';
config({path:'.env',quiet:true});
const response=await fetch(`http://127.0.0.1:${process.env.PORT||4100}/graphql`,{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(process.env.PUBLIC_APP_URL).origin},body:JSON.stringify({query:'mutation($username:String!,$password:String!){login(username:$username,password:$password){role}}',variables:{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD}})});
const login=await response.json();if(login.errors||login.data?.login.role!=='ADMIN')throw new Error('Autentificarea administratorului nu a trecut verificarea.');
const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
try{
 const result=await fetch(`http://127.0.0.1:${process.env.PORT||4100}/graphql`,{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(process.env.PUBLIC_APP_URL).origin,Cookie:cookie},body:JSON.stringify({query:'{adminOverview{users projects conversations publishedPosts} settings{autoBlogEnabled blogHour} projects{id validationStatus validationProvider files{path encoding}} adminAudit{id}}'})});
 const data=await result.json();if(data.errors)throw new Error('Query administrativ invalid.');
 const demo=data.data.projects.find(p=>p.id==='qa-next-lut-lumina');if(!demo||demo.validationStatus!=='PASSED'||demo.files.filter(f=>f.encoding==='base64').length!==2)throw new Error('Proiectul Next.js cu imagini nu este disponibil corect.');
 console.log(JSON.stringify({adminLogin:'PASS',overview:data.data.adminOverview,dailyBlog:data.data.settings,demo:{files:demo.files.length,validation:demo.validationStatus,provider:demo.validationProvider},auditAvailable:true}));
}finally{
 const token=cookie.match(/starli_session=([^;]+)/)?.[1];if(token){const store=new Store();try{store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));}finally{store.close();}}
}
