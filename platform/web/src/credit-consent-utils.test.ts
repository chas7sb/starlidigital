import{test}from'node:test';import assert from'node:assert/strict';import{creditActionCost}from'./credit-consent-utils.ts';
const costs={enabled:true,build:100,edit:25,images:40,research:5};
test('the displayed authorization matches a new build, edit and optional image surcharge',()=>{
 assert.equal(creditActionCost(costs,'build',false,false),100);
 assert.equal(creditActionCost(costs,'build',true,false),25);
 assert.equal(creditActionCost(costs,'build',false,true),140);
 assert.equal(creditActionCost(costs,'build',true,true),65);
 assert.equal(creditActionCost(costs,'research'),5);
 assert.equal(creditActionCost(costs,'images'),40);
});
test('invalid price arithmetic cannot become a credit authorization',()=>{
 assert.throws(()=>creditActionCost({...costs,build:NaN},'build'));
 assert.throws(()=>creditActionCost({...costs,edit:-5},'edit'));
 assert.throws(()=>creditActionCost({...costs,build:Number.MAX_SAFE_INTEGER},'build',false,true));
 assert.throws(()=>creditActionCost({...costs,images:1.5},'images'));
 assert.throws(()=>creditActionCost({...costs,images:-40},'build',false,true));
});
