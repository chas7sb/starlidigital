import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry, AuditSink } from './types.js';

export class SqliteAuditSink implements AuditSink {
  private db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS mcp_audit (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        client_ip TEXT,
        tool TEXT NOT NULL,
        target TEXT,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        sanitized_args TEXT,
        sanitized_result TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_time ON mcp_audit (timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_tool ON mcp_audit (tool, status);
    `);
  }

  record(entry: AuditEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO mcp_audit (
        id, timestamp, principal_id, client_ip, tool, target,
        duration_ms, status, sanitized_args, sanitized_result, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.timestamp,
      entry.principalId,
      entry.clientIp ?? null,
      entry.tool,
      entry.target ?? null,
      entry.durationMs,
      entry.status,
      entry.sanitizedArgs ? JSON.stringify(entry.sanitizedArgs) : null,
      entry.sanitizedResult ? JSON.stringify(entry.sanitizedResult) : null,
      entry.error ?? null
    );
  }

  list(limit = 100): AuditEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM mcp_audit ORDER BY timestamp DESC LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      principalId: r.principal_id,
      clientIp: r.client_ip ?? undefined,
      tool: r.tool,
      target: r.target ?? undefined,
      durationMs: Number(r.duration_ms),
      status: r.status,
      sanitizedArgs: r.sanitized_args ? JSON.parse(r.sanitized_args) : undefined,
      sanitizedResult: r.sanitized_result ? JSON.parse(r.sanitized_result) : undefined,
      error: r.error ?? undefined,
    }));
  }

  close() {
    this.db.close();
  }
}
