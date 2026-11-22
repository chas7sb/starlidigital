import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue } from '../src/queue.js';

test('worker scheduling is serial and a failed compile does not block the next project',async()=>{
  const queue=new SerialQueue();const order:string[]=[];let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const first=queue.run(async()=>{order.push('first-start');await gate;order.push('first-fail');throw new Error('compile failed');});
  const rejection=assert.rejects(first,/compile failed/);
  const second=queue.run(async()=>{order.push('second-start');return 'verified';});
  await Promise.resolve();assert.deepEqual(order,['first-start']);release();await rejection;
  assert.equal(await second,'verified');assert.deepEqual(order,['first-start','first-fail','second-start']);
});
