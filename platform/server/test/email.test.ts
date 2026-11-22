import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {Webhook} from 'svix';
import {Store} from '../src/store.js';
import {Events} from '../src/events.js';
import {
  emailStatus,
  enqueueEmail,
  queuePasswordReset,
  publicEmail,
  tickEmailOutbox,
  processResendEvent,
  resendWebhook,
  proposalProvider,
  smtpStatus,
  type SmtpSender
} from '../src/email.js';

function configured(){
  const saved = {
    key: process.env.EMAIL_OUTBOX_KEY,
    api: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    secret: process.env.RESEND_WEBHOOK_SECRET,
    propProvider: process.env.EMAIL_PROPOSAL_PROVIDER,
    smtpEnabled: process.env.SMTP_ENABLED,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT,
    smtpSecure: process.env.SMTP_SECURE,
    smtpFrom: process.env.SMTP_FROM
  };
  process.env.EMAIL_OUTBOX_KEY = '11'.repeat(32);
  process.env.RESEND_API_KEY = 're_unit_fake';
  process.env.EMAIL_FROM = 'Starlidigital <contact@starlidigital.ro>';
  process.env.SMTP_FROM = 'Local <sender@example.test>';
  delete process.env.EMAIL_PROPOSAL_PROVIDER;
  delete process.env.SMTP_ENABLED;

  return () => {
    for (const [k, v] of Object.entries({
      EMAIL_OUTBOX_KEY: saved.key,
      RESEND_API_KEY: saved.api,
      EMAIL_FROM: saved.from,
      RESEND_WEBHOOK_SECRET: saved.secret,
      EMAIL_PROPOSAL_PROVIDER: saved.propProvider,
      SMTP_ENABLED: saved.smtpEnabled,
      SMTP_HOST: saved.smtpHost,
      SMTP_PORT: saved.smtpPort,
      SMTP_SECURE: saved.smtpSecure,
      SMTP_FROM: saved.smtpFrom
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

test('email outbox encrypts reset links and recipients; API acceptance never claims delivery', async () => {
  const restore = configured(), store = new Store(':memory:'), events = new Events(); let requests = 0;
  try {
    const user = {id: 'user', email: 'owner@starlidigital.ro', recoveryEmail: 'private-owner@example.com'};
    const row = queuePasswordReset(store, user, 'private-recovery-token', Date.now() + 1800000);
    const serialized = JSON.stringify(store.list('email-outbox'));
    assert.ok(!serialized.includes(user.recoveryEmail));
    assert.ok(!serialized.includes('private-recovery-token'));
    assert.ok(!serialized.includes('reset-password'));
    assert.equal(emailStatus().configured, true);
    assert.equal(publicEmail(row).status, 'QUEUED');

    const send: typeof fetch = async (url, options) => {
      requests++;
      assert.equal(String(url), 'https://api.resend.com/emails');
      assert.equal((options?.headers as any)['Idempotency-Key'], 'starlidigital/' + row.id);
      const body = JSON.parse(String(options?.body));
      assert.equal(body.to[0], user.recoveryEmail);
      assert.ok(body.text.includes('private-recovery-token'));
      return new Response(JSON.stringify({id: 'resend_mail_001'}));
    };

    await tickEmailOutbox(store, events, send);
    assert.equal(store.get('email-outbox', row.id)?.status, 'ACCEPTED');
    assert.equal(store.get('email-outbox', row.id)?.deliveredAt, undefined);
    assert.equal(requests, 1);

    const view = publicEmail(store.get('email-outbox', row.id)!);
    assert.ok(!('encryptedPayload' in view));
    assert.ok(!JSON.stringify(view).includes(user.recoveryEmail));
    assert.ok(!JSON.stringify(view).includes('private-recovery-token'));

    processResendEvent(store, 'msg_delivered', {type: 'email.delivered', data: {email_id: 'resend_mail_001'}});
    assert.equal(store.get('email-outbox', row.id)?.status, 'DELIVERED');
    assert.ok(store.get('email-outbox', row.id)?.deliveredAt);

    processResendEvent(store, 'msg_sent_late', {type: 'email.sent', data: {email_id: 'resend_mail_001'}});
    assert.equal(store.get('email-outbox', row.id)?.status, 'DELIVERED');
    assert.equal(processResendEvent(store, 'msg_delivered', {type: 'email.delivered', data: {email_id: 'resend_mail_001'}}), false);
  } finally {
    restore();
    store.close();
  }
});

test('unknown email send retries the same immutable idempotency key and stops after its window', async () => {
  const restore = configured(), store = new Store(':memory:'), events = new Events(); let time = Date.now(); const keys: string[] = [];
  try {
    const row = enqueueEmail(store, {kind: 'TEST', reference: 'test-unknown', to: 'delivered@resend.dev', subject: 'Test', text: 'Test privat'});
    const send: typeof fetch = async (_url, options) => {
      keys.push((options?.headers as any)['Idempotency-Key']);
      throw new Error('Lost response');
    };

    await tickEmailOutbox(store, events, send, () => time);
    assert.equal(store.get('email-outbox', row.id)?.status, 'RETRY');
    time += 50000;
    await tickEmailOutbox(store, events, send, () => time);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    time += 24 * 3600000;
    await tickEmailOutbox(store, events, send, () => time);
    assert.equal(store.get('email-outbox', row.id)?.status, 'NEEDS_REVIEW');
    assert.equal(keys.length, 2);
  } finally {
    restore();
    store.close();
  }
});

test('expired resets and modified ciphertext are not sent', async () => {
  const restore = configured(), store = new Store(':memory:'), events = new Events(); let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    throw new Error('Unexpected send');
  };
  try {
    const expired = enqueueEmail(store, {kind: 'RESET', reference: 'expired', to: 'owner@example.com', subject: 'Reset', text: 'secret', expiresAt: Date.now() - 1});
    await tickEmailOutbox(store, events, send);
    assert.equal(store.get('email-outbox', expired.id)?.status, 'EXPIRED');

    const damaged = enqueueEmail(store, {kind: 'TEST', reference: 'damaged', to: 'owner@example.com', subject: 'Test', text: 'secret'});
    store.put('email-outbox', {...damaged, encryptedPayload: {...damaged.encryptedPayload, data: Buffer.from('changed').toString('base64')}});
    await tickEmailOutbox(store, events, send);
    assert.equal(store.get('email-outbox', damaged.id)?.status, 'FAILED');
    assert.equal(calls, 0);
  } finally {
    restore();
    store.close();
  }
});

test('Resend webhook verifies original Svix bytes before recording delivery', async () => {
  const restore = configured(), store = new Store(':memory:'), events = new Events();
  const secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64');
  process.env.RESEND_WEBHOOK_SECRET = secret;

  const row = enqueueEmail(store, {kind: 'TEST', reference: 'signed-webhook', to: 'delivered@resend.dev', subject: 'Test', text: 'Text'});
  store.put('email-outbox', {...row, status: 'ACCEPTED', providerId: 'resend_signed_001'});
  const body = JSON.stringify({type: 'email.delivered', data: {email_id: 'resend_signed_001'}}), timestamp = new Date(), messageId = 'msg_signed_001', signature = new Webhook(secret).sign(messageId, timestamp, body);

  async function invoke(payload: string) {
    const req = Readable.from([Buffer.from(payload)]) as any;
    req.method = 'POST';
    req.headers = {'svix-id': messageId, 'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)), 'svix-signature': signature};
    const response: any = {statusCode: 200, writeHead(code: number) { this.statusCode = code; return this; }, setHeader() {}, end() {}};
    await resendWebhook(req, response, store, events);
    return response.statusCode;
  }

  try {
    assert.equal(await invoke(body + ' '), 400);
    assert.equal(store.get('email-outbox', row.id)?.status, 'ACCEPTED');
    assert.equal(await invoke(body), 200);
    assert.equal(store.get('email-outbox', row.id)?.status, 'DELIVERED');
  } finally {
    restore();
    store.close();
  }
});

test('G1: proposal provider selection keeps transactional emails on Resend and selects SMTP only for PROPOSAL', async () => {
  const restore = configured(), store = new Store(':memory:'), events = new Events();
  try {
    // 1. Default without EMAIL_PROPOSAL_PROVIDER is RESEND
    assert.equal(proposalProvider(), 'RESEND');

    // 2. Set EMAIL_PROPOSAL_PROVIDER=SMTP
    process.env.EMAIL_PROPOSAL_PROVIDER = 'SMTP';
    process.env.SMTP_ENABLED = 'true';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '25';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_FROM = 'Starlidigital <alex@outreach.starlidigital.ro>';

    assert.equal(proposalProvider(), 'SMTP');
    assert.equal(smtpStatus().enabled, true);
    assert.equal(smtpStatus().valid, true);

    let resendCalls = 0;
    const sendResend: typeof fetch = async (url) => {
      resendCalls++;
      return new Response(JSON.stringify({id: 'resend_txn_001'}));
    };

    let smtpCalls = 0;
    let recordedSmtpArgs: any = null;
    const sendSmtp: SmtpSender = async (args) => {
      smtpCalls++;
      recordedSmtpArgs = args;
      return {success: true, response: '250 Ok queued', messageId: args.messageId};
    };

    // A. Transactional email (WELCOME) must use Resend, NEVER SMTP
    const welcome = enqueueEmail(store, {kind: 'WELCOME', reference: 'ref-welcome-1', to: 'client@example.com', subject: 'Bun venit', text: 'Text welcome'});
    await tickEmailOutbox(store, events, sendResend, Date.now, sendSmtp);
    assert.equal(store.get('email-outbox', welcome.id)?.status, 'ACCEPTED');
    assert.equal(resendCalls, 1);
    assert.equal(smtpCalls, 0);

    // B. PROPOSAL email must use SMTP when EMAIL_PROPOSAL_PROVIDER=SMTP
    const proposal = enqueueEmail(store, {kind: 'PROPOSAL', reference: 'ref-proposal-1', to: 'prospect@example.com', subject: 'Propunere website', text: 'Vezi propunerea'});
    await tickEmailOutbox(store, events, sendResend, Date.now, sendSmtp);
    assert.equal(store.get('email-outbox', proposal.id)?.status, 'ACCEPTED');
    assert.equal(smtpCalls, 1);
    assert.equal(resendCalls, 1); // No additional Resend call!
    assert.ok(recordedSmtpArgs.messageId.includes(proposal.id));
    assert.ok(recordedSmtpArgs.messageId.endsWith('@outreach.starlidigital.ro'));
    assert.equal(store.get('email-outbox', proposal.id)?.providerId, recordedSmtpArgs.messageId);
    // Crucial rule: 250 MTA acceptance is ACCEPTED, NEVER DELIVERED
    assert.equal(store.get('email-outbox', proposal.id)?.deliveredAt, undefined);
  } finally {
    restore();
    store.close();
  }
});

test('G1: SMTP disabled or invalid marks status SETUP_REQUIRED without fallback to Resend', async () => {
  const restore = configured(), store = new Store(':memory:'), events = new Events();
  try {
    process.env.EMAIL_PROPOSAL_PROVIDER = 'SMTP';
    process.env.SMTP_ENABLED = 'false'; // Disabled

    let resendCalled = false;
    const sendResend: typeof fetch = async () => {
      resendCalled = true;
      return new Response(JSON.stringify({id: 'leak'}));
    };
    let smtpCalled = false;
    const sendSmtp: SmtpSender = async () => {
      smtpCalled = true;
      return {success: true, response: '250', messageId: 'm'};
    };

    const prop = enqueueEmail(store, {kind: 'PROPOSAL', reference: 'ref-disabled-smtp', to: 'p@example.com', subject: 'Prop', text: 'Text'});
    await tickEmailOutbox(store, events, sendResend, Date.now, sendSmtp);

    assert.equal(store.get('email-outbox', prop.id)?.status, 'SETUP_REQUIRED');
    assert.ok(store.get('email-outbox', prop.id)?.error?.includes('SMTP_ENABLED=false'));
    assert.equal(resendCalled, false);
    assert.equal(smtpCalled, false);
  } finally {
    restore();
    store.close();
  }
});

test('G1: SMTP uncertain failure after DATA transmission marks NEEDS_REVIEW without automatic retry', async () => {
  const restore = configured(), store = new Store(':memory:'), events = new Events();
  try {
    process.env.EMAIL_PROPOSAL_PROVIDER = 'SMTP';
    process.env.SMTP_ENABLED = 'true';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '25';
    process.env.SMTP_SECURE = 'false';

    let attempts = 0;
    const sendSmtp: SmtpSender = async () => {
      attempts++;
      return {
        success: false,
        stage: 'DATA_SEND',
        message: 'Connection dropped after DATA',
        uncertain: true
      };
    };

    const prop = enqueueEmail(store, {kind: 'PROPOSAL', reference: 'ref-uncertain-smtp', to: 'p@example.com', subject: 'Prop', text: 'Text'});
    await tickEmailOutbox(store, events, fetch, Date.now, sendSmtp);

    assert.equal(store.get('email-outbox', prop.id)?.status, 'NEEDS_REVIEW');
    assert.ok(store.get('email-outbox', prop.id)?.error?.includes('necunoscut după transmiterea datelor'));

    // Second tick must NOT retry NEEDS_REVIEW
    await tickEmailOutbox(store, events, fetch, Date.now, sendSmtp);
    assert.equal(attempts, 1);
  } finally {
    restore();
    store.close();
  }
});
