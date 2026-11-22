import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const password = process.env.OPENPENCIL_PASSWORD;
const username = process.env.OPENPENCIL_USERNAME || 'admin';
if (!password || password.length < 16) throw new Error('Set OPENPENCIL_PASSWORD with at least 16 characters');
if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) throw new Error('Invalid OPENPENCIL_USERNAME');
process.umask(0o077);
for (const name of ['state', 'documents']) await mkdir(resolve(root, name), { recursive: true, mode: 0o700 });
await writeFile(resolve(root, 'state/config.json'), JSON.stringify({
  username, password, mcpToken: randomBytes(32).toString('hex'), sessionKey: randomBytes(32).toString('hex')
}), { flag: 'wx', mode: 0o600 });
console.log('Created fresh private OpenPencil configuration. Existing configuration is never overwritten.');
