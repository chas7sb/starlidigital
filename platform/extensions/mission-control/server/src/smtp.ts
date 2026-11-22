import net from 'node:net';
import tls from 'node:tls';

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  replyTo?: string;
  user?: string;
  pass?: string;
}

export interface SmtpSendArgs {
  from?: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  cc?: string[];
  bcc?: string[];
}

export type SmtpSendResult =
  | { success: true; response: string; messageId: string }
  | { success: false; stage: 'CONNECT' | 'EHLO' | 'AUTH' | 'MAIL_FROM' | 'RCPT_TO' | 'DATA_START' | 'DATA_SEND'; code?: number; message: string; uncertain: boolean };

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost' ||
    (net.isIPv4(normalized) && normalized.split('.')[0] === '127')
  );
}

export function parseSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const enabled = String(env.SMTP_ENABLED || '').toLowerCase() === 'true';
  const host = env.SMTP_HOST || '127.0.0.1';
  const port = Number(env.SMTP_PORT) || (String(env.SMTP_SECURE || '').toLowerCase() === 'true' ? 465 : 25);
  const secure = String(env.SMTP_SECURE || '').toLowerCase() === 'true';
  const from = env.SMTP_FROM || 'Starlidigital <alex@outreach.starlidigital.ro>';
  const replyTo = env.SMTP_REPLY_TO || undefined;
  const user = env.SMTP_USER || undefined;
  const pass = env.SMTP_PASS || undefined;

  return { enabled, host, port, secure, from, replyTo, user, pass };
}

export function validateSmtpConfig(config: SmtpConfig): { valid: boolean; error?: string } {
  if (!config.enabled) {
    return { valid: false, error: 'Serviciul SMTP este dezactivat (SMTP_ENABLED=false).' };
  }
  if (!config.host) {
    return { valid: false, error: 'Gazda SMTP nu este configurată (SMTP_HOST lipsește).' };
  }
  if (!config.port || isNaN(config.port) || config.port < 1 || config.port > 65535) {
    return { valid: false, error: `Portul SMTP ${config.port} este invalid.` };
  }
  if (!config.secure && !isLoopbackHost(config.host)) {
    return { valid: false, error: 'Transportul SMTP simplu (fără TLS) este permis strict pe loopback (127.0.0.1 / localhost).' };
  }
  if (!config.from || !/^[^\r\n]+@[^\r\n]+$/.test(config.from.replace(/.*<([^>]+)>.*/, '$1'))) {
    return { valid: false, error: 'Adresa expeditorului SMTP (SMTP_FROM) nu este validă.' };
  }
  return { valid: true };
}

function extractEmailAddress(addr: string): string {
  const match = /<([^>]+)>/.exec(addr);
  if (match) return match[1].trim();
  return addr.trim();
}

export function smtpMessageId(value: string): string {
  const id=value.replace(/^<|>$/g,'');
  if(!/^[^\s<>\r\n]+@[^\s<>\r\n]+$/.test(id))throw new Error('Invalid email message ID');
  return `<${id}>`;
}

export async function sendSmtpMail(
  args: SmtpSendArgs,
  customConfig?: SmtpConfig,
  socketFactory?: (host: string, port: number, secure: boolean) => Promise<net.Socket>
): Promise<SmtpSendResult> {
  const config = customConfig || parseSmtpConfig();
  const validation = validateSmtpConfig(config);
  if (!validation.valid) {
    return {
      success: false,
      stage: 'CONNECT',
      message: validation.error || 'Configurație SMTP invalidă',
      uncertain: false
    };
  }

  const timeoutMs = 15000;
  let socket: net.Socket;

  try {
    if (socketFactory) {
      socket = await socketFactory(config.host, config.port, config.secure);
    } else if (config.secure) {
      socket = tls.connect({
        host: config.host,
        port: config.port,
        timeout: timeoutMs,
        servername: isLoopbackHost(config.host) ? undefined : config.host,
        rejectUnauthorized: true
      });
    } else {
      socket = net.connect({
        host: config.host,
        port: config.port,
        timeout: timeoutMs
      });
    }
  } catch (err: any) {
    return {
      success: false,
      stage: 'CONNECT',
      message: `Eroare conectare socket SMTP: ${err.message}`,
      uncertain: false
    };
  }

  let buffer = '';
  let responseResolver: ((value: { code: number; lines: string[]; full: string }) => void) | null = null;
  let responseRejecter: ((reason: any) => void) | null = null;
  let closed = false;
  let errorOccurred: Error | null = null;

  socket.setTimeout(timeoutMs);

  function cleanup() {
    if (!closed) {
      closed = true;
      socket.on('error', () => {});
      socket.removeAllListeners('data');
      socket.removeAllListeners('timeout');
      socket.removeAllListeners('close');
      try {
        socket.destroy();
      } catch {}
    }
  }

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    checkBuffer();
  });

  socket.on('timeout', () => {
    const err = new Error('Timeout depășit pe conexiunea SMTP (15s)');
    errorOccurred = err;
    if (responseRejecter) {
      responseRejecter(err);
      responseResolver = null;
      responseRejecter = null;
    }
    cleanup();
  });

  socket.on('error', (err) => {
    errorOccurred = err;
    if (responseRejecter) {
      responseRejecter(err);
      responseResolver = null;
      responseRejecter = null;
    }
    cleanup();
  });

  socket.on('close', () => {
    closed = true;
    if (responseRejecter && !errorOccurred) {
      responseRejecter(new Error('Conexiunea SMTP a fost închisă neașteptat'));
      responseResolver = null;
      responseRejecter = null;
    }
  });

  function checkBuffer() {
    if (!responseResolver) return;
    const lines = buffer.split('\r\n');
    if (lines.length > 1) {
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (/^\d{3} /.test(line)) {
          const code = parseInt(line.slice(0, 3), 10);
          const parsedLines = lines.slice(0, i + 1);
          const full = parsedLines.join('\r\n');
          buffer = lines.slice(i + 1).join('\r\n');
          const resolve = responseResolver;
          responseResolver = null;
          responseRejecter = null;
          resolve({ code, lines: parsedLines, full });
          return;
        }
      }
    }
  }

  function readResponse(): Promise<{ code: number; lines: string[]; full: string }> {
    if (errorOccurred) return Promise.reject(errorOccurred);
    if (closed) return Promise.reject(new Error('Conexiunea SMTP este închisă'));

    return new Promise((resolve, reject) => {
      responseResolver = resolve;
      responseRejecter = reject;
      checkBuffer();
    });
  }

  async function sendCommand(cmd: string): Promise<{ code: number; lines: string[]; full: string }> {
    if (errorOccurred) throw errorOccurred;
    if (closed) throw new Error('Conexiunea SMTP este închisă');
    socket.write(cmd + '\r\n');
    return await readResponse();
  }

  let stage: 'CONNECT' | 'EHLO' | 'AUTH' | 'MAIL_FROM' | 'RCPT_TO' | 'DATA_START' | 'DATA_SEND' = 'CONNECT';

  try {
    const greeting = await readResponse();
    if (greeting.code >= 400) {
      cleanup();
      return { success: false, stage: 'CONNECT', code: greeting.code, message: greeting.full, uncertain: false };
    }

    stage = 'EHLO';
    const ehlo = await sendCommand('EHLO starlidigital.local');
    if (ehlo.code >= 400) {
      cleanup();
      return { success: false, stage: 'EHLO', code: ehlo.code, message: ehlo.full, uncertain: false };
    }

    if (config.user && config.pass) {
      stage = 'AUTH';
      const auth = await sendCommand('AUTH LOGIN');
      if (auth.code === 334) {
        await sendCommand(Buffer.from(config.user).toString('base64'));
        const authPass = await sendCommand(Buffer.from(config.pass).toString('base64'));
        if (authPass.code >= 400) {
          cleanup();
          return { success: false, stage: 'AUTH', code: authPass.code, message: authPass.full, uncertain: false };
        }
      } else if (auth.code >= 400) {
        cleanup();
        return { success: false, stage: 'AUTH', code: auth.code, message: auth.full, uncertain: false };
      }
    }

    const fromAddress = extractEmailAddress(args.from || config.from);
    stage = 'MAIL_FROM';
    const mailFrom = await sendCommand(`MAIL FROM:<${fromAddress}>`);
    if (mailFrom.code >= 400) {
      cleanup();
      return { success: false, stage: 'MAIL_FROM', code: mailFrom.code, message: mailFrom.full, uncertain: false };
    }

    const toRecipients = [...new Set(args.to.split(',').map(extractEmailAddress))];
    const ccRecipients=(args.cc || []).map(extractEmailAddress);
    const recipients = [...new Set([...toRecipients,...ccRecipients,...(args.bcc || []).map(extractEmailAddress)])];
    if(!recipients.length||recipients.length>100||recipients.some(address=>!/^[^\s<>@,\r\n]+@[^\s<>@,\r\n]+$/.test(address)))throw new Error('Invalid email recipient list');
    stage = 'RCPT_TO';
    for(const toAddress of recipients){
    const rcptTo = await sendCommand(`RCPT TO:<${toAddress}>`);
    if (rcptTo.code >= 400) {
      cleanup();
      return { success: false, stage: 'RCPT_TO', code: rcptTo.code, message: rcptTo.full, uncertain: false };
    }
    }

    stage = 'DATA_START';
    const dataStart = await sendCommand('DATA');
    if (dataStart.code !== 354) {
      cleanup();
      return { success: false, stage: 'DATA_START', code: dataStart.code, message: dataStart.full, uncertain: false };
    }

    stage = 'DATA_SEND';
    const fromHeader = args.from || config.from;
    const dateHeader = new Date().toUTCString();
    const cleanSubject = args.subject.replace(/[\r\n]+/g, ' ');
    const replyToHeader = config.replyTo ? `Reply-To: ${config.replyTo}\r\n` : '';

    const escapedBody = args.text
      .replace(/\r?\n/g, '\r\n')
      .replace(/^\./gm, '..');

    const rawMessage = [
      `From: ${fromHeader}`,
      `To: ${toRecipients.map(address=>`<${address}>`).join(', ')}`,
      ...(ccRecipients.length?[`Cc: ${ccRecipients.map(address=>`<${address}>`).join(', ')}`]:[]),
      `Subject: =?UTF-8?B?${Buffer.from(cleanSubject, 'utf8').toString('base64')}?=`,
      `Date: ${dateHeader}`,
      `Message-ID: ${smtpMessageId(args.messageId)}`,
      ...(args.inReplyTo ? [`In-Reply-To: ${smtpMessageId(args.inReplyTo)}`] : []),
      ...(args.references?.length ? [`References: ${args.references.slice(-25).map(smtpMessageId).join(' ')}`] : []),
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      replyToHeader.trim(),
      '',
      escapedBody,
      '.'
    ].filter(line => line !== null && line !== undefined).join('\r\n');

    socket.write(rawMessage + '\r\n');
    const dataEnd = await readResponse();

    try {
      socket.write('QUIT\r\n');
    } catch {}
    cleanup();

    if (dataEnd.code === 250) {
      return {
        success: true,
        response: dataEnd.full,
        messageId: args.messageId
      };
    } else {
      return {
        success: false,
        stage: 'DATA_SEND',
        code: dataEnd.code,
        message: dataEnd.full,
        uncertain: false
      };
    }
  } catch (err: any) {
    cleanup();
    const isUncertain = stage === 'DATA_SEND';
    return {
      success: false,
      stage,
      message: err.message || String(err),
      uncertain: isUncertain
    };
  }
}
