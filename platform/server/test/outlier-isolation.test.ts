import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OutlierClient,readDotenv,upsertEnvValues,loadAIRuntimeEnv} from '../src/outlier-client.js';
test('new Outlier sessions never inherit or persist another customer global conversation',()=>{
 const directory=mkdtempSync(join(tmpdir(),'starli-isolation-'));const env=join(directory,'test.env');writeFileSync(env,'STARLI_CONVERSATION_ID="private-global"\nSTARLI_API_URL="https://app.outlier.ai/internal/experts/assistant/conversations/private-global/turn-streaming"\n');
 try{const first=new OutlierClient({envPath:env,initialConversationId:'owned-local'});const second=new OutlierClient({envPath:env});assert.equal(first.conversationId,'owned-local');assert.equal(second.conversationId,'');assert.equal(second.apiUrl,'');assert.equal(first.persistRuntime,false);assert.equal(second.persistRuntime,false);}finally{rmSync(directory,{recursive:true,force:true});}
});
test('AI runtime file is escaped, permission-restricted and cannot override authentication/system settings',()=>{
 const directory=mkdtempSync(join(tmpdir(),'starli-runtime-'));const file=join(directory,'ai-runtime.env');const saved={path:process.env.STARLI_RUNTIME_ENV_PATH,model:process.env.STARLI_MODEL,password:process.env.ADMIN_PASSWORD};process.env.STARLI_RUNTIME_ENV_PATH=file;
 try{upsertEnvValues({STARLI_COOKIE:'session="quoted"; other=value',STARLI_MODEL:'claude-opus-4-6'});assert.equal(readDotenv(file).STARLI_COOKIE,'session="quoted"; other=value');if(process.platform!=='win32')assert.equal(statSync(file).mode&0o777,0o600);assert.throws(()=>upsertEnvValues({ADMIN_PASSWORD:'bad'}),/nepermis/);assert.throws(()=>upsertEnvValues({STARLI_COOKIE:'value\nADMIN_PASSWORD=bad'}),/nepermis/);const previous=process.env.ADMIN_PASSWORD;writeFileSync(file,readFileSync(file,'utf8')+'ADMIN_PASSWORD="injected"\n');loadAIRuntimeEnv();assert.equal(process.env.ADMIN_PASSWORD,previous);assert.equal(process.env.STARLI_MODEL,'claude-opus-4-6');}finally{for(const[k,v]of Object.entries({STARLI_RUNTIME_ENV_PATH:saved.path,STARLI_MODEL:saved.model,ADMIN_PASSWORD:saved.password})){if(v===undefined)delete process.env[k];else process.env[k]=v;}rmSync(directory,{recursive:true,force:true});}
});
