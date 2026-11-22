import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const text=readFileSync(0,'utf8');if(Buffer.byteLength(text)>16384)throw Error('WORKER_INPUT_TOO_LARGE');
const job=JSON.parse(text);
if(!['FRONTEND','BACKEND'].includes(job.kind))throw Error('INVALID_WORKER_KIND');
for(const k of ['companyId','projectId','requestId','graphId','workPackageId','botId','roomId'])if(typeof job[k]!=='string'||!job[k])throw Error('MISSING_SCOPE:'+k);
const frontend=[
 {path:'frontend/App.jsx',content:`import React, {useEffect,useState} from 'react';
export default function DogLove({api}) {
 const [pets,setPets]=useState([]),[name,setName]=useState(''),[error,setError]=useState('');
 const load=()=>api.list().then(setPets).catch(e=>setError(e.message));
 useEffect(()=>{load()},[]);
 async function save(e){e.preventDefault();try{await api.create({name});setName('');await load()}catch(e){setError(e.message)}}
 return <main><h1>DogLove</h1><form onSubmit={save}><label>Dog name<input aria-label="Dog name" value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/></label><button>Save dog</button></form>{error&&<p role="alert">{error}</p>}<ul>{pets.map(p=><li key={p.id}>{p.name}</li>)}</ul></main>
}
`},
 {path:'frontend/api.mjs',content:`export function createDogLoveApi({baseUrl,csrf}) {
 async function request(path,options={}){const res=await fetch(baseUrl+path,{credentials:'include',...options});if(!res.ok)throw Error('DogLove request failed: '+res.status);return res.json()}
 return {list:()=>request('/api/pets'),create:pet=>request('/api/pets',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(pet)})};
}
`}
];
const backend=[
 {path:'backend/pets.mjs',content:`import {randomUUID} from 'node:crypto';
export function createPetRepository(db) {
 db.exec('CREATE TABLE IF NOT EXISTS doglove_pets (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL)');
 return {list(companyId){return db.prepare('SELECT id,name,created_at AS createdAt FROM doglove_pets WHERE company_id=? ORDER BY created_at,id').all(companyId)},create(companyId,input){const name=String(input?.name||'').trim();if(!name||name.length>80)throw Error('Invalid dog name');const row={id:randomUUID(),name,createdAt:new Date().toISOString()};db.prepare('INSERT INTO doglove_pets VALUES(?,?,?,?)').run(row.id,companyId,row.name,row.createdAt);return row}};
}
`},
 {path:'backend/route.mjs',content:`// Host must authenticate each request, check current authority and CSRF before admission.
// authorizeAndCommit must fence revocation against the repository transaction.
export function createPetRoutes({repository,authorizeRead,authorizeAndCommit}) {
 return {async list(req){const scope=await authorizeRead(req);return repository.list(scope.companyId)},async create(req,body){return authorizeAndCommit(req,scope=>repository.create(scope.companyId,body))}};
}
`}
];
if(job.holdMs!==undefined){if(!Number.isSafeInteger(job.holdMs)||job.holdMs<0||job.holdMs>5000)throw Error('INVALID_WORKER_HOLD');await new Promise(r=>setTimeout(r,job.holdMs));}
const files=job.kind==='FRONTEND'?frontend:backend;
const result={provider:'DETERMINISTIC_LOCAL',modelCalls:0,scope:Object.fromEntries(['companyId','projectId','requestId','graphId','workPackageId'].map(k=>[k,job[k]])),worker:{botId:job.botId,roomId:job.roomId,kind:job.kind,pid:process.pid},objectiveDigest:createHash('sha256').update(job.objective).digest('hex'),files};
process.stdout.write(JSON.stringify(result));
