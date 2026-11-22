// Trusted App Authority interface + FIXTURE_APP_AUTHORITY (GGB1-GEMINI3-APP-AUTHORITY-R5).
// Preserves full context bindings through ticket -> app session -> resolve -> write admission.
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrincipalKind } from '../contracts/app-contracts.ts';

export type AuthorityKind =
  | 'FIXTURE_APP_AUTHORITY'
  | 'GROKBOT1_NATIVE_ADAPTER'
  | 'REMOTE_NATIVE_AUTHORITY'
  | 'REMOTE_FIXTURE_AUTHORITY';

export type ExecutionClass = 'FIXTURE' | 'NATIVE_NONPRODUCTION' | 'COMBINED_CANDIDATE';

export interface Actor {
  sessionHash: string;
  companyId: string;
  projectId: string;
  subjectId: string;
  principalKind: PrincipalKind;
  role?: string;
  scope: string[];
  authorizationRevision: number;
  expiresAt: string;
  artifactDigest: string;
  leaseId: string;
  processGeneration?: number;
  audience?: 'PRIVATE_SCOPED';
  ticketJti?: string;
  authorityEpoch?: number;
}

export interface WriteAdmissionReceipt {
  admitted: true;
  authorizationRevision: number;
  processGeneration: number;
  checkedAt: string;
}

export interface BootstrapSessionResult {
  sessionToken: string;
  expiresAt: string;
  csrfToken?: string;
  actor?: Actor;
}

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, msg: string) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

export interface TrustedAppAuthority {
  readonly kind: AuthorityKind;
  readonly executionClass?: ExecutionClass;
  resolve(sessionToken: string | undefined): Actor | Promise<Actor>;
  csrfToken(actor: Actor): string | Promise<string>;
  verifyCsrf(actor: Actor, token: string | undefined): boolean | Promise<boolean>;
  assertWriteAdmission(actor: Actor): WriteAdmissionReceipt | void | Promise<WriteAdmissionReceipt | void>;
  bootstrapSession?(ticket: string): Promise<BootstrapSessionResult>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function ensureAuthoritySchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS fx_memberships (
    company_id TEXT NOT NULL, project_id TEXT NOT NULL, subject_id TEXT NOT NULL,
    principal_kind TEXT NOT NULL, scope TEXT NOT NULL, authorization_revision INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, project_id, subject_id)
  );
  CREATE TABLE IF NOT EXISTS fx_sessions (
    session_hash TEXT PRIMARY KEY, company_id TEXT NOT NULL, project_id TEXT NOT NULL,
    subject_id TEXT NOT NULL, authorization_revision INTEGER NOT NULL, csrf_secret TEXT NOT NULL,
    issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
    artifact_digest TEXT NOT NULL, lease_id TEXT NOT NULL,
    process_generation INTEGER NOT NULL DEFAULT 1, audience TEXT NOT NULL DEFAULT 'PRIVATE_SCOPED'
  );`);
}

export class FixtureAppAuthority implements TrustedAppAuthority {
  readonly kind = 'FIXTURE_APP_AUTHORITY' as const;
  readonly executionClass = 'FIXTURE' as const;
  private db: DatabaseSync;
  private release: { artifactDigest: string; leaseId: string; processGeneration?: number } | null;

  constructor(db: DatabaseSync, release: { artifactDigest: string; leaseId: string; processGeneration?: number } | null = null) {
    this.db = db;
    this.release = release;
    ensureAuthoritySchema(db);
  }

  issue(p: {
    companyId: string; projectId: string; subjectId: string; principalKind: PrincipalKind;
    scope: string[]; ttlSeconds: number; artifactDigest: string; leaseId: string; processGeneration?: number;
  }) {
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const m = db.prepare('SELECT authorization_revision, revoked FROM fx_memberships WHERE company_id=? AND project_id=? AND subject_id=?').get(p.companyId, p.projectId, p.subjectId) as { authorization_revision: number; revoked: number } | undefined;
      let rev = m ? Number(m.authorization_revision) : 1;
      if (!m) db.prepare('INSERT INTO fx_memberships VALUES (?,?,?,?,?,?,0)').run(p.companyId, p.projectId, p.subjectId, p.principalKind, p.scope.join(','), rev);
      else if (m.revoked) { rev += 1; db.prepare('UPDATE fx_memberships SET revoked=0, authorization_revision=?, scope=?, principal_kind=? WHERE company_id=? AND project_id=? AND subject_id=?').run(rev, p.scope.join(','), p.principalKind, p.companyId, p.projectId, p.subjectId); }
      const token = randomBytes(32).toString('base64url');
      const issued = new Date();
      const exp = new Date(issued.getTime() + p.ttlSeconds * 1000);
      if (!/^[a-f0-9]{64}$/.test(p.artifactDigest) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(p.leaseId)) throw new AuthError(400, 'BAD_INPUT', 'artifactDigest/leaseId binding required');
      const gen = p.processGeneration ?? 1;
      db.prepare('INSERT INTO fx_sessions (session_hash, company_id, project_id, subject_id, authorization_revision, csrf_secret, issued_at, expires_at, revoked, artifact_digest, lease_id, process_generation, audience) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?)')
        .run(sha(token), p.companyId, p.projectId, p.subjectId, rev, randomBytes(32).toString('base64url'), issued.toISOString(), exp.toISOString(), p.artifactDigest, p.leaseId, gen, 'PRIVATE_SCOPED');
      db.exec('COMMIT');
      return { token, authorizationRevision: rev, expiresAt: exp.toISOString(), artifactDigest: p.artifactDigest, leaseId: p.leaseId, processGeneration: gen };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  revoke(companyId: string, projectId: string, subjectId: string) {
    const r = this.db.prepare('UPDATE fx_memberships SET revoked=1, authorization_revision=authorization_revision+1 WHERE company_id=? AND project_id=? AND subject_id=?').run(companyId, projectId, subjectId);
    return { changed: Number(r.changes) };
  }

  resolve(token: string | undefined): Actor {
    if (!token || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) throw new AuthError(401, 'UNAUTHENTICATED', 'App session required');
    const r = this.db.prepare(`SELECT s.session_hash, s.company_id, s.project_id, s.subject_id, s.authorization_revision AS srev, s.expires_at, s.revoked AS srevoked, s.artifact_digest, s.lease_id, s.process_generation, s.audience, m.principal_kind, m.scope, m.authorization_revision AS mrev, m.revoked AS mrevoked
      FROM fx_sessions s JOIN fx_memberships m ON m.company_id=s.company_id AND m.project_id=s.project_id AND m.subject_id=s.subject_id WHERE s.session_hash=?`).get(sha(token)) as Record<string, unknown> | undefined;
    if (!r) throw new AuthError(401, 'UNAUTHENTICATED', 'Unknown app session');
    if (Date.parse(String(r.expires_at)) <= Date.now()) throw new AuthError(401, 'UNAUTHENTICATED', 'App session expired');
    if (Number(r.srevoked) || Number(r.mrevoked) || Number(r.srev) !== Number(r.mrev)) throw new AuthError(403, 'REVOKED', 'App authority revoked');
    if (!this.release) throw new AuthError(401, 'UNAUTHENTICATED', 'No serving release bound');
    if (String(r.artifact_digest) !== this.release.artifactDigest) throw new AuthError(403, 'RELEASE_MISMATCH', 'App session was issued for a different release artifact');
    if (String(r.lease_id) !== this.release.leaseId) throw new AuthError(403, 'LEASE_MISMATCH', 'App session was issued for a different compute lease');
    const gen = Number(r.process_generation ?? 1);
    if (this.release.processGeneration !== undefined && gen !== this.release.processGeneration) throw new AuthError(403, 'GENERATION_MISMATCH', 'App session was issued for a different process generation');
    if (String(r.audience ?? 'PRIVATE_SCOPED') !== 'PRIVATE_SCOPED') throw new AuthError(403, 'AUDIENCE_MISMATCH', 'Invalid audience');
    return {
      artifactDigest: String(r.artifact_digest), leaseId: String(r.lease_id), processGeneration: gen,
      audience: 'PRIVATE_SCOPED', sessionHash: String(r.session_hash), companyId: String(r.company_id),
      projectId: String(r.project_id), subjectId: String(r.subject_id),
      principalKind: String(r.principal_kind) as PrincipalKind, scope: String(r.scope).split(',').filter(Boolean),
      authorizationRevision: Number(r.mrev), expiresAt: String(r.expires_at),
    };
  }

  private secret(actor: Actor) {
    const r = this.db.prepare('SELECT csrf_secret FROM fx_sessions WHERE session_hash=?').get(actor.sessionHash) as { csrf_secret: string } | undefined;
    if (!r) throw new AuthError(401, 'UNAUTHENTICATED', 'session vanished');
    return r.csrf_secret;
  }

  csrfToken(actor: Actor) {
    return createHmac('sha256', this.secret(actor)).update(`csrf:${actor.sessionHash}:${actor.authorizationRevision}`).digest('base64url');
  }

  verifyCsrf(actor: Actor, token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return false;
    const a = Buffer.from(this.csrfToken(actor));
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  assertWriteAdmission(actor: Actor): WriteAdmissionReceipt {
    const m = this.db.prepare('SELECT authorization_revision, revoked, scope FROM fx_memberships WHERE company_id=? AND project_id=? AND subject_id=?').get(actor.companyId, actor.projectId, actor.subjectId) as { authorization_revision: number; revoked: number; scope: string } | undefined;
    if (!m || m.revoked || Number(m.authorization_revision) !== actor.authorizationRevision) throw new AuthError(403, 'REVOKED', 'Authority changed before commit');
    if (!m.scope.split(',').includes('dog:write')) throw new AuthError(403, 'FORBIDDEN', 'dog:write required');
    return { admitted: true, authorizationRevision: Number(m.authorization_revision), processGeneration: actor.processGeneration ?? 1, checkedAt: new Date().toISOString() };
  }
}
