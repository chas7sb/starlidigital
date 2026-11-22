// GROKBOT1_NATIVE_ADAPTER — app authority backed by grokbot1's published native identity adapter.
// Execution class: NATIVE_NONPRODUCTION (disposable native v33 DBs, SYNTHETIC_DISPOSABLE_NATIVE_USER).
//
// Grant (launcher / trusted gateway only): native JWT (env GB3_NATIVE_JWT, never argv/cookie to the app)
//   -> native-bridge/gb3_native_bridge.py verify (imports grokbot1 Grokbot1Service.native_session +
//      native v33 decode_token / assert_session_allowed / current_user role / Authority.effective)
//   -> app-scoped opaque session (nx_sessions) bound to artifactDigest + leaseId + native token hash +
//      native session-family hash + native membership revision. The JWT itself is never stored.
// Every request AND inside the write transaction (live, fail closed):
//   native company-authority members row must still be active, kind=person, same revision;
//   native session-revocations store must not contain the token hash or the session family.
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, type Actor, type TrustedAppAuthority } from './authority.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const NATIVE_PYTHON = process.env.GB3_NATIVE_PYTHON || '/opt/starlidigital/webui-runtime/bin/python';
export const BRIDGE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'native-bridge', 'gb3_native_bridge.py');
const WRITE_ROLES = new Set(['owner', 'admin', 'member']);

export type NativeVerdict = { ok: true; nativeUserId: string; companyId: string; role: string; kind: string; membershipRevision: number; scope: string[]; nativeTokenHash: string; nativeFamilyHash: string; nativeExp: number | null; nativeAuthorityDb: string; nativeRevocationDb: string; pins: Record<string, string> };

/** Run grokbot1-adapter verification in the disposable native root (JWT passed via env only). */
export function verifyNativeJwt(nativeRoot: string, companyId: string, jwt: string): NativeVerdict {
  let stdout = '';
  try {
    stdout = execFileSync(NATIVE_PYTHON, ['-B', BRIDGE, 'verify', '--root', nativeRoot, '--company', companyId], { env: { PATH: '/usr/bin:/bin', GB3_NATIVE_JWT: jwt }, encoding: 'utf8', timeout: 45000, maxBuffer: 1 << 20 });
  } catch (e) {
    const out = String((e as { stdout?: string }).stdout || '');
    let v: { status?: number; error?: string } = {}; try { v = JSON.parse(out.trim().split('\n').pop() || '{}'); } catch { /* */ }
    throw new AuthError(v.status === 401 ? 401 : 403, v.error || 'NATIVE_VERIFY_FAILED', 'native identity verification failed');
  }
  const v = JSON.parse(stdout.trim().split('\n').pop() || '{}');
  if (!v.ok) throw new AuthError(403, 'NATIVE_VERIFY_FAILED', 'native identity verification failed');
  return v as NativeVerdict;
}

export function ensureNativeSessionSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS nx_sessions (session_hash TEXT PRIMARY KEY, company_id TEXT NOT NULL, project_id TEXT NOT NULL, native_user_id TEXT NOT NULL,
    role TEXT NOT NULL, scope TEXT NOT NULL, membership_revision INTEGER NOT NULL, native_token_hash TEXT NOT NULL, native_family_hash TEXT NOT NULL,
    csrf_secret TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, artifact_digest TEXT NOT NULL, lease_id TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);`);
}

export class NativeAppAuthority implements TrustedAppAuthority {
  readonly kind = 'GROKBOT1_NATIVE_ADAPTER' as const;
  private db: DatabaseSync; private release: { artifactDigest: string; leaseId: string } | null;
  private authorityPath: string; private revocationPath: string;
  constructor(db: DatabaseSync, nativeRoot: string, release: { artifactDigest: string; leaseId: string } | null = null) {
    this.db = db; this.release = release; ensureNativeSessionSchema(db);
    this.authorityPath = join(resolve(nativeRoot), 'data', 'company-authority.sqlite3');
    this.revocationPath = join(resolve(nativeRoot), 'state', 'session-revocations.sqlite');
  }
  /** Launcher-only. Native verdict must come from verifyNativeJwt in this process. */
  grant(v: NativeVerdict, p: { projectId: string; ttlSeconds: number; artifactDigest: string; leaseId: string }) {
    if (!/^[a-f0-9]{64}$/.test(p.artifactDigest) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(p.leaseId)) throw new AuthError(400, 'BAD_INPUT', 'artifactDigest/leaseId binding required');
    const issued = new Date();
    let expMs = issued.getTime() + p.ttlSeconds * 1000;
    if (v.nativeExp) expMs = Math.min(expMs, v.nativeExp * 1000); // never outlive the native session
    if (expMs <= issued.getTime()) throw new AuthError(401, 'NATIVE_SESSION_EXPIRED', 'native session expired');
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO nx_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)').run(sha(token), v.companyId, p.projectId, v.nativeUserId, v.role, v.scope.join(','), v.membershipRevision, v.nativeTokenHash, v.nativeFamilyHash,
      randomBytes(32).toString('base64url'), issued.toISOString(), new Date(expMs).toISOString(), p.artifactDigest, p.leaseId);
    return { token, nativeUserId: v.nativeUserId, role: v.role, scope: v.scope, membershipRevision: v.membershipRevision, expiresAt: new Date(expMs).toISOString(), artifactDigest: p.artifactDigest, leaseId: p.leaseId };
  }
  /** Live native check (fail closed on any storage error). */
  private liveNative(companyId: string, uid: string, membershipRevision: number, tokenHash: string, familyHash: string): string {
    if (!existsSync(this.authorityPath)) throw new AuthError(403, 'NATIVE_AUTHORITY_UNAVAILABLE', 'native authority store unavailable');
    let role = '';
    try {
      const a = new DatabaseSync(this.authorityPath, { readOnly: true });
      try {
        const m = a.prepare('SELECT role, active, revision, kind FROM members WHERE company_id=? AND user_id=?').get(companyId, uid) as { role: string; active: number; revision: number; kind: string } | undefined;
        if (!m || Number(m.active) !== 1 || m.kind !== 'person' || Number(m.revision) !== membershipRevision) throw new AuthError(403, 'REVOKED', 'Native membership changed');
        role = m.role;
      } finally { a.close(); }
      if (existsSync(this.revocationPath)) {
        const r = new DatabaseSync(this.revocationPath, { readOnly: true });
        try {
          const hit = r.prepare('SELECT 1 FROM revoked_sessions WHERE token_hash=?').get(tokenHash)
            || r.prepare('SELECT 1 FROM revoked_session_families WHERE family_hash=? AND native_user_id=?').get(familyHash, uid);
          if (hit) throw new AuthError(403, 'REVOKED', 'Native session revoked');
        } finally { r.close(); }
      }
    } catch (e) { if (e instanceof AuthError) throw e; throw new AuthError(403, 'NATIVE_AUTHORITY_UNAVAILABLE', 'native authority check failed'); }
    return role;
  }
  resolve(token: string | undefined): Actor {
    if (!token || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) throw new AuthError(401, 'UNAUTHENTICATED', 'App session required');
    const r = this.db.prepare('SELECT * FROM nx_sessions WHERE session_hash=?').get(sha(token)) as Record<string, unknown> | undefined;
    if (!r) throw new AuthError(401, 'UNAUTHENTICATED', 'Unknown app session');
    if (Date.parse(String(r.expires_at)) <= Date.now()) throw new AuthError(401, 'UNAUTHENTICATED', 'App session expired');
    if (Number(r.revoked)) throw new AuthError(403, 'REVOKED', 'App session revoked');
    if (!this.release) throw new AuthError(401, 'UNAUTHENTICATED', 'No serving release bound');
    if (String(r.artifact_digest) !== this.release.artifactDigest) throw new AuthError(403, 'RELEASE_MISMATCH', 'App session was issued for a different release artifact');
    if (String(r.lease_id) !== this.release.leaseId) throw new AuthError(403, 'LEASE_MISMATCH', 'App session was issued for a different compute lease');
    const role = this.liveNative(String(r.company_id), String(r.native_user_id), Number(r.membership_revision), String(r.native_token_hash), String(r.native_family_hash));
    const scope = ['dog:read'].concat(WRITE_ROLES.has(role) ? ['dog:write'] : []).filter(s => String(r.scope).split(',').includes(s));
    return { artifactDigest: String(r.artifact_digest), leaseId: String(r.lease_id), sessionHash: String(r.session_hash), companyId: String(r.company_id), projectId: String(r.project_id), subjectId: String(r.native_user_id),
      principalKind: 'VERIFIED_REGISTERED_PERSON', scope, authorizationRevision: Number(r.membership_revision), expiresAt: String(r.expires_at) };
  }
  private secret(actor: Actor) { const r = this.db.prepare('SELECT csrf_secret FROM nx_sessions WHERE session_hash=?').get(actor.sessionHash) as { csrf_secret: string } | undefined; if (!r) throw new AuthError(401, 'UNAUTHENTICATED', 'session vanished'); return r.csrf_secret; }
  csrfToken(actor: Actor) { return createHmac('sha256', this.secret(actor)).update(`csrf:${actor.sessionHash}:${actor.authorizationRevision}`).digest('base64url'); }
  verifyCsrf(actor: Actor, token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return false;
    const a = Buffer.from(this.csrfToken(actor)), b = Buffer.from(token); return a.length === b.length && timingSafeEqual(a, b);
  }
  /** Inside the app write txn: re-read native authority (read check; cross-DB, not one atomic txn). */
  assertWriteAdmission(actor: Actor) {
    const r = this.db.prepare('SELECT native_token_hash, native_family_hash, revoked FROM nx_sessions WHERE session_hash=?').get(actor.sessionHash) as { native_token_hash: string; native_family_hash: string; revoked: number } | undefined;
    if (!r || Number(r.revoked)) throw new AuthError(403, 'REVOKED', 'App session revoked before commit');
    const role = this.liveNative(actor.companyId, actor.subjectId, actor.authorizationRevision, r.native_token_hash, r.native_family_hash);
    if (!WRITE_ROLES.has(role)) throw new AuthError(403, 'FORBIDDEN', 'dog:write required');
  }
}
