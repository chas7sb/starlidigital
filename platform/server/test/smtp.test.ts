import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  parseSmtpConfig,
  validateSmtpConfig,
  isLoopbackHost,
  sendSmtpMail,
  smtpMessageId,
  type SmtpConfig
} from '../src/smtp.js';

test('SMTP config validation refuses non-loopback insecure host', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('192.168.1.10'), false);
  assert.equal(isLoopbackHost('mail.example.com'), false);

  const disabledConfig: SmtpConfig = {
    enabled: false,
    host: '127.0.0.1',
    port: 25,
    secure: false,
    from: 'Starlidigital <alex@outreach.starlidigital.ro>'
  };
  assert.equal(validateSmtpConfig(disabledConfig).valid, false);

  const insecureExternal: SmtpConfig = {
    enabled: true,
    host: 'mail.external.com',
    port: 25,
    secure: false,
    from: 'Starlidigital <alex@outreach.starlidigital.ro>'
  };
  const res = validateSmtpConfig(insecureExternal);
  assert.equal(res.valid, false);
  assert.ok(res.error?.includes('loopback'));

  const validLoopback: SmtpConfig = {
    enabled: true,
    host: '127.0.0.1',
    port: 25,
    secure: false,
    from: 'Starlidigital <alex@outreach.starlidigital.ro>'
  };
  assert.equal(validateSmtpConfig(validLoopback).valid, true);
});

test('sendSmtpMail completes full RFC 5321 conversation and accepts on 250', async () => {
  const recordedCommands: string[] = [];
  const server = net.createServer((c) => {
    c.on('error', () => {});
    c.write('220 localhost ESMTP Postfix (Ubuntu)\r\n');
    let buffer = '';
    c.on('data', (d) => {
      buffer += d.toString('utf8');
      while (buffer.includes('\r\n')) {
        const idx = buffer.indexOf('\r\n');
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        recordedCommands.push(line);

        if (line.startsWith('EHLO')) {
          c.write('250-localhost\r\n250 DSN\r\n');
        } else if (line.startsWith('MAIL FROM:')) {
          c.write('250 2.1.0 Ok\r\n');
        } else if (line.startsWith('RCPT TO:')) {
          c.write('250 2.1.5 Ok\r\n');
        } else if (line === 'DATA') {
          c.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (line === '.') {
          c.write('250 2.0.0 Ok: queued as 4X8B9Q29\r\n');
        } else if (line === 'QUIT') {
          c.write('221 2.0.0 Bye\r\n');
          c.end();
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const config: SmtpConfig = {
      enabled: true,
      host: '127.0.0.1',
      port,
      secure: false,
      from: 'Starlidigital <alex@outreach.starlidigital.ro>'
    };

    const res = await sendSmtpMail(
      {
        to: 'client@example.com, second@example.com',
        subject: 'Propunere website',
        text: 'Bună ziua!\n.Punct la început de linie.\nAlex',
        messageId: 'test-msg-id-123@outreach.starlidigital.ro',
        inReplyTo: 'original@example.com',
        references: ['earlier@example.com','original@example.com'],
        cc:['copy@example.com'],bcc:['private@example.com'],
      },
      config
    );

    assert.equal(res.success, true);
    if (res.success) {
      assert.ok(res.response.includes('queued as 4X8B9Q29'));
      assert.equal(res.messageId, 'test-msg-id-123@outreach.starlidigital.ro');
    }

    assert.ok(recordedCommands.some((c) => c.startsWith('EHLO')));
    assert.ok(recordedCommands.some((c) => c === 'MAIL FROM:<alex@outreach.starlidigital.ro>'));
    assert.ok(recordedCommands.some((c) => c === 'RCPT TO:<client@example.com>'));
    assert.ok(recordedCommands.some((c) => c === 'RCPT TO:<second@example.com>'));
    assert.ok(recordedCommands.includes('RCPT TO:<copy@example.com>'));
    assert.ok(recordedCommands.includes('RCPT TO:<private@example.com>'));
    assert.ok(recordedCommands.includes('Cc: <copy@example.com>'));
    assert.ok(!recordedCommands.some(line=>line.startsWith('Bcc:')));
    assert.ok(!recordedCommands.find(line=>line.startsWith('To:'))?.includes('private@example.com'));
    assert.ok(recordedCommands.includes('In-Reply-To: <original@example.com>'));
    assert.ok(recordedCommands.includes('References: <earlier@example.com> <original@example.com>'));
    assert.ok(recordedCommands.some((c) => c === 'DATA'));
    assert.ok(recordedCommands.some((c) => c === '..Punct la început de linie.')); // dot-stuffing verification
  } finally {
    server.close();
  }
});

test('SMTP threading message IDs normalize brackets and reject injected headers',()=>{
  assert.equal(smtpMessageId('<valid@example.com>'),'<valid@example.com>');
  assert.throws(()=>smtpMessageId('valid@example.com\r\nBcc: injected@example.com'),/Invalid/);
});

test('sendSmtpMail reports certain rejection on RCPT TO 550 and does not mark uncertain', async () => {
  const server = net.createServer((c) => {
    c.write('220 localhost ESMTP\r\n');
    let buffer = '';
    c.on('data', (d) => {
      buffer += d.toString('utf8');
      while (buffer.includes('\r\n')) {
        const idx = buffer.indexOf('\r\n');
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (line.startsWith('EHLO')) {
          c.write('250 localhost\r\n');
        } else if (line.startsWith('MAIL FROM:')) {
          c.write('250 Ok\r\n');
        } else if (line.startsWith('RCPT TO:')) {
          c.write('550 5.1.1 <unknown@example.com>: Recipient address rejected: User unknown\r\n');
        } else if (line === 'QUIT') {
          c.write('221 Bye\r\n');
          c.end();
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const config: SmtpConfig = {
      enabled: true,
      host: '127.0.0.1',
      port,
      secure: false,
      from: 'Starlidigital <alex@outreach.starlidigital.ro>'
    };

    const res = await sendSmtpMail(
      {
        to: 'unknown@example.com',
        subject: 'Test',
        text: 'Test',
        messageId: 'test-rcpt-reject@outreach.starlidigital.ro'
      },
      config
    );

    assert.equal(res.success, false);
    if (!res.success) {
      assert.equal(res.stage, 'RCPT_TO');
      assert.equal(res.code, 550);
      assert.equal(res.uncertain, false);
    }
  } finally {
    server.close();
  }
});

test('sendSmtpMail marks disconnect during DATA_SEND as uncertain without auto-resend', async () => {
  const server = net.createServer((c) => {
    c.write('220 localhost ESMTP\r\n');
    let buffer = '';
    c.on('data', (d) => {
      buffer += d.toString('utf8');
      while (buffer.includes('\r\n')) {
        const idx = buffer.indexOf('\r\n');
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (line.startsWith('EHLO')) {
          c.write('250 localhost\r\n');
        } else if (line.startsWith('MAIL FROM:')) {
          c.write('250 Ok\r\n');
        } else if (line.startsWith('RCPT TO:')) {
          c.write('250 Ok\r\n');
        } else if (line === 'DATA') {
          c.write('354 Go ahead\r\n');
        } else if (line === '.') {
          // Abruptly terminate connection instead of answering 250
          c.destroy();
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const config: SmtpConfig = {
      enabled: true,
      host: '127.0.0.1',
      port,
      secure: false,
      from: 'Starlidigital <alex@outreach.starlidigital.ro>'
    };

    const res = await sendSmtpMail(
      {
        to: 'client@example.com',
        subject: 'Test Uncertain',
        text: 'Data body',
        messageId: 'test-uncertain@outreach.starlidigital.ro'
      },
      config
    );

    assert.equal(res.success, false);
    if (!res.success) {
      assert.equal(res.stage, 'DATA_SEND');
      assert.equal(res.uncertain, true); // Must be marked uncertain!
    }
  } finally {
    server.close();
  }
});
