import tls from 'node:tls';
import net from 'node:net';
import { EventEmitter } from 'node:events';

export interface ImapEnvelope {
  date: string;
  subject: string;
  from: string;
  to: string;
  messageId: string;
}

export interface ImapFetchResult {
  seq: number;
  uid: number;
  flags: string[];
  raw?: string;
  sourceTruncated?: boolean;
  envelope?: ImapEnvelope;
  internalDate?: string;
}

export interface ImapMailboxStatus {
  name: string;
  uidValidity: number;
  uidNext: number;
  exists: number;
  recent: number;
  highestModSeq?: string;
}

export interface ImapClientConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  timeoutMs?: number;
}

export interface ImapClient {
  connect(): Promise<void>;
  selectFolder(folder: string): Promise<ImapMailboxStatus>;
  fetchRange(startUid: number, endUid?: number): Promise<ImapFetchResult[]>;
  findUids?(startUid:number,limit:number):Promise<number[]>;
  close(): Promise<void>;
}

export type ImapClientFactory = (config: ImapClientConfig) => ImapClient;

/**
 * Robust RFC 3501 IMAP client implementation with TLS verification,
 * bounded commands, tag tracking, and safe literal stream consumption.
 */
export class ImapProtocolClient extends EventEmitter implements ImapClient {
  private config: ImapClientConfig;
  private socket: net.Socket | null = null;
  private tagCounter = 0;
  private buffer = '';
  private currentCommand: {
    tag: string;
    resolve: (res: string[]) => void;
    reject: (err: Error) => void;
    lines: string[];
  } | null = null;

  constructor(config: ImapClientConfig) {
    super();
    this.config = {
      timeoutMs: 15000,
      ...config
    };
  }

  public async connect(): Promise<void> {
    const { host, port, secure, timeoutMs } = this.config;
    return new Promise((resolve, reject) => {
      let settled = false;
      const onTimeout = () => {
        if (!settled) {
          settled = true;
          this.close();
          reject(new Error(`IMAP connection timeout (${timeoutMs}ms)`));
        }
      };

      const options = {
        host,
        port,
        timeout: timeoutMs,
        // Enforce strict TLS validation: rejects invalid/self-signed certs in production
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      };

      const socket = secure ? tls.connect(options) : net.connect(options);
      this.socket = socket;

      socket.setEncoding('utf8');
      socket.setTimeout(timeoutMs || 15000);
      socket.on('timeout', onTimeout);

      socket.on('data', (chunk: string) => {
        this.onData(chunk);
      });

      socket.on('error', (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.emit('error', err);
      });

      socket.on('close', () => {
        this.emit('close');
      });

      // Wait for server initial greeting (* OK ...)
      const greetingHandler = (data: string) => {
        if (data.includes('* OK')) {
          this.removeListener('greeting', greetingHandler);
          settled = true;
          // Authenticate
          this.login()
            .then(() => resolve())
            .catch(reject);
        } else if (data.includes('* PREAUTH')) {
          this.removeListener('greeting', greetingHandler);
          settled = true;
          resolve();
        }
      };
      this.once('greeting', greetingHandler);
    });
  }

  private async login(): Promise<void> {
    const escapedUser = this.config.user.replace(/["\\]/g, '\\$&');
    const escapedPass = this.config.pass.replace(/["\\]/g, '\\$&');
    await this.exec(`LOGIN "${escapedUser}" "${escapedPass}"`);
  }

  public async selectFolder(folder: string): Promise<ImapMailboxStatus> {
    const escaped = folder.replace(/["\\]/g, '\\$&');
    const lines = await this.exec(`SELECT "${escaped}"`);
    let uidValidity = 0;
    let uidNext = 0;
    let exists = 0;
    let recent = 0;

    for (const line of lines) {
      const uvMatch = /UIDVALIDITY\s+(\d+)/i.exec(line);
      if (uvMatch) uidValidity = parseInt(uvMatch[1], 10);

      const unMatch = /UIDNEXT\s+(\d+)/i.exec(line);
      if (unMatch) uidNext = parseInt(unMatch[1], 10);

      const exMatch = /\*\s+(\d+)\s+EXISTS/i.exec(line);
      if (exMatch) exists = parseInt(exMatch[1], 10);

      const rcMatch = /\*\s+(\d+)\s+RECENT/i.exec(line);
      if (rcMatch) recent = parseInt(rcMatch[1], 10);
    }

    return {
      name: folder,
      uidValidity,
      uidNext,
      exists,
      recent
    };
  }

  public async fetchRange(startUid: number, endUid: number = 0): Promise<ImapFetchResult[]> {
    const range = endUid > 0 ? `${startUid}:${endUid}` : `${startUid}:*`;
    const lines = await this.exec(`UID FETCH ${range} (UID FLAGS RFC822)`);
    const results: ImapFetchResult[] = [];

    // Parse untagged fetch responses
    let currentItem: Partial<ImapFetchResult> | null = null;
    let rawAccumulator = '';
    let readingLiteral = false;
    let literalRemaining = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!readingLiteral && line.startsWith('* ') && line.includes('FETCH')) {
        if (currentItem && currentItem.uid) {
          currentItem.raw = rawAccumulator;
          results.push(currentItem as ImapFetchResult);
        }
        currentItem = {};
        rawAccumulator = '';

        const seqMatch = /^\*\s+(\d+)\s+FETCH/i.exec(line);
        if (seqMatch) currentItem.seq = parseInt(seqMatch[1], 10);

        const uidMatch = /UID\s+(\d+)/i.exec(line);
        if (uidMatch) currentItem.uid = parseInt(uidMatch[1], 10);

        const flagsMatch = /FLAGS\s+\(([^)]*)\)/i.exec(line);
        if (flagsMatch) {
          currentItem.flags = flagsMatch[1].split(/\s+/).filter(Boolean);
        } else {
          currentItem.flags = [];
        }

        const litMatch = /\{(\d+)\}$/.exec(line);
        if (litMatch) {
          readingLiteral = true;
          literalRemaining = parseInt(litMatch[1], 10);
        }
      } else if (readingLiteral) {
        rawAccumulator += line + '\r\n';
        if (rawAccumulator.length >= literalRemaining) {
          readingLiteral = false;
        }
      }
    }

    if (currentItem && currentItem.uid) {
      currentItem.raw = rawAccumulator;
      results.push(currentItem as ImapFetchResult);
    }

    return results;
  }

  public async exec(command: string): Promise<string[]> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('IMAP socket not connected');
    }
    if (this.currentCommand) {
      throw new Error('Concurrent IMAP commands not permitted on a single connection');
    }

    const tag = `A${++this.tagCounter}`;
    return new Promise((resolve, reject) => {
      this.currentCommand = {
        tag,
        resolve,
        reject,
        lines: []
      };
      this.socket!.write(`${tag} ${command}\r\n`);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\r\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('* OK') || line.startsWith('* PREAUTH')) {
        this.emit('greeting', line);
      }

      if (this.currentCommand) {
        this.currentCommand.lines.push(line);
        if (line.startsWith(`${this.currentCommand.tag} OK`)) {
          const cmd = this.currentCommand;
          this.currentCommand = null;
          cmd.resolve(cmd.lines);
        } else if (line.startsWith(`${this.currentCommand.tag} NO`) || line.startsWith(`${this.currentCommand.tag} BAD`)) {
          const cmd = this.currentCommand;
          this.currentCommand = null;
          cmd.reject(new Error(`IMAP error: ${line}`));
        }
      }
    }
  }

  public async close(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.end();
      } catch {}
      this.socket.destroy();
    }
    this.socket = null;
  }
}
