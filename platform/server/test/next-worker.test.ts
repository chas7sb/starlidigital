import test from 'node:test';
import assert from 'node:assert/strict';
import {dockerBuildArguments,verifyNextProject} from '../src/next-worker.js';
import {makeNextProjectFiles} from '../src/next-template.js';

test('generated Next runtime has explicit isolation and only bounded mounts',()=>{
  const args=dockerBuildArguments('C:/tmp/source','C:/tmp/export','starli-next-test','approved-worker:tag');
  for(const option of ['--read-only','--network','none','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','2','--memory','2g','--memory-swap','--pids-limit','256'])assert.ok(args.includes(option));
  assert.ok(args.includes('type=bind,source=C:/tmp/source,target=/source,readonly'));
  assert.equal(args.filter(arg=>arg==='--mount').length,2);
  assert.equal(args.at(-1),'approved-worker:tag');
  assert.ok(args.includes('/work:rw,exec,nosuid,nodev,size=1073741824,uid=1000,gid=1000,mode=0700'));
  assert.equal(args.some(arg=>arg.includes('docker.sock')),false);
  assert.equal(args.some(arg=>arg.includes('OPENAI')),false);
  assert.equal(args.includes('--privileged'),false);
});

test('disabled worker fails explicitly before any Docker command',async()=>{
  const previous=process.env.NEXT_WORKER_ENABLED;delete process.env.NEXT_WORKER_ENABLED;
  try{await assert.rejects(verifyNextProject([]),/nu este activat/);}
  finally{if(previous===undefined)delete process.env.NEXT_WORKER_ENABLED;else process.env.NEXT_WORKER_ENABLED=previous;}
});

test('real isolated Docker build renders a Next source project and rejects a type failure',{skip:process.env.RUN_DOCKER_WORKER_TESTS!=='true',timeout:250000},async()=>{
  const oldEnabled=process.env.NEXT_WORKER_ENABLED;process.env.NEXT_WORKER_ENABLED='true';
  const source={page:'export default function Home(){return <main><h1>Verificare Next.js reală</h1><p>Un proiect React și TypeScript compilat în worker.</p></main>;}',css:'body{background:#f5f5f5;color:#101010;font-family:Arial,sans-serif}',title:'Verificare Next',description:'Verificare de integrare reală pentru workerul izolat.'};
  try{
    const result=await verifyNextProject(makeNextProjectFiles(source));
    assert.equal(result.validationProvider,'DOCKER');assert.equal(result.validationStatus,'PASSED');
    assert.match(result.previewHtml,/Verificare Next\.js reală/);assert.match(result.previewHtml,/background/);assert.match(result.previewHtml,/script-src 'none'/);
    assert.doesNotMatch(result.previewHtml,/<script\b/i);
    assert.match(result.buildLog,/STARLI_NEXT_BUILD_VERIFIED/);
    const bad=makeNextProjectFiles({...source,page:'const value:string=42; export default function Home(){return <main><h1>Proiect cu eroare de tip</h1><p>{value}</p></main>;}'});
    await assert.rejects(verifyNextProject(bad),/Verificarea Next.js a eșuat/);
  }finally{if(oldEnabled===undefined)delete process.env.NEXT_WORKER_ENABLED;else process.env.NEXT_WORKER_ENABLED=oldEnabled;}
});

test('real compiled snapshot embeds PNG references in JSX and compiled CSS',{skip:process.env.RUN_DOCKER_IMAGE_TESTS!=='true',timeout:200000},async()=>{
  const oldEnabled=process.env.NEXT_WORKER_ENABLED;process.env.NEXT_WORKER_ENABLED='true';
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l6kAAAAASUVORK5CYII=';
  const files=makeNextProjectFiles({page:'export default function Home(){return <main><h1>Imagine de brand</h1><img src="assets/hero.png" alt="Imagine generată pentru afacere"/><p>Previzualizare compilată cu imagine reală.</p></main>;}',css:'body{font-family:Arial;background-image:url("/assets/hero.png")}',title:'Imagine de brand',description:'Verificare imagine în preview.'});
  files.push({path:'public/assets/hero.png',content:png,encoding:'base64'});
  try{const result=await verifyNextProject(files);assert.match(result.previewHtml,/data:image\/png;base64,iVBOR/);assert.doesNotMatch(result.previewHtml,/src="assets\/hero.png"/);assert.doesNotMatch(result.previewHtml,/url\(["']?\/assets\/hero.png/);assert.equal(result.validationStatus,'PASSED');}
  finally{if(oldEnabled===undefined)delete process.env.NEXT_WORKER_ENABLED;else process.env.NEXT_WORKER_ENABLED=oldEnabled;}
});
