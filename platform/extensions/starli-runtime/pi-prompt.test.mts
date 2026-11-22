import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedTaskPrompt} from './pi-prompt.ts';
test('bounded master history preserves the latest user request',()=>{
 const latest='USER: perform-current-request';
 const input='old '.repeat(5000)+latest;
 const result=boundedTaskPrompt(input,true);
 assert.equal(result.length,12000);
 assert.ok(result.endsWith(latest));
});
test('delegated task bound remains independent and rejects nontext',()=>{
 assert.equal(boundedTaskPrompt('x'.repeat(9000)).length,8000);
 assert.equal(boundedTaskPrompt('complete task'), 'complete task');
 assert.throws(()=>boundedTaskPrompt({prompt:'injected'}), /INVALID_TASK_PROMPT/);
});
