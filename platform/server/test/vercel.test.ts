import test from 'node:test';
import assert from 'node:assert/strict';
import { deployStaticSite, deployNextSite, getDeployment, vercelConfigured } from '../src/integrations/vercel.js';
import { makeNextProjectFiles } from '../src/site-builder.js';

const document = `<!doctype html><html lang="ro"><head><title>Exemplu</title></head><body><main>${'Conținut românesc pentru un website. '.repeat(30)}</main></body></html>`;

test('Vercel adapter refuses missing credentials without a network call', async () => {
  const oldToken = process.env.VERCEL_TOKEN;
  const oldFetch = globalThis.fetch;
  delete process.env.VERCEL_TOKEN;
  globalThis.fetch = (() => { throw new Error('Unexpected network'); }) as typeof fetch;
  try {
    assert.equal(vercelConfigured(), false);
    await assert.rejects(deployStaticSite({name:'starli-test',html:document}), /nu este conectată/);
  } finally { globalThis.fetch = oldFetch; if (oldToken === undefined) delete process.env.VERCEL_TOKEN; else process.env.VERCEL_TOKEN = oldToken; }
});

test('Vercel sends validated inline UTF-8 files and treats acceptance as BUILDING', async () => {
  const oldToken = process.env.VERCEL_TOKEN, oldTeam = process.env.VERCEL_TEAM_ID, oldFetch = globalThis.fetch;
  process.env.VERCEL_TOKEN='unit-test-token'; process.env.VERCEL_TEAM_ID='team_test';
  globalThis.fetch = (async (url, options) => {
    assert.equal(String(url), 'https://api.vercel.com/v13/deployments?teamId=team_test');
    assert.equal(options?.method, 'POST');
    const body=JSON.parse(String(options?.body));
    assert.equal(body.name,'starli-test'); assert.equal(body.target,'production'); assert.equal(body.files[0].file,'index.html');
    assert.equal(body.files[0].encoding,'base64');
    const html=Buffer.from(body.files[0].data,'base64').toString('utf8');
    assert.match(html,/Conținut românesc/); assert.match(html,/Content-Security-Policy/);
    assert.equal(body.projectSettings.framework,null);
    return new Response(JSON.stringify({id:'dpl_test123',url:'starli-test.vercel.app',readyState:'QUEUED'}));
  }) as typeof fetch;
  try { assert.deepEqual(await deployStaticSite({name:'starli-test',html:document}),{id:'dpl_test123',url:'https://starli-test.vercel.app',status:'BUILDING'}); }
  finally { globalThis.fetch=oldFetch; if(oldToken===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=oldToken;if(oldTeam===undefined)delete process.env.VERCEL_TEAM_ID;else process.env.VERCEL_TEAM_ID=oldTeam; }
});

test('Vercel polling distinguishes READY from errors and rejects untrusted URLs', async () => {
  const oldToken=process.env.VERCEL_TOKEN,oldFetch=globalThis.fetch; process.env.VERCEL_TOKEN='unit-test-token';
  let state='READY',url='starli-test.vercel.app';
  globalThis.fetch=(async()=>new Response(JSON.stringify({uid:'dpl_test123',url,state}))) as typeof fetch;
  try {
    assert.equal((await getDeployment('dpl_test123')).status,'READY');
    state='ERROR';assert.equal((await getDeployment('dpl_test123')).status,'ERROR');
    state='CANCELED';assert.equal((await getDeployment('dpl_test123')).status,'ERROR');
    state='unknown';await assert.rejects(getDeployment('dpl_test123'),/nu este recunoscută/);
    state='READY';url='attacker.example';await assert.rejects(getDeployment('dpl_test123'),/neașteptată/);
    await assert.rejects(getDeployment('../projects'),/invalid/);
    await assert.rejects(deployStaticSite({name:'bad/project',html:document}),/Numele proiectului/);
    await assert.rejects(deployStaticSite({name:'starli-test',html:document.replace('</body>','<script>alert(1)</script></body>')}),/active/);
  } finally {globalThis.fetch=oldFetch;if(oldToken===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=oldToken;}
});

test('Vercel errors do not leak provider bodies', async () => {
  const oldToken=process.env.VERCEL_TOKEN,oldFetch=globalThis.fetch;process.env.VERCEL_TOKEN='unit-test-token';
  globalThis.fetch=(async()=>new Response('sensitive-account-metadata',{status:403})) as typeof fetch;
  try {await assert.rejects(getDeployment('dpl_test123'),e=>e instanceof Error&&e.message.includes('403')&&!e.message.includes('sensitive'));}
  finally {globalThis.fetch=oldFetch;if(oldToken===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=oldToken;}
});

test('Next deployments reject unsafe paths and package lifecycle scripts before networking', async () => {
  const fixedPackage={name:'starli-generated',version:'1.0.0',private:true,scripts:{dev:'next dev',build:'next build',start:'next start'},dependencies:{next:'16.4.3',react:'19.3.1','react-dom':'19.3.1'},devDependencies:{'@types/node':'24.10.0','@types/react':'19.1.6','@types/react-dom':'19.1.6',typescript:'5.9.3'}};
  const files=['app/page.tsx','app/globals.css','app/layout.tsx','package.json','tsconfig.json','next-env.d.ts','next.config.ts'].map(path=>({path,content:path==='package.json'?JSON.stringify(fixedPackage):'placeholder'}));
  const oldFetch=globalThis.fetch;globalThis.fetch=(()=>{throw new Error('Unexpected network');}) as typeof fetch;
  try {
    await assert.rejects(deployNextSite({name:'starli-test',files:[...files.slice(0,6),{path:'../secret',content:'value'}]}),/nepermis/);
    await assert.rejects(deployNextSite({name:'starli-test',files:files.map(file=>file.path==='package.json'?{...file,content:JSON.stringify({...fixedPackage,scripts:{...fixedPackage.scripts,postinstall:'curl attacker'}})}:file)}),/scripturi nepermise/);
    await assert.rejects(deployNextSite({name:'starli-test',files:files.map(file=>file.path==='package.json'?{...file,content:JSON.stringify({...fixedPackage,dependencies:{...fixedPackage.dependencies,next:'https://attacker.example/next.tgz'}})}:file)}),/versiuni fixe/);
    await assert.rejects(deployNextSite({name:'starli-test',files:files.map(file=>file.path==='package.json'?{...file,content:JSON.stringify({...fixedPackage,dependencies:{...fixedPackage.dependencies,next:'16.0.0'}})}:file)}),/șablonului aprobat/);
  } finally {globalThis.fetch=oldFetch;}
});

test('Next deployment uploads trusted React TypeScript sources with the Next.js preset', async () => {
  const files=makeNextProjectFiles({page:'export default function Home(){ return <main><h1>Un studio în Brașov</h1><p>Arhitectură pentru locuințe și spații de lucru.</p></main>; }',css:'body{margin:0;color:#111;background:#fff;font-family:Arial,sans-serif}',title:'Studio Brașov',description:'Arhitectură în Brașov'});
  const oldToken=process.env.VERCEL_TOKEN,oldFetch=globalThis.fetch;
  process.env.VERCEL_TOKEN='unit-test-token';
  globalThis.fetch=(async(_url,options)=>{
    const body=JSON.parse(String(options?.body));
    assert.deepEqual(body.projectSettings,{framework:'nextjs'});
    assert.deepEqual(body.meta,{starliRequestId:'test-request'});
    assert.equal(body.files.length,7);assert.equal(body.files.some((file:any)=>file.file==='index.html'),false);
    const page=body.files.find((file:any)=>file.file==='app/page.tsx');
    assert.equal(page.encoding,'base64');assert.match(Buffer.from(page.data,'base64').toString('utf8'),/export default function Home/);
    const pkg=body.files.find((file:any)=>file.file==='package.json');
    assert.equal(JSON.parse(Buffer.from(pkg.data,'base64').toString('utf8')).scripts.build,'next build');
    return new Response(JSON.stringify({id:'dpl_next123',url:'starli-next.vercel.app',readyState:'BUILDING'}));
  }) as typeof fetch;
  try {assert.equal((await deployNextSite({name:'starli-next',files,requestId:'test-request'})).status,'BUILDING');}
  finally {globalThis.fetch=oldFetch;if(oldToken===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=oldToken;}
});

test('Next deployment forwards controlled PNG bytes without double encoding', async () => {
  const files=makeNextProjectFiles({page:'export default function Home(){ return <main><h1>Un studio în Brașov</h1><p>Arhitectură pentru locuințe și spații de lucru.</p></main>; }',css:'body{margin:0;color:#111;background:#fff}',title:'Studio Brașov',description:'Arhitectură în Brașov'});
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l6kAAAAASUVORK5CYII=';
  const withImage=[...files,{path:'public/assets/hero.png',content:png,encoding:'base64' as const}];
  const oldToken=process.env.VERCEL_TOKEN,oldFetch=globalThis.fetch;
  process.env.VERCEL_TOKEN='unit-test-token';
  globalThis.fetch=(async(_url,options)=>{
    const body=JSON.parse(String(options?.body));
    const image=body.files.find((file:any)=>file.file==='public/assets/hero.png');
    assert.equal(image.data,png);assert.equal(image.encoding,'base64');
    return new Response(JSON.stringify({id:'dpl_next123',url:'starli-next.vercel.app',readyState:'BUILDING'}));
  }) as typeof fetch;
  try {
    assert.equal((await deployNextSite({name:'starli-next',files:withImage})).status,'BUILDING');
    await assert.rejects(deployNextSite({name:'starli-next',files:[...files,{path:'public/assets/hero.png',content:Buffer.from('not png').toString('base64'),encoding:'base64'}]}),/PNG/);
  } finally {globalThis.fetch=oldFetch;if(oldToken===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=oldToken;}
});
