import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');const env={...process.env};for(const k of ['GB3_NATIVE_JWT','WEBUI_SECRET_KEY','STARLI_AUTHORITY_MASTER_KEY'])delete env[k];
for(const [name,args,extra,expected] of [['config',[],{},'CONFIG_REQUIRED'],['privileged',[],{STARLI_AUTHORITY_MASTER_KEY:'component-denial-test'},'PRIVILEGED_CREDENTIAL_IN_APP_ENV']]){
const r=spawnSync(process.execPath,[join(root,'start.mjs'),...args],{env:{...env,...extra},encoding:'utf8'});assert.equal(r.status,1);assert.equal(JSON.parse(r.stderr).error,expected);}
console.log(JSON.stringify({pass:true,checks:2,executionClass:'COMPONENT_STARTUP_FAIL_CLOSED',fixtureAuthorityStarted:false}));
