import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {cacheVerifiedNodeArchive,extractCheckedNodeArchive} from './node-archive.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const action of ['install','install-backend','install-frontend','build','start','doctor','health']) for(const target of ['dashboard','all']) test(`retired ${action} ${target} refuses before source checks or mutations`,()=>{
 const r=spawnSync(process.execPath,[join(root,'installer/native.mjs'),action,target],{encoding:'utf8',windowsHide:true,timeout:5000,env:{...process.env,STARLI_NODE24:join(root,'work/must-not-execute'),STARLI_NODE22:join(root,'work/must-not-execute')}});
 assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/Legacy dashboard\/all native targets are retired/);
});
const zip=Buffer.from('UEsDBBQAAAAAAAFgdl2WY6iOEQAAABEAAAAVAAAAbm9kZS1maXh0dXJlL25vZGUuZXhlYm9vdHN0cmFwLWZpeHR1cmVQSwECFAAUAAAAAAABYHZdlmOojhEAAAARAAAAFQAAAAAAAAAAAAAAgAEAAAAAbm9kZS1maXh0dXJlL25vZGUuZXhlUEsFBgAAAAABAAEAQwAAAEQAAAAAAA==','base64');
function fixture(){mkdirSync(join(root,'work'),{recursive:true});const dir=mkdtempSync(join(root,'work/node-archive-'));const archive=join(dir,'fixture.zip');writeFileSync(archive,zip);return{dir,archive};}
test('checksum mismatch refuses extraction before any platform tool runs',()=>{const f=fixture();assert.throws(()=>extractCheckedNodeArchive(f.archive,f.dir,'0'.repeat(64)),/checksum mismatch/);assert.equal(existsSync(join(f.dir,'node-fixture')),false);});
test('existing verified archive is reused without download or overwrite',async()=>{
 const f=fixture();const sha=createHash('sha256').update(zip).digest('hex');
 const result=await cacheVerifiedNodeArchive(f.archive,sha,async()=>{throw Error('Must not download cached archive');});
 assert.equal(result.reused,true);assert.deepEqual(readFileSync(f.archive),zip);
});
test('corrupt cached archive is preserved and refuses retry download',async()=>{
 const f=fixture();writeFileSync(f.archive,'corrupt');
 await assert.rejects(cacheVerifiedNodeArchive(f.archive,createHash('sha256').update(zip).digest('hex'),async()=>{throw Error('Must not replace corrupt archive');}),/preserved.*Inspect or move/);
 assert.equal(readFileSync(f.archive,'utf8'),'corrupt');
});
test('mismatched download never creates the archive',async()=>{
 const f=fixture();const path=join(f.dir,'new.zip');
 await assert.rejects(cacheVerifiedNodeArchive(path,createHash('sha256').update(zip).digest('hex'),async()=>Buffer.from('invalid')),/not cached/);
 assert.equal(existsSync(path),false);
});
test('failed extraction can retry using the same verified archive',{skip:process.platform!=='win32'},async()=>{
 const f=fixture();const sha=createHash('sha256').update(zip).digest('hex');
 assert.throws(()=>extractCheckedNodeArchive(f.archive,join(f.dir,'absent-destination'),sha),/extraction failed/);
 assert.equal((await cacheVerifiedNodeArchive(f.archive,sha,async()=>{throw Error('Unexpected redownload');})).reused,true);
 extractCheckedNodeArchive(f.archive,f.dir,sha);assert.equal(readFileSync(join(f.dir,'node-fixture/node.exe'),'utf8'),'bootstrap-fixture');
});
test('Windows extraction ignores inherited PowerShell7 module path',{skip:process.platform!=='win32'},()=>{
 const f=fixture();const prior=process.env.PSModulePath;
 process.env.PSModulePath=resolve('C:/Program Files/PowerShell/7/Modules')+';'+join(f.dir,'incompatible-PS7-Archive');
 try{extractCheckedNodeArchive(f.archive,f.dir,createHash('sha256').update(zip).digest('hex'));assert.equal(readFileSync(join(f.dir,'node-fixture/node.exe'),'utf8'),'bootstrap-fixture');}
 finally{if(prior===undefined)delete process.env.PSModulePath;else process.env.PSModulePath=prior;}
});
