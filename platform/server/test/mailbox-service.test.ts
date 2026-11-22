import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { createMailboxServices as originalCreateMailboxServices } from '../src/mailbox/service.js';
import type { ImapClient, ImapMailboxStatus, ImapFetchResult } from '../src/mailbox/imap-client.js';

class MockImapClient implements ImapClient {
  public connected = false;
  public status: ImapMailboxStatus = {
    name: 'INBOX',
    uidValidity: 100,
    uidNext: 10,
    exists: 2,
    recent: 0
  };
  public messages: ImapFetchResult[] = [];

  async connect() {
    this.connected = true;
  }
  async selectFolder(folder: string): Promise<ImapMailboxStatus> {
    return { ...this.status, name: folder };
  }
  async fetchRange(startUid: number, endUid?: number): Promise<ImapFetchResult[]> {
    return this.messages.filter(m => m.uid >= startUid && (endUid ? m.uid <= endUid : true));
  }
  async close() {
    this.connected = false;
  }
}

const createMailboxServices=(options:Parameters<typeof originalCreateMailboxServices>[0])=>originalCreateMailboxServices({accountConfig:{displayName: 'Test mailbox',id:'alex-starlidigital',email:'mailbox@example.test',imapHost:'imap.example.test',imapUser:'mailbox@example.test',imapPass:'synthetic-test-password'},...options});

test('mailbox: draft revision increments on edit and strictly invalidates prior approval', () => {
  const store = new Store(':memory:');
  const events = new Events();
  const mailbox = createMailboxServices({ store, events });

  const draft = mailbox.createDraft({
    to: [{ address: 'prospect@business.ro', name: 'Prospect Business' }],
    subject: 'Propunere colaborare',
    textBody: 'Bună ziua, dorim să vă propunem un website nou.'
  });

  assert.equal(draft.revision, 1);
  assert.equal(draft.approvedBy, undefined);

  // Human approves draft
  const approved = mailbox.approveDraft(draft.id, 'admin-alex');
  assert.equal(approved.approvedBy, 'admin-alex');
  assert.ok(approved.approvalHash);
  assert.ok(approved.approvalExpiresAt! > Date.now());

  // Editing draft content increments revision and wipes approval!
  const edited = mailbox.updateDraft(draft.id, {
    subject: 'Propunere colaborare (actualizată)',
    textBody: 'Bună ziua, am modificat bugetul și termenii.'
  });

  assert.equal(edited.revision, 2);
  assert.equal(edited.approvedBy, undefined);
  assert.equal(edited.approvalHash, undefined);
  assert.equal(edited.approvalExpiresAt, undefined);
});

test('mailbox: draft cannot be sent without human approval or after modification', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  let smtpCalled = false;

  const mailbox = createMailboxServices({
    store,
    events,
    transport: async () => {
      smtpCalled = true;
      return { success: true, response: '250 OK', messageId: '<msg-1@starlidigital.ro>' };
    }
  });

  const draft = mailbox.createDraft({
    to: [{ address: 'client@example.com' }],
    subject: 'Subiect netestat',
    textBody: 'Corp netestat'
  });

  // Attempting to send unapproved draft throws error
  await assert.rejects(
    async () => {
      await mailbox.sendApprovedDraft({ draftId: draft.id, actor: 'admin-alex' });
    },
    /Draft has not received explicit human approval/
  );
  assert.equal(smtpCalled, false);

  // Approve then tamper with hash manually in store
  mailbox.approveDraft(draft.id, 'admin-alex');
  const tampered = store.get('mailbox-drafts', draft.id)!;
  tampered.textBody = 'Tampered content without revision bump';
  store.put('mailbox-drafts', tampered);

  await assert.rejects(
    async () => {
      await mailbox.sendApprovedDraft({ draftId: draft.id, actor: 'admin-alex' });
    },
    /Draft was modified after approval was granted/
  );
  assert.equal(smtpCalled, false);
});

test('mailbox: ambiguous SMTP failure marks delivery state NEEDS_REVIEW and never auto-resends', async () => {
  const store = new Store(':memory:');
  const events = new Events();

  const mailbox = createMailboxServices({
    store,
    events,
    transport: async () => {
      return {
        success: false,
        stage: 'DATA_SEND',
        uncertain: true,
        message: 'Connection closed unexpectedly by peer during data transmission'
      };
    }
  });

  const draft = mailbox.createDraft({
    to: [{ address: 'lead@retail.ro' }],
    subject: 'Ofertă StarliDigital',
    textBody: 'Detalii ofertă'
  });

  mailbox.approveDraft(draft.id, 'admin-alex');

  await assert.rejects(
    async () => {
      await mailbox.sendApprovedDraft({ draftId: draft.id, actor: 'admin-alex' });
    },
    /SMTP outcome uncertain/
  );

  // Check stored message delivery state
  const sentMessages = store.list('mailbox-messages');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].status, 'NEEDS_REVIEW');
});

test('mailbox: thread reply / reply-all excludes own address and maintains threading references', () => {
  const store = new Store(':memory:');
  const events = new Events();
  const mailbox = createMailboxServices({
    store,
    events,
    accountConfig: {
      id: 'alex',
      email: 'alex@starlidigital.ro',
      displayName: 'Alex'
    }
  });

  // Seed an inbound message
  const originalMsg = {
    id: 'msg-seed-1',
    accountId: 'alex',
    folder: 'INBOX',
    messageId: 'original-rfc-id@client.com',
    references: ['root-msg@client.com'],
    threadId: 'root-msg@client.com',
    direction: 'INBOUND',
    from: { address: 'prospect@client.com', name: 'Prospect' },
    to: [{ address: 'alex@starlidigital.ro' }, { address: 'partner@client.com' }],
    cc: [{ address: 'manager@client.com' }],
    subject: 'Discuție Proiect Web',
    textBody: 'Vă rugăm să ne trimiteți estimarea de preț.',
    status: 'DELIVERED',
    isRead: false,
    isStarred: false,
    date: new Date().toISOString(),
    attachments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  store.put('mailbox-messages', originalMsg);

  // Reply-all
  const replyAllDraft = mailbox.prepareReply('msg-seed-1', true);

  assert.equal(replyAllDraft.subject, 'Re: Discuție Proiect Web');
  assert.equal(replyAllDraft.inReplyTo, 'original-rfc-id@client.com');
  assert.deepEqual(replyAllDraft.references, ['root-msg@client.com', 'original-rfc-id@client.com']);
  assert.equal(replyAllDraft.threadId, 'root-msg@client.com');

  // Must have original sender in To
  assert.equal(replyAllDraft.to[0].address, 'prospect@client.com');

  // CC must contain partner and manager, but strictly EXCLUDE own address alex@starlidigital.ro!
  assert.equal(replyAllDraft.cc.some(c => c.address === 'alex@starlidigital.ro'), false);
  assert.equal(replyAllDraft.cc.some(c => c.address === 'partner@client.com'), true);
  assert.equal(replyAllDraft.cc.some(c => c.address === 'manager@client.com'), true);
});

test('mailbox: durable IMAP sync saves cursor, deduplicates messages, and emits CRM activity', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const mockClient = new MockImapClient();
  mockClient.status = {
    name: 'INBOX',
    uidValidity: 5555,
    uidNext: 3,
    exists: 2,
    recent: 0
  };

  mockClient.messages = [
    {
      seq: 1,
      uid: 1,
      flags: ['\\Seen'],
      raw: [
        'From: "Ion Popescu" <ion@firma.ro>',
        'To: Alex <alex@starlidigital.ro>',
        'Subject: Cerere oferta site',
        'Date: Sat, 31 Oct 2026 10:00:00 GMT',
        'Message-ID: <ion-1@firma.ro>',
        '',
        'Salut, vrem un magazin online.'
      ].join('\r\n')
    },
    {
      seq: 2,
      uid: 2,
      flags: [],
      raw: [
        'From: "Elena Ionescu" <elena@startup.ro>',
        'To: Alex <alex@starlidigital.ro>',
        'Subject: Programare intalnire',
        'Date: Sat, 31 Oct 2026 11:00:00 GMT',
        'Message-ID: <elena-2@startup.ro>',
        '',
        'Salut Alex, putem discuta luni?'
      ].join('\r\n')
    }
  ];

  const crmActivities: any[] = [];
  const mailbox = createMailboxServices({
    store,
    events,
    imapClientFactory: () => mockClient,
    crmActivitySink: (act) => {
      crmActivities.push(act);
    }
  });

  // Sync first time
  const syncResult1 = await mailbox.syncMailbox('INBOX');
  assert.equal(syncResult1.newMessagesCount, 2);
  assert.equal(syncResult1.lastUid, 2);

  const messagesInStore = store.list('mailbox-messages');
  assert.equal(messagesInStore.length, 2);
  assert.equal(crmActivities.length, 2);
  assert.equal(crmActivities[0].kind, 'EMAIL_INBOUND');

  // Verify cursor saved
  const cursor = store.get('mailbox-cursors', 'alex-starlidigital:INBOX');
  assert.ok(cursor);
  assert.equal(cursor.lastUid, 2);
  assert.equal(cursor.uidValidity, 5555);

  // Sync second time without new messages -> no duplicate messages or activities
  const syncResult2 = await mailbox.syncMailbox('INBOX');
  assert.equal(syncResult2.newMessagesCount, 0);
  assert.equal(store.list('mailbox-messages').length, 2);
  assert.equal(crmActivities.length, 2);
});

