import {config} from 'dotenv';config({path:'.env',quiet:true});
if(!process.env.RESEND_API_KEY)throw new Error('Resend credential missing');
const response=await fetch('https://api.resend.com/domains',{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`},signal:AbortSignal.timeout(20000)});
let data;try{data=await response.json();}catch{}
console.log(JSON.stringify({http:response.status,credentialAccepted:response.ok,domain:response.ok?(data.data||[]).filter(d=>d.name==='starlidigital.ro'||d.name.endsWith('.starlidigital.ro')).map(d=>({id:d.id,name:d.name,status:d.status})):[],reason:response.ok?undefined:typeof data?.name==='string'?data.name:'provider_error'}));
