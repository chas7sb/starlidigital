import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, redactSecrets } from '../src/mailbox/sanitizer.js';
import { parseRfc2822, parseAddressList, decodeMimeWord } from '../src/mailbox/mime.js';

test('sanitizeHtml: strips script, iframe, and inline javascript: handlers', () => {
  const dirty = `
    <div>
      <h1>Important Notification</h1>
      <script>alert("pwned")</script>
      <iframe src="http://evil.com"></iframe>
      <a href="javascript:alert(1)" onclick="stealCookies()">Click me</a>
      <p style="color: red; background-image: url('http://evil.com/bg.png'); font-size: 14px;">Hello</p>
    </div>
  `;

  const { sanitizedHtml, blockedTagsCount } = sanitizeHtml(dirty);

  assert.equal(sanitizedHtml.includes('<script>'), false);
  assert.equal(sanitizedHtml.includes('<iframe'), false);
  assert.equal(sanitizedHtml.includes('javascript:'), false);
  assert.equal(sanitizedHtml.includes('onclick='), false);
  assert.equal(sanitizedHtml.includes('background-image:'), false);
  assert.equal(sanitizedHtml.includes('color: red;'), true);
  assert.equal(sanitizedHtml.includes('Click me'), true);
  assert.ok(blockedTagsCount > 0);
});

test('sanitizeHtml: blocks remote images by default to prevent tracking pixels', () => {
  const htmlWithTracker = `
    <p>Hi Alex,</p>
    <img src="https://tracker.marketing.com/pixel.png?id=123" alt="Tracker" width="1" height="1" />
  `;

  const result = sanitizeHtml(htmlWithTracker, { allowRemoteImages: false });
  assert.equal(result.hasRemoteImages, true);
  // Remote URL is moved out of active src and stored into data-original-src attribute
  assert.equal(result.sanitizedHtml.includes('data-original-src="https://tracker.marketing.com/pixel.png?id=123"'), true);
  assert.equal(result.sanitizedHtml.includes('src="data:image/svg+xml'), true);

  const allowedResult = sanitizeHtml(htmlWithTracker, { allowRemoteImages: true });
  assert.equal(allowedResult.hasRemoteImages, true);
  assert.equal(allowedResult.sanitizedHtml.includes('src="https://tracker.marketing.com/pixel.png?id=123"'), true);
});

test('redactSecrets: redacts reset tokens and numeric OTP codes', () => {
  const rawText = 'Pentru a seta o parolă nouă, deschide https://starlidigital.ro/reset-password?token=a1b2c3d4e5f6g7h8 . Linkul este valabil 30 de minute.';
  const redacted = redactSecrets(rawText);
  assert.equal(redacted.includes('a1b2c3d4e5f6g7h8'), false);
  assert.equal(redacted.includes('token=[REDACTED_TOKEN]'), true);

  const otpText = 'Codul tău de verificare este 984521. Introdu-l în aplicație.';
  const redactedOtp = redactSecrets(otpText);
  assert.equal(redactedOtp.includes('984521'), false);
  assert.equal(redactedOtp.includes('[REDACTED_OTP]'), true);
});

test('parseRfc2822: decodes MIME headers, addresses, multipart alternatives, and attachments', () => {
  const raw = [
    'From: "Client VIP" <client@partner.com>',
    'To: Alex Starli <alex@starlidigital.ro>, contact@starlidigital.ro',
    'Subject: =?UTF-8?B?T2ZlcnTEgyB3ZWJzaXRl?=',
    'Date: Mon, 31 Oct 2026 12:00:00 +0200',
    'Message-ID: <msg-999@partner.com>',
    'Content-Type: multipart/alternative; boundary="boundary-123"',
    '',
    '--boundary-123',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Salut Alex, vrem o propunere.',
    '',
    '--boundary-123',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Salut <b>Alex</b>, vrem o propunere.</p>',
    '--boundary-123--'
  ].join('\r\n');

  const parsed = parseRfc2822(raw);

  assert.equal(parsed.messageId, 'msg-999@partner.com');
  assert.equal(parsed.from.address, 'client@partner.com');
  assert.equal(parsed.from.name, 'Client VIP');
  assert.equal(parsed.to.length, 2);
  assert.equal(parsed.to[0].address, 'alex@starlidigital.ro');
  assert.equal(parsed.to[1].address, 'contact@starlidigital.ro');
  assert.equal(parsed.subject, 'Ofertă website');
  assert.equal(parsed.textBody, 'Salut Alex, vrem o propunere.');
  assert.ok(parsed.htmlBody?.includes('<b>Alex</b>'));
});
