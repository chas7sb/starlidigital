/**
 * Portable Scoped App/Gateway Authority Boundary (GGB1-GEMINI3-APP-AUTHORITY-R5).
 * Fixes R4-08-HISTORY-LOSS while preserving R4-08 path-pin and R4-09 cross-OS-process atomic redemption:
 *  - Explicit first provisioning (PortableAppAuthority.provision) separated from normal startup (PortableAppAuthority.open).
 *  - Separate anchor file (authority-anchor.json) pins (dev, ino) of BOTH the native authority store AND redemption DB,
 *    plus authorityId and keyEpoch.
 *  - Missing or replaced redemption/history DB fails closed (AUTHORITY_HISTORY_MISSING / AUTHORITY_HISTORY_REPLACED)
 *    and is NEVER auto-recreated on normal startup.
 *  - Explicit recovery (PortableAppAuthority.recover) increments keyEpoch and rotates authorityId, deriving a new
 *    epoch signing key via HMAC-SHA256(masterKey, "starli-epoch:v1:" + authorityId + ":" + keyEpoch) so ALL old
 *    bootstrap tickets are cryptographically invalidated even with the same masterKey.
 *  - Caller-supplied Map/Set snapshots or available=true booleans CANNOT establish authority.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AuthError } from './authority.ts';

export interface ScopedAuthorityClaims {
  v: 2;
  jti: string;
  authorityId: string;
  keyEpoch: number;
  companyId: string;
  projectId: string;
  userId: string;
  role: string;
  scope: string[];
  leaseId: string;
  processGeneration: number;
  artifactDigest: string;
  audience: 'PRIVATE_SCOPED';
  authorityRevision: number;
  nativeTokenHash: string;
  nativeFamilyHash: string;
  nativeExp: number | null;
  issuedAt: number;
  expiresAt: number;
}

export interface AuthorityAnchor {
  schema: 'starli.authority-anchor.v1';
  authorityId: string;
  keyEpoch: number;
  pinnedStorePath: string;
  pinnedStoreDev: number;
  pinnedStoreIno: number;
  redemptionDbPath: string;
  redemptionDbDev: number;
  redemptionDbIno: number;
  provisionedAt: string;
  recoveredAt: string | null;
}

export interface VerifyResult {
  ok: boolean;
  status: 200 | 401 | 403;
  code: string;
  claims?: ScopedAuthorityClaims;
}

export type LiveAuthorityValidator = (claims: ScopedAuthorityClaims) => { ok: true } | { ok: false; status: 401 | 403; code: string };

function deriveEpochKey(masterKey: Buffer, authorityId: string, keyEpoch: number): Buffer {
  return createHmac('sha256', masterKey)
    .update(`starli-epoch:v1:${authorityId}:${keyEpoch}`)
    .digest();
}

function normalizeMasterKey(masterKey: Buffer | string): Buffer {
  const buf = Buffer.isBuffer(masterKey) ? Buffer.from(masterKey) : Buffer.from(masterKey, 'utf8');
  if (buf.length < 32) throw new Error('PORTABLE_AUTHORITY_KEY_TOO_SHORT');
  return buf;
}

function initRedemptionDb(
  redemptionDbPath: string,
  authorityId: string,
  keyEpoch: number,
  pinnedStorePath: string,
  pinnedDev: number,
  pinnedIno: number,
  nowIso: string
) {
  const db = new DatabaseSync(redemptionDbPath);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS authority_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        authority_id TEXT NOT NULL,
        key_epoch INTEGER NOT NULL,
        provisioned_at TEXT NOT NULL
      );
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
    db.prepare('INSERT OR REPLACE INTO authority_meta (id, authority_id, key_epoch, provisioned_at) VALUES (1, ?, ?, ?)').run(
      authorityId, keyEpoch, nowIso
    );
    db.prepare('INSERT OR REPLACE INTO pinned_store_identity (store_path, dev, ino) VALUES (?, ?, ?)').run(
      pinnedStorePath, pinnedDev, pinnedIno
    );
  } finally {
    db.close();
  }
}

export class PortableAppAuthority {
  readonly anchorPath: string;
  readonly pinnedStorePath: string;
  readonly redemptionDbPath: string;
  readonly authorityId: string;
  readonly keyEpoch: number;
  private readonly epochSigningKey: Buffer;
  private readonly anchor: AuthorityAnchor;
  private readonly redemptionDb: DatabaseSync;

  private constructor(
    anchorPath: string,
    anchor: AuthorityAnchor,
    masterKey: Buffer,
    redemptionDb: DatabaseSync
  ) {
    this.anchorPath = anchorPath;
    this.anchor = anchor;
    this.pinnedStorePath = anchor.pinnedStorePath;
    this.redemptionDbPath = anchor.redemptionDbPath;
    this.authorityId = anchor.authorityId;
    this.keyEpoch = anchor.keyEpoch;
    this.epochSigningKey = deriveEpochKey(masterKey, anchor.authorityId, anchor.keyEpoch);
    this.redemptionDb = redemptionDb;
  }

  /** Explicit first provisioning ? separated from normal service startup. */
  static provision(opts: {
    stateDir: string;
    masterKey: Buffer | string;
    pinnedStorePath: string;
    redemptionDbPath?: string;
    anchorPath?: string;
  }): AuthorityAnchor {
    normalizeMasterKey(opts.masterKey);
    const stateDir = resolve(opts.stateDir);
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const anchorPath = resolve(opts.anchorPath || join(stateDir, 'authority-anchor.json'));
    const redemptionDbPath = resolve(opts.redemptionDbPath || join(stateDir, 'redemptions.sqlite'));
    const pinnedStorePath = resolve(opts.pinnedStorePath);

    if (existsSync(anchorPath)) {
      throw new AuthError(409, 'AUTHORITY_ALREADY_PROVISIONED', 'Authority already provisioned; use explicit recover() to rotate epoch');
    }
    if (!existsSync(pinnedStorePath)) {
      throw new AuthError(400, 'AUTHORITY_STORE_MISSING', 'Pinned authority store must exist before provisioning');
    }
    const pinnedStat = statSync(pinnedStorePath);
    const authorityId = randomBytes(16).toString('hex');
    const keyEpoch = 1;
    const nowIso = new Date().toISOString();

    mkdirSync(dirname(redemptionDbPath), { recursive: true, mode: 0o700 });
    initRedemptionDb(redemptionDbPath, authorityId, keyEpoch, pinnedStorePath, Number(pinnedStat.dev), Number(pinnedStat.ino), nowIso);
    const redStat = statSync(redemptionDbPath);

    const anchor: AuthorityAnchor = {
      schema: 'starli.authority-anchor.v1',
      authorityId,
      keyEpoch,
      pinnedStorePath,
      pinnedStoreDev: Number(pinnedStat.dev),
      pinnedStoreIno: Number(pinnedStat.ino),
      redemptionDbPath,
      redemptionDbDev: Number(redStat.dev),
      redemptionDbIno: Number(redStat.ino),
      provisionedAt: nowIso,
      recoveredAt: null,
    };
    writeFileSync(anchorPath, JSON.stringify(anchor, null, 2) + '\n', { mode: 0o600 });
    return anchor;
  }

  /** Explicit recovery: increments keyEpoch and rotates authorityId, invalidating ALL pre-recovery tickets. */
  static recover(opts: {
    stateDir: string;
    masterKey: Buffer | string;
    pinnedStorePath: string;
    redemptionDbPath?: string;
    anchorPath?: string;
  }): AuthorityAnchor {
    normalizeMasterKey(opts.masterKey);
    const stateDir = resolve(opts.stateDir);
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const anchorPath = resolve(opts.anchorPath || join(stateDir, 'authority-anchor.json'));
    const redemptionDbPath = resolve(opts.redemptionDbPath || join(stateDir, 'redemptions.sqlite'));
    const pinnedStorePath = resolve(opts.pinnedStorePath);

    if (!existsSync(pinnedStorePath)) {
      throw new AuthError(400, 'AUTHORITY_STORE_MISSING', 'Pinned authority store must exist for recovery');
    }

    let prevEpoch = 1;
    let provisionedAt = new Date().toISOString();
    if (existsSync(anchorPath)) {
      try {
        const prev = JSON.parse(readFileSync(anchorPath, 'utf8')) as Partial<AuthorityAnchor>;
        if (typeof prev.keyEpoch === 'number' && prev.keyEpoch >= 1) prevEpoch = prev.keyEpoch;
        if (typeof prev.provisionedAt === 'string') provisionedAt = prev.provisionedAt;
      } catch { /* corrupt anchor still forces epoch bump */ }
    }

    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(redemptionDbPath + suffix)) rmSync(redemptionDbPath + suffix, { force: true });
    }

    const pinnedStat = statSync(pinnedStorePath);
    const authorityId = randomBytes(16).toString('hex');
    const keyEpoch = prevEpoch + 1;
    const nowIso = new Date().toISOString();

    mkdirSync(dirname(redemptionDbPath), { recursive: true, mode: 0o700 });
    initRedemptionDb(redemptionDbPath, authorityId, keyEpoch, pinnedStorePath, Number(pinnedStat.dev), Number(pinnedStat.ino), nowIso);
    const redStat = statSync(redemptionDbPath);

    const anchor: AuthorityAnchor = {
      schema: 'starli.authority-anchor.v1',
      authorityId,
      keyEpoch,
      pinnedStorePath,
      pinnedStoreDev: Number(pinnedStat.dev),
      pinnedStoreIno: Number(pinnedStat.ino),
      redemptionDbPath,
      redemptionDbDev: Number(redStat.dev),
      redemptionDbIno: Number(redStat.ino),
      provisionedAt,
      recoveredAt: nowIso,
    };
    writeFileSync(anchorPath, JSON.stringify(anchor, null, 2) + '\n', { mode: 0o600 });
    return anchor;
  }

  /** Normal service startup: NEVER auto-creates missing anchor or missing redemption history DB. */
  static open(opts: {
    stateDir: string;
    masterKey: Buffer | string;
    pinnedStorePath?: string;
    anchorPath?: string;
  }): PortableAppAuthority {
    const masterKey = normalizeMasterKey(opts.masterKey);
    const stateDir = resolve(opts.stateDir);
    const anchorPath = resolve(opts.anchorPath || join(stateDir, 'authority-anchor.json'));

    if (!existsSync(anchorPath)) {
      throw new AuthError(403, 'AUTHORITY_NOT_PROVISIONED', 'Authority anchor missing; run explicit provision first');
    }
    let anchor: AuthorityAnchor;
    try {
      anchor = JSON.parse(readFileSync(anchorPath, 'utf8')) as AuthorityAnchor;
    } catch {
      throw new AuthError(403, 'AUTHORITY_ANCHOR_CORRUPT', 'Authority anchor unreadable');
    }
    if (anchor.schema !== 'starli.authority-anchor.v1' || !anchor.authorityId || !Number.isSafeInteger(anchor.keyEpoch)) {
      throw new AuthError(403, 'AUTHORITY_ANCHOR_CORRUPT', 'Authority anchor schema invalid');
    }
    if (opts.pinnedStorePath && resolve(opts.pinnedStorePath) !== anchor.pinnedStorePath) {
      throw new AuthError(403, 'AUTHORITY_STORE_PATH_MISMATCH', 'Configured pinned store path does not match provisioned anchor');
    }

    if (!existsSync(anchor.redemptionDbPath)) {
      throw new AuthError(403, 'AUTHORITY_HISTORY_MISSING', 'Previously initialized redemption/history DB is missing (fail closed; explicit recovery required)');
    }
    let redStat;
    try {
      redStat = statSync(anchor.redemptionDbPath);
    } catch {
      throw new AuthError(403, 'AUTHORITY_HISTORY_MISSING', 'Redemption/history DB stat failed');
    }
    if (Number(redStat.dev) !== anchor.redemptionDbDev || Number(redStat.ino) !== anchor.redemptionDbIno) {
      throw new AuthError(403, 'AUTHORITY_HISTORY_REPLACED', 'Redemption/history DB was replaced outside explicit recovery');
    }

    let db: DatabaseSync;
    try {
      db = new DatabaseSync(anchor.redemptionDbPath);
      db.exec('PRAGMA busy_timeout = 5000;');
      const meta = db.prepare('SELECT authority_id, key_epoch FROM authority_meta WHERE id = 1').get() as { authority_id: string; key_epoch: number } | undefined;
      if (!meta || meta.authority_id !== anchor.authorityId || Number(meta.key_epoch) !== anchor.keyEpoch) {
        db.close();
        throw new AuthError(403, 'AUTHORITY_HISTORY_MISMATCH', 'Redemption DB epoch/identity does not match anchor');
      }
      const pinRow = db.prepare('SELECT dev, ino FROM pinned_store_identity WHERE store_path = ?').get(anchor.pinnedStorePath) as { dev: number; ino: number } | undefined;
      if (!pinRow || Number(pinRow.dev) !== anchor.pinnedStoreDev || Number(pinRow.ino) !== anchor.pinnedStoreIno) {
        db.close();
        throw new AuthError(403, 'AUTHORITY_HISTORY_MISMATCH', 'Pinned store record in redemption DB does not match anchor');
      }
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError(403, 'AUTHORITY_HISTORY_CORRUPT', 'Redemption/history DB corrupt or unreadable');
    }

    return new PortableAppAuthority(anchorPath, anchor, masterKey, db);
  }

  close() {
    try { this.redemptionDb.close(); } catch { /* already closed */ }
  }

  /** Live filesystem + anchor integrity check executed on EVERY protected operation. */
  verifyHistoryIntegrity(): { ok: true } | { ok: false; status: 403; code: string } {
    try {
      const liveAnchor = JSON.parse(readFileSync(this.anchorPath, 'utf8')) as AuthorityAnchor;
      if (liveAnchor.authorityId !== this.authorityId || liveAnchor.keyEpoch !== this.keyEpoch) {
        return { ok: false, status: 403, code: 'AUTHORITY_EPOCH_CHANGED' };
      }
    } catch {
      return { ok: false, status: 403, code: 'AUTHORITY_ANCHOR_MISSING' };
    }

    try {
      const rSt = statSync(this.redemptionDbPath);
      if (Number(rSt.dev) !== this.anchor.redemptionDbDev || Number(rSt.ino) !== this.anchor.redemptionDbIno) {
        return { ok: false, status: 403, code: 'AUTHORITY_HISTORY_REPLACED' };
      }
    } catch {
      return { ok: false, status: 403, code: 'AUTHORITY_HISTORY_MISSING' };
    }

    try {
      const sSt = statSync(this.pinnedStorePath);
      if (Number(sSt.dev) !== this.anchor.pinnedStoreDev || Number(sSt.ino) !== this.anchor.pinnedStoreIno) {
        return { ok: false, status: 403, code: 'AUTHORITY_STORE_REPLACED' };
      }
    } catch {
      return { ok: false, status: 403, code: 'AUTHORITY_STORE_MISSING' };
    }

    return { ok: true };
  }

  private sign(payloadB64: string): string {
    return createHmac('sha256', this.epochSigningKey).update(payloadB64).digest('base64url');
  }

  issueTicket(input: Omit<ScopedAuthorityClaims, 'v' | 'jti' | 'audience' | 'authorityId' | 'keyEpoch'> & { jti?: string }): { ticket: string; claims: ScopedAuthorityClaims } {
    const integrity = this.verifyHistoryIntegrity();
    if (!integrity.ok) throw new AuthError(403, integrity.code, integrity.code);
    const claims: ScopedAuthorityClaims = {
      v: 2,
      jti: input.jti || randomBytes(16).toString('hex'),
      authorityId: this.authorityId,
      keyEpoch: this.keyEpoch,
      companyId: input.companyId,
      projectId: input.projectId,
      userId: input.userId,
      role: input.role,
      scope: [...input.scope],
      leaseId: input.leaseId,
      processGeneration: input.processGeneration,
      artifactDigest: input.artifactDigest,
      audience: 'PRIVATE_SCOPED',
      authorityRevision: input.authorityRevision,
      nativeTokenHash: input.nativeTokenHash,
      nativeFamilyHash: input.nativeFamilyHash,
      nativeExp: input.nativeExp,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    };
    const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    return { ticket: `${body}.${this.sign(body)}`, claims };
  }

  verifyTicket(
    token: string,
    expected: {
      companyId: string;
      projectId: string;
      leaseId: string;
      processGeneration: number;
      artifactDigest: string;
      nowMs?: number;
      singleUseBootstrap?: boolean;
    },
    liveValidator?: LiveAuthorityValidator
  ): VerifyResult {
    const integrity = this.verifyHistoryIntegrity();
    if (!integrity.ok) {
      return { ok: false, status: 403, code: integrity.code };
    }

    if (typeof token !== 'string' || !token.includes('.')) {
      return { ok: false, status: 401, code: 'TICKET_MALFORMED' };
    }
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, status: 401, code: 'TICKET_MALFORMED' };
    }
    const [body, sig] = parts;
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
      claims.v !== 2 ||
      claims.audience !== 'PRIVATE_SCOPED' ||
      !claims.jti ||
      typeof claims.issuedAt !== 'number' ||
      typeof claims.expiresAt !== 'number' ||
      claims.expiresAt <= claims.issuedAt ||
      !Array.isArray(claims.scope) ||
      !claims.nativeTokenHash ||
      !claims.nativeFamilyHash
    ) {
      return { ok: false, status: 401, code: 'TICKET_CLAIMS_INVALID' };
    }
    if (claims.authorityId !== this.authorityId || claims.keyEpoch !== this.keyEpoch) {
      return { ok: false, status: 403, code: 'AUTHORITY_EPOCH_MISMATCH' };
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
    if (claims.artifactDigest !== expected.artifactDigest) {
      return { ok: false, status: 403, code: 'RELEASE_MISMATCH' };
    }

    if (liveValidator) {
      const live = liveValidator(claims);
      if (!live.ok) {
        return { ok: false, status: live.status, code: live.code };
      }
    }

    if (expected.singleUseBootstrap) {
      try {