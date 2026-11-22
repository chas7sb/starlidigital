/**
 * Canonical Compute Lease Registry (GGB1-GEMINI3-APP-AUTHORITY-R5).
 * Lives strictly on the trusted host. Opened read-only on every live authority check
 * so missing, unreadable, corrupt, inactive, or generation-mismatched leases fail closed.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { AuthError } from './authority.ts';

export interface LeaseRecord {
  leaseId: string;
  companyId: string;
  projectId: string;
  artifactDigest: string;
  processGeneration: number;
  active: boolean;
  revokedAt: string | null;
  updatedAt: string;
}

export class CanonicalLeaseStore {
  readonly dbPath: string;

  constructor(dbPath: string) {
    if (!dbPath || typeof dbPath !== 'string') throw new Error('LEASE_DB_PATH_REQUIRED');
    this.dbPath = dbPath;
  }

  static provision(dbPath: string): CanonicalLeaseStore {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS compute_leases (
          lease_id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          artifact_digest TEXT NOT NULL,
          process_generation INTEGER NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          revoked_at TEXT,
          updated_at TEXT NOT NULL
        );
      `);
    } finally {
      db.close();
    }
    return new CanonicalLeaseStore(dbPath);
  }

  registerLease(input: {
    leaseId: string;
    companyId: string;
    projectId: string;
    artifactDigest: string;
    processGeneration: number;
  }): LeaseRecord {
    const now = new Date().toISOString();
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec('PRAGMA busy_timeout = 5000;');
      db.prepare(`
        INSERT INTO compute_leases (lease_id, company_id, project_id, artifact_digest, process_generation, active, revoked_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, NULL, ?)
        ON CONFLICT(lease_id) DO UPDATE SET
          company_id=excluded.company_id,
          project_id=excluded.project_id,
          artifact_digest=excluded.artifact_digest,
          process_generation=excluded.process_generation,
          active=1,
          revoked_at=NULL,
          updated_at=excluded.updated_at
      `).run(input.leaseId, input.companyId, input.projectId, input.artifactDigest, input.processGeneration, now);
    } finally {
      db.close();
    }
    return { ...input, active: true, revokedAt: null, updatedAt: now };
  }

  deactivateLease(leaseId: string): { changed: number; revokedAt: string } {
    const now = new Date().toISOString();
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec('PRAGMA busy_timeout = 5000;');
      const r = db.prepare('UPDATE compute_leases SET active = 0, revoked_at = ?, updated_at = ? WHERE lease_id = ?').run(now, now, leaseId);
      return { changed: Number(r.changes), revokedAt: now };
    } finally {
      db.close();
    }
  }

  /** Live read-only check on every protected operation. Fails closed on any missing/corrupt/inactive state. */
  assertActiveLease(
    leaseId: string,
    expected: { companyId: string; projectId: string; artifactDigest: string; processGeneration: number }
  ): LeaseRecord {
    if (!existsSync(this.dbPath)) {
      throw new AuthError(403, 'LEASE_REGISTRY_UNAVAILABLE', 'Canonical lease registry missing');
    }
    let row: Record<string, unknown> | undefined;
    try {
      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        row = db.prepare(
          'SELECT lease_id, company_id, project_id, artifact_digest, process_generation, active, revoked_at, updated_at FROM compute_leases WHERE lease_id = ?'
        ).get(leaseId) as Record<string, unknown> | undefined;
      } finally {
        db.close();
      }
    } catch {
      throw new AuthError(403, 'LEASE_REGISTRY_UNAVAILABLE', 'Canonical lease registry unreadable');
    }
    if (!row || Number(row.active) !== 1) {
      throw new AuthError(403, 'LEASE_INACTIVE_OR_MISMATCH', 'Compute lease is inactive or unknown');
    }
    if (
      String(row.company_id) !== expected.companyId ||
      String(row.project_id) !== expected.projectId ||
      String(row.artifact_digest) !== expected.artifactDigest ||
      Number(row.process_generation) !== expected.processGeneration
    ) {
      throw new AuthError(403, 'LEASE_INACTIVE_OR_MISMATCH', 'Compute lease binding mismatch');
    }
    return {
      leaseId: String(row.lease_id),
      companyId: String(row.company_id),
      projectId: String(row.project_id),
      artifactDigest: String(row.artifact_digest),
      processGeneration: Number(row.process_generation),
      active: true,
      revokedAt: row.revoked_at ? String(row.revoked_at) : null,
      updatedAt: String(row.updated_at),
    };
  }
}
