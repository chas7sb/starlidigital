import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeNextProjectFiles,validateNextProjectFiles} from '../src/next-template.js';
const fixture=()=>makeNextProjectFiles({page:'export default function Page(){return <main><h1>Atelierul nostru</h1><p>Obiecte ceramice lucrate manual pentru momente speciale.</p></main>}',css:'body{margin:0;background:#fff8f0;color:#332211}',title:'Atelier',description:'Ceramică artizanală'});
test('generated customer artifact is a complete Next React TypeScript project',()=>{const files=fixture();assert.equal(files.length,7);assert.ok(files.some(f=>f.path==='app/page.tsx'));assert.equal(JSON.parse(files.find(f=>f.path==='package.json')!.content).dependencies.next,'16.4.3');validateNextProjectFiles(files);});
test('Next source rejects path traversal, injected lifecycle scripts and arbitrary imports',()=>{
 const paths=fixture();paths[0].path='../secret';assert.throws(()=>validateNextProjectFiles(paths));
 const scripts=fixture();const p=scripts.find(f=>f.path==='package.json')!;const pkg=JSON.parse(p.content);pkg.scripts.postinstall='bad';p.content=JSON.stringify(pkg);assert.throws(()=>validateNextProjectFiles(scripts));
 assert.throws(()=>makeNextProjectFiles({page:"import fs from 'node:fs'; export default function Page(){return <main>{fs.readFileSync('/etc/passwd','utf8')}</main>}",css:'body{}',title:'Test',description:'Test'}));
});
test('Next syntax validation does not claim production compilation',()=>{const files=fixture();assert.ok(files.find(f=>f.path==='next.config.ts')!.content.includes("output:'export'"));assert.throws(()=>makeNextProjectFiles({page:'export default function Page(){ return <main>}',css:'body{}',title:'x',description:'x'}));});
test('interactive React components receive the required Next client boundary',()=>{const files=makeNextProjectFiles({page:'export default function Page(){return <main><h1>Atelier</h1><button onClick={()=>{}}>Deschide meniul</button></main>}',css:'body{margin:0}',title:'Atelier',description:'Atelier creativ'});assert.ok(files[0].content.startsWith("'use client';"));});

test('new exports use root assets on nested routes and retain validation for existing projects',()=>{
 const files=fixture(),config=files.find(f=>f.path==='next.config.ts')!;
 assert.doesNotMatch(config.content,/assetPrefix/);
 config.content=config.content.replace('trailingSlash:true,','trailingSlash:true,assetPrefix:\'./\',');
 validateNextProjectFiles(files);
});
