import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNextSite} from '../src/site-builder.js';

test('OpenAI generation permits secondary pages and repairs only missing pages with a page schema',async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.OPENAI_API_KEY;
 process.env.OPENAI_API_KEY='test-key';let requests=0;
 const page=(name:string)=>`export default function Page(){return <main><h1>${name}</h1><p>Informații și contact pentru afacere.</p></main>}`;
 try{
  globalThis.fetch=async(_url,init)=>{
   const body=JSON.parse(String(init?.body));requests++;
   if(requests===1){assert.ok(body.text.format.schema.properties.extraFiles);assert.ok(body.text.format.schema.required.includes('extraFiles'));}
   else{assert.deepEqual(body.text.format.schema.required,['files']);assert.deepEqual(body.text.format.schema.properties.files.items.properties.path.enum,['app/contact/page.tsx']);assert.ok(!body.text.format.schema.properties.title);}
   const data=requests===1?{page:page('Mondo'),css:'body{color:#152525;background:#fff;font-family:Arial}',title:'Mondo Instal',description:'Instalații în Brașov',extraFiles:[{path:'app/despre/page.tsx',content:page('Despre')},{path:'app/servicii/page.tsx',content:page('Servicii')}]}:{files:[{path:'app/contact/page.tsx',content:page('Contact')}]};
   return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const result=await buildNextSite('Instalații în Brașov','Mondo Instal',{provider:'OPENAI',assets:[],existingResearch:{summary:'Date furnizate',sources:[]},requiredPages:['app/page.tsx','app/despre/page.tsx','app/servicii/page.tsx','app/contact/page.tsx']});
  assert.equal(requests,2);for(const path of ['app/page.tsx','app/despre/page.tsx','app/servicii/page.tsx','app/contact/page.tsx'])assert.ok(result.files.some(file=>file.path===path));
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}
});

test('invalid generated source is repaired and revalidated without regenerating images or discarding other pages',async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-key';let requests=0;
 const valid='export default function Home(){return <main><h1>Mondo Instal</h1><p>Instalații și contact în Brașov.</p></main>}';
 try{
  globalThis.fetch=async(_url,init)=>{requests++;const body=JSON.parse(String(init?.body));
   if(requests===2){assert.match(body.input[0].content,/process/);assert.deepEqual(body.text.format.schema.required,['files']);}
   const data=requests===1?{page:valid.replace('return <main>','const process = []; return <main>'),css:'body{color:#152525;background:#fff}',title:'Mondo Instal',description:'Instalații Brașov',extraFiles:[]}:{files:[{path:'app/page.tsx',content:valid}]};
   return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}]}),{status:200});};
  const result=await buildNextSite('Instalații','Mondo Instal',{provider:'OPENAI',assets:[],existingResearch:{summary:'Date furnizate',sources:[]}});
  assert.equal(requests,2);assert.equal(result.files.find(file=>file.path==='app/page.tsx')?.content,valid);
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}
});
