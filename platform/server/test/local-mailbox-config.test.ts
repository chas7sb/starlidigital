import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Events} from '../src/events.js';
import {MailboxServices} from '../src/mailbox/service.js';

test('unconfigured local mailbox cannot connect or send an approved draft',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());let connections=0,sends=0;
 const mailbox=new MailboxServices({store,events:new Events(),accountConfig:{displayName: 'Test mailbox',id:'local',email:''},imapClientFactory:()=>{connections++;throw new Error('Unexpected connection');},transport:async()=>{sends++;return {success:true,response:'250 OK',messageId:'test@example.test'};}});
 assert.equal(mailbox.getAccount().imapConfigured,false);
 await assert.rejects(mailbox.syncMailbox(),/Mailbox is disabled/);
 const draft=mailbox.createDraft({to:[{address:'recipient@example.test'}],subject:'Test',textBody:'Test'});
 mailbox.approveDraft(draft.id,'test-admin');
 await assert.rejects(mailbox.sendApprovedDraft({draftId:draft.id,actor:'test-admin'}),/Mailbox is disabled/);
 assert.equal(connections,0);assert.equal(sends,0);
});
