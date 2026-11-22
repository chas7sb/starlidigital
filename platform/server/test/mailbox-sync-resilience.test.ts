import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Events} from '../src/events.js';
import {syncFolder} from '../src/mailbox/sync.js';
import {MailboxServices} from '../src/mailbox/service.js';
import type {ImapClient} from '../src/mailbox/imap-client.js';

const raw=['From: client@example.com','To: alex@starlidigital.ro','Message-ID: <new@example.com>','Date: Sun, 01 Nov 2026 10:00:00 GMT','Subject: Website reply','','Hello Alex'].join('\r\n');
test('empty UID ranges advance the cursor instead of stalling on deleted messages',async()=>{
 const store=new Store(':memory:'),events=new Events(),ranges:number[][]=[];
 const client:ImapClient={async connect(){},async close(){},async selectFolder(){return {name:'INBOX',uidValidity:1,uidNext:501,exists:1,recent:0};},async fetchRange(start,end){ranges.push([start,end!]);return [];}};
 try{await syncFolder({store,events,client,accountId:'test',folder:'INBOX'});await syncFolder({store,events,client,accountId:'test',folder:'INBOX'});assert.deepEqual(ranges,[[1,50],[51,100]]);assert.equal(store.get('mailbox-cursors','test:INBOX')?.lastUid,100);}finally{store.close();}
});
test('UIDVALIDITY changes reset progress and never deduplicate a new message against an old UID',async()=>{
 const store=new Store(':memory:'),events=new Events();
 store.put('mailbox-cursors',{id:'test:INBOX',uidValidity:1,lastUid:500});store.put('mailbox-messages',{id:'old',accountId:'test',folder:'INBOX',uid:1,uidValidity:1,messageId:'old@example.com'});
 const client:ImapClient={async connect(){},async close(){},async selectFolder(){return {name:'INBOX',uidValidity:2,uidNext:3,exists:1,recent:0};},async fetchRange(){return [{seq:1,uid:1,flags:[],raw,sourceTruncated:true}];}};
 try{const result=await syncFolder({store,events,client,accountId:'test',folder:'INBOX'});assert.equal(result.resetCursor,true);assert.equal(result.lastUid,2);assert.equal(result.newMessagesCount,1);const messages=store.list('mailbox-messages');assert.equal(messages.length,2);const added=messages.find(message=>message.id!=='old')!;assert.equal(added.uidValidity,2);assert.equal(added.sourceTruncated,true);assert.deepEqual(added.attachments,[]);}finally{store.close();}
});
test('folder leases reject concurrent sync and are released after completion',async()=>{
 const store=new Store(':memory:'),events=new Events();let release!:()=>void;
 const connected=new Promise<void>(resolve=>{release=resolve;});
 const client:ImapClient={async connect(){await connected;},async close(){},async selectFolder(){return {name:'INBOX',uidValidity:1,uidNext:1,exists:0,recent:0};},async fetchRange(){return [];}};
 const mailbox=new MailboxServices({store,events,accountConfig:{displayName: 'Test mailbox',id:'test',email:'mailbox@example.test',imapHost:'imap.example.test',imapUser:'mailbox@example.test',imapPass:'synthetic-test-password'},imapClientFactory:()=>client});
 try{const pending=mailbox.syncMailbox();await assert.rejects(mailbox.syncMailbox(),/already in progress/);release();await pending;assert.equal(store.list('mailbox-sync-leases').length,0);}finally{store.close();}
});
test('sparse UID search fetches existing messages without scanning thousands of empty ranges',async()=>{
 const store=new Store(':memory:'),events=new Events();let range:number[]=[];
 const client:ImapClient={async connect(){},async close(){},async selectFolder(){return {name:'INBOX',uidValidity:3,uidNext:5001,exists:2,recent:0};},async findUids(start,limit){assert.equal(start,1);assert.equal(limit,50);return [1500,3000];},async fetchRange(start,end){range=[start,end!];return [{uid:1500,seq:1,flags:[],raw}];}};
 try{const result=await syncFolder({store,events,client,accountId:'test',folder:'INBOX'});assert.deepEqual(range,[1,3000]);assert.equal(result.lastUid,3000);assert.equal(result.hasMore,true);}finally{store.close();}
});
