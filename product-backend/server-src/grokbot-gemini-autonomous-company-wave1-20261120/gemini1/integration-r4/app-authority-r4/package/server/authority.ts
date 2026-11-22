// Trusted app-authority adapter boundary. The generated app only ever sees an
// app-scoped opaque session cookie; platform cookies/keys are never shipped.
// FixtureAppAuthority is the disposable FIXTURE stand-in for Grokbot1's native
// adapter (PROVISIONAL_TRUSTED_CONTEXT_V1). It is NOT native identity.
import type { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrincipalKind } from '../contracts/app-contracts.ts';

export type Actor = { artifactDigest: string; leaseId: string; sessionHash: string; companyId: string; projectId: string; subjectId: string; principalKind: PrincipalKind; scope: string[]; authorizationRevision: number; expiresAt: string };
export class AuthError extends Error { status: number; code: string; constructor(status: number, code: string, msg: string) { super(msg); this.status = status; this.code = code; } }

export interface TrustedAppAuthority {
  readonly kind: 'FIXTURE_APP_AUTHORITY' | 'GROKBOT1_NATIVE_ADAPTER';
  resolve(sessionToken: string | undefined): Actor | Promise<Actor>;           // throws AuthError 401/403
  csrfToken(actor: Actor): string | Promise<string>;
  verifyCsrf(actor: Actor, token: string | undefined): boolean | Promise<boolean>;
  assertWriteAdmission(actor: Actor): void | Promise<void>;                    // sync inside txn or awaited before txn
  bootstrapSession?(ticket: string): Promise<{ sessionToken: string; expiresAt: string }>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function ensureAuthoritySchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS fx_memberships (company_id TEXT NOT NULL, project_id TEXT NOT NULL, subject_id TEXT NOT NULL, principal_kind TEXT NOT NULL, scope TEXT NOT NULL, authorization_revision INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, project_id, subject_id));
  CREATE TABLE IF NOT EXISTS fx_sessions (session_hash TEXT PRIMARY KEY, company_id TEXT NOT NULL, project_id TEXT NOT NULL, subject_id TEXT NOT NULL, authorization_revision INTEGER NOT NULL, csrf_secret TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, artifact_digest TEXT NOT NULL, lease_id TEXT NOT NULL);`);
}

export class FixtureAppAuthority implements TrustedAppAuthority {
  readonly kind = 'FIXTURE_APP_AUTHORITY' as const;
  private db: DatabaseSync; private release: { artifactDigest: string; leaseId: string } | null;
  /** release = the serving process's verified artifactDigest + compute leaseId; null only for launcher CLI use. */
  constructor(db: DatabaseSync, release: { artifactDigest: string; leaseId: string } | null = null) { this.db = db; this.release = release; ensureAuthoritySchema(db); }

  /** Launcher-only (CLI). Returns the raw token once; only its hash is stored. */
  issue(p: { companyId: string; projectId: string; subjectId: string; principalKind: PrincipalKind; scope: string[]; ttlSeconds: number; artifactDigest: string; leaseId: string }) {
    const db = this.db; db.exec('BEGIN IMMEDIATE');
    try {
      const m = db.prepare('SELECT authorization_revision, revoked FROM fx_memberships WHERE company_id=? AND project_id=? AND subject_id=?').get(p.companyId, p.projectId, p.subjectId) as { authorization_revision: number; revoked: number } | undefined;
      let rev = m ? Number(m.authorization_revision) : 1;
      if (!m) db.prepare('INSERT INTO fx_memberships VALUES (?,?,?,?,?,?,0)').run(p.companyId, p.projectId, p.subjectId, p.principalKind, p.scope.join(','), rev);
      else if (m.revoked) { rev += 1; db.prepare('UPDATE fx_memberships SET revoked=0, authorization_revision=?, scope=?, principal_kind=? WHERE company_id=? AND project_id=? AND subject_id=?').run(rev, p.scope.join(','), p.principalKind, p.companyId, p.projectId, p.subjectId); }
      const token = randomBytes(32).toString('base64url');
      const issued = new Date(); const exp = new Date(issued.getTime() + p.ttlSeconds * 1000);
      if (!/^[a-f0-9]{64}$/.test(p.artifactDigest) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(p.leaseId)) throw new AuthError(400, 'BAD_INPUT', 'artifactDigest/leaseId binding required');
      db.prepare('INSERT INTO fx_sessions VALUES (?,?,?,?,?,?,?,?,0,?,?)').run(sha(token), p.companyId, p.projectId, p.subjectId, rev, randomBytes(32).toString('base64url'), issued.toISOString(), exp.toISOString(), p.artifactDigest, p.leaseId);
      db.exec('COMMIT');
      return { token, authorizationRevision: rev, expiresAt: exp.toISOString(), artifactDigest: p.artifactDigest, leaseId: p.leaseId };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  /** Revoke membership: bumps authorization_revision so every existing session fails closed. */
  revoke(companyId: string, projectId: string, subjectId: string) {
    const r = this.db.prepare('UPDATE fx_memberships SET revoked=1, authorization_revision=authorization_revision+1 WHERE company_id=? AND project_id=? AND subject_id=?').run(companyId, projectId, subjectId);
    return { changed: Number(r.changes) };
  }
  resolve(token: string | undefined): Actor {
    if (!token || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) throw new AuthError(401, 'UNAUTHENTICATED', 'App session required');
    const r = this.db.prepare(`SELECT s.session_hash, s.company_id, s.project_id, s.subject_id, s.authorization_revision AS srev, s.expires_at, s.revoked AS srevoked, s.artifact_digest, s.lease_id, m.principal_kind, m.scope, m.authorization_revision AS mrev, m.revoked AS mrevoked
      FROM fx_sessions s JOIN fx_memberships m ON m.company_id=s.company_id AND m.project_id=s.project_id AND m.subject_id=s.subject_id WHERE s.session_hash=?`).get(sha(token)) as Record<string, unknown> | undefined;
    if (!r) throw new AuthError(401, 'UNAUTHENTICATED', 'Unknown app session');
    if (Date.parse(String(r.expires_at)) <= Date.now()) throw new AuthError(401, 'UNAUTHENTICATED', 'App session expired');
    if (Number(r.srevoked) || Number(r.mrevoked) || Number(r.srev) !== Number(r.mrev)) throw new AuthError(403, 'REVOKED', 'App authority revoked');
    if (!this.release) throw new AuthError(401, 'UNAUTHENTICATED', 'No serving release bound');
    if (String(r.artifact_digest) !== this.release.artifactDigest) throw new AuthError(403, 'RELEASE_MISMATCH', 'App session was issued for a different release artifact');
    if (String(r.lease_id) !== this.release.leaseId) throw new AuthError(403, 'LEASE_MISMATCH', 'App session was issued for a different compute lease');
    return { artifactDigest: String(r.artifact_digest), leaseId: String(r.lease_id), sessionHash: String(r.session_hash), companyId: String(r.company_id), projectId: String(r.project_id), subjectId: String(r.subject_id),
      principalKind: String(r.principal_kind) as PrincipalKind, scope: String(r.scope).split(',').filter(Boolean), authorizationRevision: Number(r.mrev), expiresAt: String(r.expires_at) };
  }
  private secret(actor: Actor) { const r = this.db.prepare('SELECT csrf_secret FROM fx_sessions WHERE session_hash=?').get(actor.sessionHash) as { csrf_secret: string } | undefined; if (!r) throw new AuthError(401, 'UNAUTHENTICATED', 'session vanished'); return r.csrf_secret; }
  csrfToken(actor: Actor) { return createHmac('sha256', this.secret(actor)).update(`csrf:${actor.sessionHash}:${actor.authorizationRevision}`).digest('base64url'); }
  verifyCsrf(actor: Actor, token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return false;
    const a = Buffer.from(this.csrfToken(actor)), b = Buffer.from(token); return a.length === b.length && timingSafeEqual(a, b);
  }
  assertWriteAdmission(actor: Actor) {
    const m = this.db.prepare('SELECT authorization_revision, revoked, scope FROM fx_memberships WHERE company_id=? AND project_id=? AND subject_id=?').get(actor.companyId, actor.projectId, actor.subjectId) as { authorization_revision: number; revoked: number; scope: string } | undefined;
    if (!m || m.revoked || Number(m.authorization_revision) !== actor.authorizationRevision) throw new AuthError(403, 'REVOKED', 'Authority changed before commit');
    if (!m.scope.split(',').includes('dog:write')) throw new AuthError(403, 'FORBIDDEN', 'dog:write required');
  }
}
