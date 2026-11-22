// Trusted offline bootstrap. Password arrives through stdin, never argv or disk.
import { readFileSync } from 'node:fs';
import { Store, id, now } from '../platform/server/src/store.ts';
import { hashPassword } from '../platform/server/src/security.ts';
import { administratorEmail } from '../platform/server/src/account-identity.ts';
const input = JSON.parse(readFileSync(0, 'utf8'));
process.env.ADMIN_EMAIL = input.email;
if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(input.username) || input.password.length < 14) throw Error('Invalid owner input');
const store = new Store();
try {
  if (store.users().length) throw Error('Platform already contains users; preserved');
  const user = { id: id(), username: input.username, email: administratorEmail(input.username), recoveryEmail: input.email,
    role: 'ADMIN', passwordHash: hashPassword(input.password), createdAt: now() };
  store.saveUser(user);
  process.stdout.write(JSON.stringify({ id: user.id }));
} finally { store.close(); }
