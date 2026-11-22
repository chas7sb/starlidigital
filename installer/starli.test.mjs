import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('./starli.mjs',import.meta.url));
const product=fileURLToPath(new URL('./product.mjs',import.meta.url));
function invoke(file,...args){return spawnSync(process.execPath,[file,...args],{encoding:'utf8',windowsHide:true,timeout:5000});}
for(const action of ['install','setup','start','build','doctor','health']) test(`default ${action} selects only new product entrypoint`,()=>{
 const r=invoke(cli,action,'--dry-run');assert.equal(r.status,0,r.stderr);
 const p=JSON.parse(r.stdout);assert.equal(p.args[0],product);assert.equal(p.args[1],action);
 assert.ok(!p.args.some(a=>a.includes('onboarding/first_run')||a.includes('native.mjs')));
});
test('new product start plan joins exact new backend and product Vite preview',()=>{
 const r=invoke(product,'start','--dry-run');assert.equal(r.status,0,r.stderr);
 const plans=r.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));assert.equal(plans.length,2);
 assert.match(plans[0].args[0],/product-backend[\\/]local_server\.py$/);assert.ok(plans[0].args.includes('serve'));
 assert.match(plans[1].args[0],/product[\\/]node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/);assert.ok(plans[1].args.includes('--strictPort'));
});
test('legacy Docker launch remains blocked',()=>{const r=invoke(cli,'start','--docker','--dry-run');assert.equal(r.status,1);assert.match(r.stderr,/not yet adapted/);assert.equal(r.stdout,'');});
test('Docker diagnostics remain explicit',()=>{const r=invoke(cli,'status','--docker','--dry-run');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).command,'docker');});
test('conflicting modes fail before any process plan',()=>{const r=invoke(cli,'install','--native','--docker','--dry-run');assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/conflicting/);});
test('help identifies new product and meaningful readiness',()=>{const r=invoke(cli,'--help');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/New bots\/teams\/Boss product/);assert.match(r.stdout,/Ctrl\+C stops foreground services/);assert.match(r.stdout,/Model\/provider\/worker readiness is reported separately/);});
test('default flow starts browser first-run and describes CLI setup as optional',()=>{
 const r=invoke(cli,'--help');assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/node installer\/starli\.mjs install\nnode installer\/starli\.mjs start/);
 assert.match(r.stdout,/first-run administrator\/company setup in your browser without creating default credentials/);
 assert.match(r.stdout,/CLI setup is an optional privileged alternative/);
});
