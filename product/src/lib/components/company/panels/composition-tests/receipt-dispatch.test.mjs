import {test} from 'node:test';import assert from 'node:assert/strict';import {panelCommandsFromMessage} from '../receipt-dispatch.mjs';
const ref={scope:'company',ownerId:'c',kind:'sheet',id:'workbook'};
const valid={version:'starli.panel.receipt.v1',receiptId:'receipt',revision:2,ref,open:{version:'starli.panel.v1',action:'open',type:'resource.sheet',ref,mode:'expanded',draft:'must not emit'}};
test('canonical receipt dispatch is exact, deduplicated and contains no proposed content',()=>{
 const actions=panelCommandsFromMessage({starliPanels:[valid,valid]},'c');assert.equal(actions.length,1);assert.equal(actions[0].command.ref.id,'workbook');assert.equal(actions[0].command.mode,'docked');assert.equal('draft'in actions[0].command,false);
});
test('cross-company, mismatched ref, unknown type and free text cannot dispatch',()=>{
 assert.equal(panelCommandsFromMessage({starliPanels:[valid]},'other').length,0);
 for(const open of [{...valid.open,ref:{...ref,id:'other'}},{...valid.open,type:'https://untrusted/renderer'}])assert.equal(panelCommandsFromMessage({starliPanels:[{...valid,open}]},'c').length,0);
 assert.equal(panelCommandsFromMessage({content:JSON.stringify(valid)},'c').length,0);
});
