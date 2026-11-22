import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { redactSecrets } from '../sanitize.js';
import type { AuthPrincipal } from '../types.js';

export { redactSecrets };

/**
 * Validates and safely resolves a file path within the allowed workspace roots.
 * Strictly prevents path traversal, symlink escapes, and access to secrets.
 */
export async function safePath(
  workspaceRoot: string,
  candidate: string,
  write = false
): Promise<string> {
  const raw = String(candidate ?? '').trim();
  if (!raw || raw.includes('\0') || raw.split(/[\\/]/).includes('..')) {
    throw new Error('Invalid path: path traversal is prohibited.');
  }

  const rootPath = await realpath(workspaceRoot);
  const target = resolve(rootPath, raw);
  const rel = relative(rootPath, target);

  if (!rel || isAbsolute(rel) || rel.startsWith('..')) {
    throw new Error('Invalid path: path lies outside the approved workspace root.');
  }

  const pieces = rel.split(/[\\/]/);
  const lower = rel.toLowerCase();

  // Block sensitive directories and files
  if (
    pieces.some((p) => p.startsWith('.') || /^(?:node_modules|data|private|secrets|credentials|attachments|output)$/i.test(p)) ||
    /(?:\.env|\.sqlite|\.db|\.pem|\.key|\.p12|\.pfx|credentials|production\.env|config\.json$|id_rsa)/i.test(lower)
  ) {
    throw new Error('Access denied: sensitive configuration, secrets, and database files cannot be accessed directly.');
  }

  // Restrict write access to approved source directories
  if (write) {
    const isApprovedWritePath =
      /^(?:server[\\/]src|web[\\/]src|control-plane[\\/]src|scripts|infra|docs)[\\/]/i.test(rel) ||
      (pieces.length === 1 && ['package.json', 'package-lock.json', 'README.md'].includes(basename(target)));

    if (!isApprovedWritePath) {
      throw new Error('Write access denied: modifications are only permitted in approved source directories.');
    }
  }

  // Verify realpath to block symlink escapes
  let actual: string;
  try {
    actual = await realpath(target);
  } catch (error: any) {
    if (!write || error.code !== 'ENOENT') throw error;
    actual = await realpath(resolve(target, '..'));
  }

  const actualRel = relative(rootPath, actual);
  if (isAbsolute(actualRel) || actualRel.startsWith('..')) {
    throw new Error('Access denied: symlinks pointing outside workspace are prohibited.');
  }

  return target;
}

export interface ExecResult {
  exitCode: number | null;
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'CANCELED';
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Bounded command execution with timeout and output capping.
 */
export async function boundedExec(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 30000,
  signal?: AbortSignal
): Promise<ExecResult> {
  const start = Date.now();
  return new Promise((resolveResult) => {
    let stdout = '';
    let stderr = '';
    let status: ExecResult['status'] = 'SUCCEEDED';
    let closed = false;

    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: {
        PATH: process.env.PATH || process.env.Path || '',
        HOME: process.env.HOME || '',
        LANG: 'C.UTF-8',
        SYSTEMROOT: process.env.SYSTEMROOT || '',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      status = 'TIMED_OUT';
      killChild();
    }, timeoutMs);

    const killChild = () => {
      try {
        if (child.pid && process.platform !== 'win32') {
          process.kill(-child.pid, 'SIGTERM');
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        // ignore kill error
      }
    };

    signal?.addEventListener('abort', () => {
      status = 'CANCELED';
      killChild();
    }, { once: true });

    const appendOut = (chunk: Buffer) => {
      if (stdout.length < 16000) {
        stdout += chunk.toString('utf8').slice(0, 16000 - stdout.length);
      }
    };

    const appendErr = (chunk: Buffer) => {
      if (stderr.length < 16000) {
        stderr += chunk.toString('utf8').slice(0, 16000 - stderr.length);
      }
    };

    child.stdout?.on('data', appendOut);
    child.stderr?.on('data', appendErr);

    const finish = (code: number | null) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (status === 'SUCCEEDED' && code !== 0) {
        status = 'FAILED';
      }
      resolveResult({
        exitCode: code,
        status,
        stdout: String(redactSecrets(stdout)),
        stderr: String(redactSecrets(stderr)),
        durationMs,
      });
    };

    child.once('error', (err) => {
      stderr += err.message;
      finish(1);
    });

    child.once('close', (code) => finish(code));
  });
}

/**
 * Validates permission scopes.
 */
export function hasScope(principal: AuthPrincipal, scope: 'read' | 'write' | 'admin'): boolean {
  if (principal.scopes.includes('*')) return true;
  if (scope === 'admin') return principal.role === 'admin' && (principal.scopes.includes('admin') || principal.scopes.includes('*'));
  if (scope === 'write') return principal.scopes.includes('write') || principal.scopes.includes('admin');
  if (scope === 'read') return principal.scopes.includes('read') || principal.scopes.includes('write') || principal.scopes.includes('admin');
  return false;
}
