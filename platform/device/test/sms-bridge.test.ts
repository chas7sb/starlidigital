import test from 'node:test';import assert from 'node:assert/strict';import {parseSmsBridgeResult,sendSmsThroughBridge} from '../src/sms-bridge.js';
test('bridge receipts parse Android broadcast output and UTF-8 payloads remain data',async()=>{
 assert.equal(parseSmsBridgeResult('Broadcast completed: result=0, data="{"state":"SENT"}"').state,'SENT');let n=0;
 const result=await sendSmsThroughBridge(async(_binary,args)=>{n++;const payload=JSON.parse(Buffer.from(args.at(-1)!,'base64').toString('utf8'));assert.equal(payload.body,'Bună! Cafea & ceai; test $ date');assert.equal(payload.requestId,'message-id');return{exitCode:0,stdout:'Broadcast completed: result=0, data="{"state":"SENT"}"',stderr:'',timedOut:false};},{serial:'phone',requestId:'message-id',to:'+40749696220',body:'Bună! Cafea & ceai; test $ date'});assert.equal(result.state,'SENT');assert.equal(n,1);
});
