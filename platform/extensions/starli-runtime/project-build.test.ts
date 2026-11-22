import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
function compile(files:any[]){
 const result=spawnSync('/opt/starlidigital/node/bin/node',['--max-old-space-size=384','--import','tsx','project-build.mts'],{cwd:fileURLToPath(new URL('.',import.meta.url)),input:JSON.stringify({files,name:'Synthetic compiler fixture'})+'\n',encoding:'utf8',maxBuffer:8*1024*1024,timeout:35000,env:{PATH:process.env.PATH,HOME:'/tmp',LANG:'C.UTF-8'}});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim().split('\n').at(-1)!);
}
test('React/Next source really compiles into an interactive browser bundle',()=>{
 const result=compile([{path:'app/page.tsx',content:'import {useState} from "react";export default function Page(){const [count,setCount]=useState(0);return <button onClick={()=>setCount(count+1)}>Count {count}</button>}'}]);
 assert.equal(result.ok,true);assert.equal(result.framework,'NEXT_BROWSER_PREVIEW');assert.match(result.html,/Count/);assert.match(result.html,/connect-src &#39;none&#39;|connect-src 'none'/);assert.match(result.html,/react/);
});
test('syntax errors return diagnostics instead of stale HTML',()=>{
 const result=compile([{path:'index.html',content:'<html><head></head><body><script>const broken = ;</script></body></html>'}]);
 assert.equal(result.ok,false);assert.ok(result.diagnostics.length>0);assert.equal(result.html,undefined);
});
test('absolute inline imports cannot read host files',()=>{
 const result=compile([{path:'index.html',content:'<html><head></head><body><script type="module">import secret from "/etc/passwd";console.log(secret)</script></body></html>'}]);
 assert.equal(result.ok,false);assert.match(result.diagnostics[0].message,/Project file not found/);
});
test('Node server modules cannot run in preview',()=>{
 const result=compile([{path:'app/page.tsx',content:'import fs from "node:fs";export default function Page(){return <p>{fs.readFileSync("/etc/passwd","utf8")}</p>}'}]);
 assert.equal(result.ok,false);assert.match(result.diagnostics.map(d=>d.message).join(' '),/isolated backend runtime/);
});
test('HTML local assets and scripts compile from the actual snapshot',()=>{
 const result=compile([{path:'index.html',content:'<html><head><link rel="stylesheet" href="style.css"></head><body><h1>Fixture</h1><script src="main.js"></script></body></html>'},{path:'style.css',content:'h1{color:rebeccapurple}'},{path:'main.js',content:'document.querySelector("h1").textContent="Actual source";'}]);
 assert.equal(result.ok,true);assert.match(result.html,/rebeccapurple/);assert.match(result.html,/Actual source/);
});
