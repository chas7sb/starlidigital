
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Store } from '../../server/src/store.js';
import { browserPair,browserDevices,browserRevoke,browserSetSend,browserEnqueue,browserCommand,browserSessions,handleBrowserRequest,expireBrowserCommands } from '../src/browser-bridge.js';

test('pair, scope, revoke, replay and send permission',()=>{
 const store=new Store(':memory:');
 try {
  const pair=browserPair(store,'owner-a','My PC');
  assert.match(pair.token,/^[a-f0-9-]{36}\./);
  assert.equal(browserDevices(store,'owner-a').length,1);
  assert.equal(browserDevices(store,'owner-b').length,0);
  assert.throws(()=>browserEnqueue(store,'owner-b',{deviceId:pair.deviceId,action:'list',idempotencyKey:'list-owner-b'}),/DEVICE_UNAVAILABLE/);
  const first=browserEnqueue(store,'owner-a',{deviceId:pair.deviceId,action:'list',idempotencyKey:'list-owner-a'});
  assert.equal(first.status,'queued');
  assert.equal(browserEnqueue(store,'owner-a',{deviceId:pair.deviceId,action:'list',idempotencyKey:'list-owner-a'}).commandId,first.commandId);
  assert.throws(()=>browserEnqueue(store,'owner-a',{deviceId:pair.deviceId,action:'send',sessionId:'1',text:'hi',idempotencyKey:'list-owner-a'}),/SEND_DISABLED|SESSION_NOT_CURRENT/);
  browserRevoke(store,'owner-a',pair.deviceId);
  assert.throws(()=>browserEnqueue(store,'owner-a',{deviceId:pair.deviceId,action:'list',idempotencyKey:'list-again-a'}),/DEVICE_UNAVAILABLE/);
 }finally{store.close();}
});

test('authenticated device HTTP heartbeat, dispatch, receipt, no replay, owner isolation',async()=>{
 const store=new Store(':memory:');
 const a=browserPair(store,'owner-a','Dev A');const b=browserPair(store,'owner-b','Dev B');
 const server=http.createServer((req,res)=>handleBrowserRequest(store,req,res,new URL(req.url||'/','http://localhost')).catch(()=>{res.writeHead(400);res.end();}));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as any).port;
 async function request(path:string,token:string,method='GET',body?:unknown){
  const response=await fetch('http://127.0.0.1:'+port+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
 }
 try {
  assert.equal((await request('/browser-bridge/v1/poll','invalid')).status,401);
  assert.equal((await request('/browser-bridge/v1/heartbeat',a.token,'POST',{tabs:[{sessionId:'101',url:'https://chatgpt.com/c/test-abc',title:'LCG1'}]})).status,200);
  assert.equal(browserSessions(store,'owner-a').length,1);
  assert.equal(browserSessions(store,'owner-b').length,0);
  assert.throws(()=>browserEnqueue(store,'owner-b',{deviceId:a.deviceId,action:'read',sessionId:'101',idempotencyKey:'read-owner-b'}),/DEVICE_UNAVAILABLE/);
  assert.throws(()=>browserEnqueue(store,'owner-a',{deviceId:a.deviceId,action:'send',sessionId:'101',text:'hello',idempotencyKey:'send-owner-a'}),/SEND_DISABLED/);
  browserSetSend(store,'owner-a',a.deviceId,true);
  const pending=browserEnqueue(store,'owner-a',{deviceId:a.deviceId,action:'send',sessionId:'101',text:'hello',idempotencyKey:'send-owner-a'});
  const queued=await request('/browser-bridge/v1/poll',a.token);
  assert.equal(queued.status,200);assert.equal(queued.data.commands.length,1);
  assert.equal(queued.data.commands[0].expectedUrl,'https://chatgpt.com/c/test-abc');
  assert.equal((await request('/browser-bridge/v1/poll',b.token)).data.commands.length,0);
  assert.equal((await request('/browser-bridge/v1/receipt',a.token,'POST',{id:pending.commandId,status:'done',result:{state:'observed'}})).status,200);
  assert.equal(browserCommand(store,'owner-a',pending.commandId).status,'done');
  assert.equal((await request('/browser-bridge/v1/receipt',a.token,'POST',{id:pending.commandId,status:'done',result:{state:'observed'}})).status,409);
  const repeat=browserEnqueue(store,'owner-a',{deviceId:a.deviceId,action:'send',sessionId:'101',text:'hello',idempotencyKey:'send-owner-a'});
  assert.equal(repeat.commandId,pending.commandId);
  assert.equal((await request('/browser-bridge/v1/poll',a.token)).data.commands.length,0);
  const aged=store.get('browser_bridge_commands',pending.commandId)!;
  store.put('browser_bridge_commands',{...aged,createdAt:Date.now()-40*86400000},'owner-a');
  expireBrowserCommands(store);
  assert.equal(browserCommand(store,'owner-a',pending.commandId).status,'done','send idempotency key must outlive retention');
  assert.throws(()=>browserEnqueue(store,'owner-a',{deviceId:a.deviceId,action:'send',sessionId:'101',text:'DIFFERENT',idempotencyKey:'send-owner-a'}),/IDEMPOTENCY_CONFLICT/);
  browserRevoke(store,'owner-a',a.deviceId);
  assert.equal((await request('/browser-bridge/v1/poll',a.token)).status,401);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
