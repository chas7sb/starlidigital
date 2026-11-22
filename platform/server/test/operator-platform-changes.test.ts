import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,linkSync,mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store,id,now} from '../src/store.js';
import {Events} from '../src/events.js';
import {sessionContext} from '../src/security.js';
import {stagePlatformChange,approveStagedPlatformChange,rollbackPlatformChange} from '../src/operator-tools.js';
import {recoverInterruptedPlatformChanges} from '../src/operator-platform-changes.js';

function fixture(){
 const previous=process.env.STARLI_OPERATOR_WORKSPACE,root=mkdtempSync(join(tmpdir(),'starli-changes-'));process.env.STARLI_OPERATOR_WORKSPACE=root;mkdirSync(join(root,'docs'));
 const store=new Store(':memory:'),events=new Events(),user=store.saveUser({id:id(),username:'changes_admin',role:'ADMIN',createdAt:now()}),ctx=sessionContext(store,'',()=>{},'changes');ctx.user=user;
 const stage=(path:string,before:string,after:string)=>stagePlatformChange(store,events,ctx,{title:'Verifiable change',targetPath:path,originalContent:before,proposedContent:after});
 return{root,store,events,ctx,stage,close(){store.close();rmSync(root,{recursive:true,force:true});if(previous===undefined)delete process.env.STARLI_OPERATOR_WORKSPACE;else process.env.STARLI_OPERATOR_WORKSPACE=previous;}};
}

test('approval really writes the staged file and rollback really restores the durable preimage',()=>{
 const f=fixture();try{const file=join(f.root,'docs/example.md');writeFileSync(file,'Before\n');const change=f.stage('docs/example.md','Before\n','After\n');assert.equal(readFileSync(file,'utf8'),'Before\n');assert.match(change.verificationReport,/nu au fost executate/);
 const applied=approveStagedPlatformChange(f.store,f.events,f.ctx,change.id);assert.equal(applied.status,'APPROVED_APPLIED');assert.equal(readFileSync(file,'utf8'),'After\n');assert.match(applied.verificationReport,/SHA-256/);assert.match(applied.verificationReport,/nu au fost executate/);assert.equal(f.store.get('platform-change-backups',change.id)!.content,'Before\n');
 assert.throws(()=>approveStagedPlatformChange(f.store,f.events,f.ctx,change.id));const restored=rollbackPlatformChange(f.store,f.events,f.ctx,change.id);assert.equal(restored.status,'ROLLED_BACK');assert.equal(readFileSync(file,'utf8'),'Before\n');assert.throws(()=>rollbackPlatformChange(f.store,f.events,f.ctx,change.id));
 }finally{f.close();}
});

test('new-file rollback removes only the file created by the approved change',()=>{
 const f=fixture();try{const file=join(f.root,'docs/new.md'),change=f.stage('docs/new.md','','Created');approveStagedPlatformChange(f.store,f.events,f.ctx,change.id);assert.equal(readFileSync(file,'utf8'),'Created');rollbackPlatformChange(f.store,f.events,f.ctx,change.id);assert.equal(existsSync(file),false);}finally{f.close();}
});

test('staging, applying and rollback reject stale content without overwriting other edits',()=>{
 const f=fixture();try{const file=join(f.root,'docs/conflict.md');writeFileSync(file,'Current');assert.throws(()=>f.stage('docs/conflict.md','Outdated','Next'),/original/);const change=f.stage('docs/conflict.md','Current','Next');writeFileSync(file,'Concurrent');assert.throws(()=>approveStagedPlatformChange(f.store,f.events,f.ctx,change.id),/schimbat/);assert.equal(readFileSync(file,'utf8'),'Concurrent');assert.equal(f.store.get('platform-changes',change.id)!.status,'STAGED_AWAITING_APPROVAL');
 writeFileSync(file,'Current');approveStagedPlatformChange(f.store,f.events,f.ctx,change.id);writeFileSync(file,'Later edit');assert.throws(()=>rollbackPlatformChange(f.store,f.events,f.ctx,change.id),/ulterior/);assert.equal(readFileSync(file,'utf8'),'Later edit');
 }finally{f.close();}
});

test('legacy or corrupted records cannot pretend to have applied or restored source',()=>{
 const f=fixture();try{const file=join(f.root,'docs/integrity.md');writeFileSync(file,'Original');const change=f.stage('docs/integrity.md','Original','Updated');f.store.put('platform-changes',{...change,proposedContent:'Tampered'});assert.throws(()=>approveStagedPlatformChange(f.store,f.events,f.ctx,change.id),/dovezii/);f.store.put('platform-changes',{...change,workspaceRoot:undefined});assert.throws(()=>approveStagedPlatformChange(f.store,f.events,f.ctx,change.id),/dovada/);assert.equal(readFileSync(file,'utf8'),'Original');assert.throws(()=>rollbackPlatformChange(f.store,f.events,f.ctx,change.id),/aplicată/);}finally{f.close();}
});

test('source policy rejects secrets, traversal, absolute paths, unsupported locations and hardlinks',()=>{
 const f=fixture();try{writeFileSync(join(f.root,'docs/target.md'),'Original');linkSync(join(f.root,'docs/target.md'),join(f.root,'docs/hard.md'));
 for(const path of['../escape.md',join(f.root,'docs/absolute.md'),'data/user.json','.env','docs/.hidden.md','docs/config.json','docs/hard.md'])assert.throws(()=>f.stage(path,'','Next'));
 assert.throws(()=>f.stage('docs/secret.md','','starli_op_123456789012345678901234567890'),/credențiale/);
 assert.throws(()=>f.stage('docs/large.md','','a'.repeat(200001)),/200 KB/);
 }finally{f.close();}
});

test('symlink ancestors cannot redirect approved writes outside the workspace',t=>{
 const f=fixture(),outside=mkdtempSync(join(tmpdir(),'starli-change-outside-'));try{writeFileSync(join(outside,'target.md'),'External');try{symlinkSync(outside,join(f.root,'docs/linked'),process.platform==='win32'?'junction':'dir');}catch(error:any){if(error.code==='EPERM'){t.skip('Symlink creation unavailable');return;}throw error;}
 assert.throws(()=>f.stage('docs/linked/target.md','External','Overwritten'),/simbolice/);assert.equal(readFileSync(join(outside,'target.md'),'utf8'),'External');
 }finally{f.close();rmSync(outside,{recursive:true,force:true});}
});

test('restart recovery marks uncertain disk operations without repeating or claiming them',()=>{
 const f=fixture();try{const file=join(f.root,'docs/interrupted.md');writeFileSync(file,'Original');const change=f.stage('docs/interrupted.md','Original','Updated');f.store.put('platform-changes',{...change,status:'APPLYING'});assert.equal(recoverInterruptedPlatformChanges(f.store),1);assert.equal(recoverInterruptedPlatformChanges(f.store),0);assert.equal(readFileSync(file,'utf8'),'Original');assert.equal(f.store.get('platform-changes',change.id)!.status,'APPLY_UNCERTAIN');assert.throws(()=>approveStagedPlatformChange(f.store,f.events,f.ctx,change.id));}finally{f.close();}
});
