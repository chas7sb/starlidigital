/**
 * Portable Scoped App/Gateway Authority Boundary (GGB1-GEMINI1-INTEGRATION-R4).
 * Fixes R4-08 & R4-09:
 *  - Internal required pinnedStorePath (omitting state.storeFilePath CANNOT bypass missing/replaced checks).
 *  - Durable SQLite bootstrap redemption (single-use jti atomic across fresh instances & process restarts).
 *  - Durable pinned store (dev, ino) history across restarts to detect silent store replacement.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export interface ScopedAuthorityClaims {
  v: 1;
  jti: string;
  companyId: string;
  projectId: string;
  userId: string;
  leaseId: string;
  processGeneration: number;
  audience: 'PRIVATE_SCOPED';
  authorityRevision: number;
  issuedAt: number;
  expiresAt: number;
}

export interface AuthorityStateSnapshot {
  available: boolean;
  storeFilePath?: string;
  revokedJtis: Set<string>;
  revokedUsers: Set<string>;
  activeMemberships: Map<string, { active: boolean; revision: number; role: string }>;
  activeLeases: Map<string, { companyId: string; projectId: string; generation: number; active: boolean }>;
}

export interface VerifyResult {
  ok: boolean;
  status: 200 | 401 | 403;
  code: string;
  claims?: ScopedAuthorityClaims;
}

export class PortableAppAuthority {
  private readonly signingKey: Buffer;
  private readonly pinnedStorePath: string;
  private readonly expectedStoreIdentity: { dev: number; ino: number };
  private readonly redemptionDb: DatabaseSync;

  constructor(opts: { signingKey: Buffer; pinnedStorePath: string; redemptionDbPath?: string }) {
    if (!Buffer.isBuffer(opts.signingKey) || opts.signingKey.length < 32) {
      throw new Error('PORTABLE_AUTHORITY_KEY_TOO_SHORT');
    }
    if (!opts.pinnedStorePath || typeof opts.pinnedStorePath !== 'string') {
      throw new Error('PINNED_STORE_PATH_REQUIRED');
    }
    this.signingKey = Buffer.from(opts.signingKey);
    this.pinnedStorePath = opts.pinnedStorePath;

    const dbPath = opts.redemptionDbPath || `${opts.pinnedStorePath}.redemptions.sqlite`;
    this.redemptionDb = new DatabaseSync(dbPath);
    this.redemptionDb.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS bootstrap_redemptions (
        jti TEXT PRIMARY KEY,
        redeemed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pinned_store_identity (
        store_path TEXT PRIMARY KEY,
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL
      );
    `);

    const st = statSync(this.pinnedStorePath);
    const existing = this.redemptionDb
      .prepare('SELECT dev, ino FROM pinned_store_identity WHERE store_path = ?')
      .get(this.pinnedStorePath) as { dev: number; ino: number } | undefined;

    if (existing) {
      this.expectedStoreIdentity = { dev: Number(existing.dev), ino: Number(existing.ino) };
    } else {
      this.expectedStoreIdentity = { dev: Number(st.dev), ino: Number(st.ino) };
      this.redemptionDb
        .prepare('INSERT OR IGNORE INTO pinned_store_identity (store_path, dev, ino) VALUES (?, ?, ?)')
        .run(this.pinnedStorePath, this.expectedStoreIdentity.dev, this.expectedStoreIdentity.ino);
    }
  }

  close() {
    this.redemptionDb.close();
  }

  private sign(payloadB64: string): string {
    return createHmac('sha256', this.signingKey).update(payloadB64).digest('base64url');
  }

  issueTicket(input: Omit<ScopedAuthorityClaims, 'v' | 'jti' | 'audience'> & { jti?: string }): string {
    const claims: ScopedAuthorityClaims = {
      v: 1,
      jti: input.jti || randomBytes(16).toString('hex'),
      companyId: input.companyId,
      projectId: input.projectId,
      userId: input.userId,
      leaseId: input.leaseId,
      processGeneration: input.processGeneration,
      audience: 'PRIVATE_SCOPED',
      authorityRevision: input.authorityRevision,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    };
    const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  verifyTicket(
    token: string,
    expected: {
      companyId: string;
      projectId: string;
      leaseId: string;
      processGeneration: number;
      nowMs?: number;
      singleUseBootstrap?: boolean;
    },
    state: AuthorityStateSnapshot
  ): VerifyResult {
    if (!state || !state.available) {
      return { ok: false, status: 403, code: 'AUTHORITY_UNAVAILABLE' };
    }

    // R4-08 FIX: Always check internal pinnedStorePath regardless of whether state.storeFilePath is supplied!
    try {
      const st = statSync(this.pinnedStorePath);
      if (Number(st.dev) !== this.expectedStoreIdentity.dev || Number(st.ino) !== this.expectedStoreIdentity.ino) {
        return { ok: false, status: 403, code: 'AUTHORITY_STORE_REPLACED' };
      }
    } catch {
      return { ok: false, status: 403, code: 'AUTHORITY_STORE_MISSING' };
    }

    if (typeof token !== 'string' || !token.includes('.')) {
      return { ok: false, status: 401, code: 'TICKET_MALFORMED' };
    }
    const [body, sig] = token.split('.');
    if (!body || !sig) {
      return { ok: false, status: 401, code: 'TICKET_MALFORMED' };
    }
    const expectedSig = this.sign(body);
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, status: 401, code: 'TICKET_SIGNATURE_INVALID' };
    }

    let claims: ScopedAuthorityClaims;
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, status: 401, code: 'TICKET_PAYLOAD_INVALID' };
    }

    const nowMs = expected.nowMs ?? Date.now();
    if (
      claims.v !== 1 ||
      claims.audience !== 'PRIVATE_SCOPED' ||
      !claims.jti ||
      typeof claims.issuedAt !== 'number' ||
      typeof claims.expiresAt !== 'number' ||
      claims.expiresAt <= claims.issuedAt
    ) {
      return { ok: false, status: 401, code: 'TICKET_CLAIMS_INVALID' };
    }
    if (claims.expiresAt <= nowMs) {
      return { ok: false, status: 401, code: 'TICKET_EXPIRED' };
    }
    if (claims.issuedAt > nowMs + 60_000) {
      return { ok: false, status: 401, code: 'TICKET_FUTURE_ISSUED' };
    }

    if (claims.companyId !== expected.companyId || claims.projectId !== expected.projectId) {
      return { ok: false, status: 403, code: 'CROSS_TENANT_DENIED' };
    }
    if (claims.leaseId !== expected.leaseId || claims.processGeneration !== expected.processGeneration) {
      return { ok: false, status: 403, code: 'LEASE_OR_GENERATION_MISMATCH' };
    }

    if (state.revokedJtis.has(claims.jti) || state.revokedUsers.has(claims.userId)) {
      return { ok: false, status: 403, code: 'AUTHORITY_REVOKED' };
    }

    const memberKey = `${claims.companyId}:${claims.userId}`;
    const membership = state.activeMemberships.get(memberKey);
    if (!membership || !membership.active || membership.revision !== claims.authorityRevision) {
      return { ok: false, status: 403, code: 'MEMBERSHIP_OR_REVISION_STALE' };
    }

    const lease = state.activeLeases.get(claims.leaseId);
    if (
      !lease ||
      !lease.active ||
      lease.companyId !== claims.companyId ||
      lease.projectId !== claims.projectId ||
      lease.generation !== claims.processGeneration
    ) {
      return { ok: false, status: 403, code: 'LEASE_INACTIVE_OR_MISMATCH' };
    }

    // R4-09 FIX: Durable atomic single-use bootstrap redemption across instances & restarts
    if (expected.singleUseBootstrap) {
      const res = this.redemptionDb
        .prepare('INSERT OR IGNORE INTO bootstrap_redemptions (jti, redeemed_at) VALUES (?, ?)')
        .run(claims.jti, nowMs);
      if (res.changes !== 1) {
        return { ok: false, status: 403, code: 'TICKET_REPLAYED' };
      }
    }

    return { ok: true, status: 200, code: 'OK', claims };
  }
}
