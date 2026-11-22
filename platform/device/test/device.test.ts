import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {once} from 'node:events';
import {WebSocketServer} from 'ws';
import {
  isDevicePathAllowed,
  validateStructuredArgs,
  redactDeviceOutput,
  parseAdbDevicesOutput,
  executeDeviceJob,
  loadDeviceState
  ,resolveAdbExecutable,startDeviceConnectorLoop,saveDeviceState
} from '../src/index.js';

test('WebSocket heartbeat uses the server protocol and reports the connected phone',{timeout:6000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'starli-heartbeat-')),statePath=join(root,'state.json'),server=new WebSocketServer({host:'127.0.0.1',port:0});let connector:ReturnType<typeof startDeviceConnectorLoop>|undefined;
 try{await once(server,'listening');const address=server.address() as {port:number};saveDeviceState({apiUrl:'http://127.0.0.1:'+address.port,deviceId:'phone-bridge',deviceToken:'test-device-token',allowedRoots:[root],executedJobs:{}},statePath);
 const received=new Promise<any>(resolve=>server.once('connection',socket=>socket.once('message',raw=>resolve(JSON.parse(String(raw))))));
 connector=startDeviceConnectorLoop({statePath,onStatus:()=>{},inspectAdb:async()=>parseAdbDevicesOutput('List of devices attached\nphone device model:CPH2127\n')});const heartbeat=await received;assert.equal(heartbeat.type,'HEARTBEAT');assert.equal(heartbeat.adbStatus,'CONNECTED');assert.equal(heartbeat.adbDevices[0].canSendSms,true);
 }finally{connector?.stop();for(const client of server.clients)client.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});

test('device dispatch waits for the server lease, normalizes job arguments and reports the same lease',{timeout:6000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'starli-dispatch-')),statePath=join(root,'state.json'),target=join(root,'result.txt'),server=new WebSocketServer({host:'127.0.0.1',port:0});let connector:ReturnType<typeof startDeviceConnectorLoop>|undefined,claims=0;
 try{await once(server,'listening');saveDeviceState({apiUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port,deviceId:'d',deviceToken:'test',allowedRoots:[root],executedJobs:{}},statePath);
 const completion=new Promise<any>((resolve,reject)=>server.once('connection',socket=>socket.on('message',raw=>{try{const message=JSON.parse(String(raw));if(message.type==='HEARTBEAT'){const job={id:'write-test',kind:'device.fs.write',args:{path:target,content:'verified'},idempotencyKey:'one-write'};socket.send(JSON.stringify({type:'JOB_DISPATCH',job}));socket.send(JSON.stringify({type:'JOB_DISPATCH',job}));}
 else if(message.type==='JOB_REPORT'&&message.status==='RUNNING'){claims++;assert(!existsSync(target));socket.send(JSON.stringify({type:'JOB_REPORT_ACK',jobId:message.jobId,status:'RUNNING',leaseToken:'server-lease'}));}
 else if(message.type==='JOB_REPORT'){assert.equal(message.leaseToken,'server-lease');assert.equal(message.status,'SUCCEEDED');resolve(message);}}catch(error){reject(error);}})));
 connector=startDeviceConnectorLoop({statePath,onStatus:()=>{},inspectAdb:async()=>({adbStatus:'NONE',adbDevices:[]})});await completion;assert.equal(claims,1);assert.equal(readFileSync(target,'utf8'),'verified');
 }finally{connector?.stop();for(const client of server.clients)client.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});

test('background connector resolves ADB with stale PATH and publishes the server SMS capability field',()=>{
 const root=mkdtempSync(join(tmpdir(),'starli-adb-'));try{mkdirSync(join(root,'platform-tools'));const path=join(root,'platform-tools','adb.exe');writeFileSync(path,'test');assert.equal(resolveAdbExecutable({PATH:'',ProgramFiles:root},'win32'),path);assert.equal(resolveAdbExecutable({STARLI_ADB_PATH:path},'win32'),path);assert.throws(()=>resolveAdbExecutable({STARLI_ADB_PATH:join(root,'missing.exe')},'win32'),/nu există/);
 const connected=parseAdbDevicesOutput('List of devices attached\nphone device model:CPH2127\n');assert.equal(connected.adbDevices[0].canSendSms,true);assert.equal(parseAdbDevicesOutput('phone unauthorized').adbDevices[0].canSendSms,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Dispozitiv Windows: validare argumente structurate și căi permise', () => {
  // Reject shell metacharacters
  assert.throws(() => validateStructuredArgs(['status', '&&', 'dir']), /Metacaracterele shell nu sunt permise/);
  assert.throws(() => validateStructuredArgs(['file;rm -rf /']), /Metacaracterele shell nu sunt permise/);
  assert.doesNotThrow(() => validateStructuredArgs(['status', '--short', 'HEAD']));

  // Allowed roots sandbox
  const allowedRoots = ['C:/Users/Administrator/Desktop/starlidigital-ro'];
  assert.equal(isDevicePathAllowed('C:/Users/Administrator/Desktop/starlidigital-ro/web', allowedRoots), true);
  assert.equal(isDevicePathAllowed('C:/Windows/System32', allowedRoots), false);
  assert.equal(isDevicePathAllowed('C:/Users/Administrator/Desktop/starlidigital-ro/../Windows', allowedRoots), false);
});

test('Dispozitiv Windows: redactare automată a secretelor', () => {
  const raw = 'Auth: Bearer starli_op_abcdef1234567890abcdef1234567890 and key sk_live_secret123456 and claim SC-TEST-1234-ABCD';
  const redacted = redactDeviceOutput(raw);
  assert.ok(!redacted.includes('starli_op_abcdef1234567890'));
  assert.ok(!redacted.includes('sk_live_secret123456'));
  assert.ok(!redacted.includes('SC-TEST-1234-ABCD'));
  assert.ok(redacted.includes('starli_op_[REDACTED]'));
  assert.ok(redacted.includes('sk_live_[REDACTED]'));
  assert.ok(redacted.includes('SC-[REDACTED]'));
});

test('Dispozitiv Windows: interpretare listă ADB dispozitive', () => {
  const adbOut = `List of devices attached\nemulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emulator64_arm64\n12345678 unauthorized\n`;
  const parsed = parseAdbDevicesOutput(adbOut);
  assert.equal(parsed.adbStatus, 'CONNECTED');
  assert.equal(parsed.adbDevices.length, 2);
  assert.equal(parsed.adbDevices[0].serial, 'emulator-5554');
  assert.equal(parsed.adbDevices[0].state, 'device');
  assert.equal(parsed.adbDevices[0].smsCapable, true);
  assert.equal(parsed.adbDevices[1].state, 'unauthorized');
});

test('Dispozitiv Windows: deduplicare locală a lucrărilor executate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'starli-dev-test-'));
  const statePath = join(dir, 'state.json');
  const state = loadDeviceState(statePath);
  state.allowedRoots = [dir];

  let execCount = 0;
  const mockRunner = async () => {
    execCount += 1;
    return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
  };

  const job = {
    id: 'job-1',
    kind: 'device.structured_task',
    idempotencyKey: 'idemp-1',
    payloadJson: JSON.stringify({ tool: 'git', action: 'status', cwd: dir })
  };

  const res1 = await executeDeviceJob(state, job, { statePath, processRunner: mockRunner });
  assert.equal(res1.status, 'SUCCEEDED');
  assert.equal(execCount, 1);

  // Calling again with same id or idempotencyKey must return cached result without re-executing
  const res2 = await executeDeviceJob(state, job, { statePath, processRunner: mockRunner });
  assert.equal(res2.status, 'SUCCEEDED');
  assert.equal(execCount, 1); // Not incremented!
});
