import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {persistNewInstanceConfig,validateFirstRunStatus} from './product-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(){mkdirSync(join(root,'work'),{recursive:true});return join(mkdtempSync(join(root,'work/instance-config-')),'product.json');}
test('fresh and initialized first-run phases require explicit server authority',()=>{
 for(const setupRequired of [true,false]) assert.deepEqual(validateFirstRunStatus({setupRequired,singleCompany:true,registrationAllowed:false}),{setupRequired,singleCompany:true,registrationAllowed:false});
 for(const bad of [null,{}, {detail:'unauthorized'}, {setupRequired:true}, {setupRequired:false,singleCompany:true,registrationAllowed:true},{setupRequired:'false',singleCompany:true,registrationAllowed:false}]) assert.throws(()=>validateFirstRunStatus(bad),/unavailable or invalid/);
});
test('fresh start persists only caller paths/ports without account defaults',()=>{
 const path=fixture();const config={schema:'starli.product-install.v1',state:'work/new',frontendPort:5186,backendPort:8080};
 assert.equal(persistNewInstanceConfig(path,config),true);assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),config);
 assert.ok(!/password|admin|secret|session.key/.test(readFileSync(path,'utf8')));
});
test('existing instance metadata is byte-preserved on repeated start/setup',()=>{
 const path=fixture();const original='{"schema":"starli.product-install.v1","state":"work/existing","frontendPort":5186,"backendPort":8080}\n';writeFileSync(path,original);
 assert.equal(persistNewInstanceConfig(path,{state:'work/replacement'}),false);assert.equal(readFileSync(path,'utf8'),original);
});
test('concurrent first starts have one exclusive config creator and preserve its state',async()=>{
 const path=fixture();const helper=pathToFileURL(join(root,'installer/product-config.mjs')).href;
 const values=[{state:'work/first',frontendPort:5186,backendPort:8080},{state:'work/second',frontendPort:5187,backendPort:8081}];
 function launch(value){return new Promise((resolve,reject)=>{
  const code=`import {persistNewInstanceConfig} from ${JSON.stringify(helper)};console.log(JSON.stringify({won:persistNewInstanceConfig(${JSON.stringify(path)},${JSON.stringify(value)}),state:${JSON.stringify(value.state)}}));`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true});let output='';let error='';
  child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);child.once('error',reject);child.once('exit',status=>status===0?resolve(JSON.parse(output)):reject(Error(error)));
 });}
 const results=await Promise.all(values.map(launch));assert.equal(results.filter(r=>r.won).length,1);
 assert.equal(JSON.parse(readFileSync(path,'utf8')).state,results.find(r=>r.won).state);
});
