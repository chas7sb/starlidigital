// grokbot3 storage adapters. SQLITE_DISK_TEST_FIXTURE is real on-disk persistence
// for disposable tests ONLY; it is never relabelled as managed NoSQL.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type Scope = { companyId: string; projectId: string };
export type Dog = { id: string; name: string; breed: string; ageYears: number | null; notes: string; revision: number; createdAt: string; createdBy: string; appRevision: number };
export type NewDog = { name: string; breed: string; ageYears: number | null; notes: string };
export type CreateInput = Scope & { subjectId: string; key: string; fingerprint: string; dog: NewDog; requestId: string; authorizationRevision?:number; processGeneration?:number; appRevision: number; maxDogs: number; maxWritesPerMinute: number };
export type CreateResult = { status: number; body: { dog: Dog; replayed: boolean } };
export class StoreError extends Error { status: number; code: string; constructor(status: number, code: string, msg: string) { super(msg); this.status = status; this.code = code; } }

export interface DogStore {
  readonly engine: 'SQLITE_DISK_TEST_FIXTURE' | 'MONGODB_REPLICA_SET';
  readonly productionEligible: boolean;
  schemaVersion(): number;
  list(scope: Scope): Promise<Dog[]>;
  /** admission() is invoked INSIDE the write transaction to re-check current authority (revocation fence). */
  create(input: CreateInput, admission: () => void): Promise<CreateResult>;
  close(): void;
}

export const LATEST_SCHEMA = 2;
const MIGRATIONS: Record<number, { up: string[]; down: string[] }> = {
  1: { up: [
    `CREATE TABLE dogs (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, breed TEXT NOT NULL DEFAULT '', age_years INTEGER, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT NOT NULL, app_revision INTEGER NOT NULL, request_id TEXT NOT NULL)`,
    `CREATE INDEX dogs_scope ON dogs(company_id, project_id, created_at)`,
    `CREATE TABLE idempotency (company_id TEXT NOT NULL, project_id TEXT NOT NULL, subject_id TEXT NOT NULL, idem_key TEXT NOT NULL, fingerprint TEXT NOT NULL, status_code INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (company_id, project_id, subject_id, idem_key))`,
    `CREATE TABLE write_log (company_id TEXT NOT NULL, project_id TEXT NOT NULL, subject_id TEXT NOT NULL, at_ms INTEGER NOT NULL)`,
    `CREATE INDEX write_log_subject ON write_log(subject_id, at_ms)`],
    down: [`DROP TABLE write_log`, `DROP TABLE idempotency`, `DROP TABLE dogs`] },
  2: { up: [`ALTER TABLE dogs ADD COLUMN notes TEXT NOT NULL DEFAULT ''`], down: [`ALTER TABLE dogs DROP COLUMN notes`] },
};

export function openSqlite(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_events (at TEXT NOT NULL, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, actor TEXT NOT NULL)`);
  return db;
}
export function sqliteVersion(db: DatabaseSync): number { return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version); }

/** Transactional migrate up to target (default latest). Each step: DDL + user_version + event in one IMMEDIATE txn. */
export function migrateSqlite(db: DatabaseSync, target = LATEST_SCHEMA, actor = 'grokbot3-cli'): { from: number; to: number } {
  const from = sqliteVersion(db);
  if (from > LATEST_SCHEMA) throw new StoreError(503, 'STORAGE_UNAVAILABLE', `unknown schema ${from}`);
  for (let v = from + 1; v <= target; v++) step(db, v - 1, v, MIGRATIONS[v].up, actor);
  return { from, to: sqliteVersion(db) };
}
/** Explicit rollback; requires approve=true (destructive for the newer columns). */
export function rollbackSqlite(db: DatabaseSync, target: number, approve: boolean, actor = 'grokbot3-cli'): { from: number; to: number } {
  const from = sqliteVersion(db);
  if (!approve) throw new StoreError(400, 'BAD_INPUT', 'rollback requires --approve');
  if (target < 0 || target >= from) throw new StoreError(400, 'BAD_INPUT', `invalid rollback target ${target} from ${from}`);
  for (let v = from; v > target; v--) step(db, v, v - 1, MIGRATIONS[v].down, actor);
  return { from, to: sqliteVersion(db) };
}
function step(db: DatabaseSync, from: number, to: number, ddl: string[], actor: string) {
  db.exec('BEGIN IMMEDIATE');
  try { for (const s of ddl) db.exec(s); db.exec(`PRAGMA user_version=${to}`);
    db.prepare('INSERT INTO schema_events VALUES (?,?,?,?)').run(new Date().toISOString(), from, to, actor); db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export class SqliteDogStore implements DogStore {
  readonly engine = 'SQLITE_DISK_TEST_FIXTURE' as const;
  readonly productionEligible = false;
  private db: DatabaseSync; private requiredSchema: number;
  constructor(db: DatabaseSync, requiredSchema: number) {
    this.db = db; this.requiredSchema = requiredSchema; db.exec('CREATE TABLE IF NOT EXISTS authority_fence (company_id TEXT,project_id TEXT,revision INTEGER,generation INTEGER,PRIMARY KEY(company_id,project_id))');
    const v = sqliteVersion(db);
    if (v !== requiredSchema) throw new StoreError(503, 'STORAGE_UNAVAILABLE', `schema ${v} != required ${requiredSchema}; run migrate`);
  }
  schemaVersion() { return sqliteVersion(this.db); }
  private row(r: Record<string, unknown>): Dog {
    return { id: String(r.id), name: String(r.name), breed: String(r.breed), ageYears: r.age_years == null ? null : Number(r.age_years),
      notes: this.requiredSchema >= 2 ? String(r.notes ?? '') : '', revision: Number(r.revision), createdAt: String(r.created_at), createdBy: String(r.created_by), appRevision: Number(r.app_revision) };
  }
  async list(s: Scope): Promise<Dog[]> {
    return (this.db.prepare('SELECT * FROM dogs WHERE company_id=? AND project_id=? ORDER BY created_at, id').all(s.companyId, s.projectId) as Record<string, unknown>[]).map(r => this.row(r));
  }
  async create(i: CreateInput, admission: () => void): Promise<CreateResult> {
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      if(i.authorizationRevision!==undefined && i.processGeneration!==undefined){const f=db.prepare('SELECT revision,generation FROM authority_fence WHERE company_id=? AND project_id=?').get(i.companyId,i.projectId) as any;if(f && (i.authorizationRevision<f.revision || i.processGeneration<f.generation))throw new StoreError(403,'STALE_ADMISSION','Stale authority admission');db.prepare('INSERT INTO authority_fence VALUES (?,?,?,?) ON CONFLICT(company_id,project_id) DO UPDATE SET revision=MAX(revision,excluded.revision),generation=MAX(generation,excluded.generation)').run(i.companyId,i.projectId,i.authorizationRevision,i.processGeneration);}
      admission(); // revocation / membership fence inside the same transaction
      const prev = db.prepare('SELECT fingerprint, response_json FROM idempotency WHERE company_id=? AND project_id=? AND subject_id=? AND idem_key=?').get(i.companyId, i.projectId, i.subjectId, i.key) as { fingerprint: string; response_json: string } | undefined;
      if (prev) {
        if (prev.fingerprint !== i.fingerprint) throw new StoreError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key reused with a different request');
        db.exec('COMMIT'); const body = JSON.parse(prev.response_json); return { status: 200, body: { dog: body.dog, replayed: true } };
      }
      const now = Date.now();
      const writes = Number((db.prepare('SELECT COUNT(*) AS n FROM write_log WHERE subject_id=? AND company_id=? AND project_id=? AND at_ms>?').get(i.subjectId, i.companyId, i.projectId, now - 60_000) as { n: number }).n);
      if (writes >= i.maxWritesPerMinute) throw new StoreError(429, 'RATE_LIMITED', 'Write rate limit reached');
      const count = Number((db.prepare('SELECT COUNT(*) AS n FROM dogs WHERE company_id=? AND project_id=?').get(i.companyId, i.projectId) as { n: number }).n);
      if (count >= i.maxDogs) throw new StoreError(429, 'QUOTA_EXCEEDED', `Project dog quota (${i.maxDogs}) reached`);
      const id = 'dog_' + randomUUID(); const at = new Date(now).toISOString();
      if (this.requiredSchema >= 2)
        db.prepare('INSERT INTO dogs (id,company_id,project_id,name,breed,age_years,revision,created_at,created_by,app_revision,request_id,notes) VALUES (?,?,?,?,?,?,1,?,?,?,?,?)').run(id, i.companyId, i.projectId, i.dog.name, i.dog.breed, i.dog.ageYears, at, i.subjectId, i.appRevision, i.requestId, i.dog.notes);
      else
        db.prepare('INSERT INTO dogs (id,company_id,project_id,name,breed,age_years,revision,created_at,created_by,app_revision,request_id) VALUES (?,?,?,?,?,?,1,?,?,?,?)').run(id, i.companyId, i.projectId, i.dog.name, i.dog.breed, i.dog.ageYears, at, i.subjectId, i.appRevision, i.requestId);
      const dog = this.row(db.prepare('SELECT * FROM dogs WHERE id=?').get(id) as Record<string, unknown>); // actual committed row
      db.prepare('INSERT INTO write_log VALUES (?,?,?,?)').run(i.companyId, i.projectId, i.subjectId, now);
      db.prepare('INSERT INTO idempotency VALUES (?,?,?,?,?,?,?,?)').run(i.companyId, i.projectId, i.subjectId, i.key, i.fingerprint, 201, JSON.stringify({ dog }), at);
      db.exec('COMMIT');
      return { status: 201, body: { dog, replayed: false } };
    } catch (e) { try { db.exec('ROLLBACK'); } catch { /* already closed */ } throw e; }
  }
  close() { this.db.close(); }
}

/**
 * MongoDB replica-set adapter (Prisma/NoSQL target). SOURCE_ONLY / UNTESTED in this wave:
 * no `mongodb` driver or `@prisma/client` is installed in the workspace and no :27017 listener
 * or approved managed instance exists. It fails closed (STORAGE_UNAVAILABLE) instead of
 * substituting SQLite. Uses a multi-document transaction for idempotency+quota+insert.
 */
export class MongoDogStore implements DogStore {
  readonly engine = 'MONGODB_REPLICA_SET' as const;
  // UNTESTED: driver installed + import/compile-checked only; no mongod exists on the server (Boss: never download one).
  // Stays false until a real replica-set acceptance run passes.
  readonly productionEligible = false;
  private client: any; private dbName: string;
  private constructor(client: any, dbName: string) { this.client = client; this.dbName = dbName; }
  static async connect(uri: string, dbName: string): Promise<MongoDogStore> {
    const modName = 'mongodb';
    let mod: any;
    try { mod = await import(modName); } catch { throw new StoreError(503, 'STORAGE_UNAVAILABLE', 'mongodb driver not installed (UNTESTED adapter)'); }
    const client = new mod.MongoClient(uri, { serverSelectionTimeoutMS: 3000, retryWrites: true, w: 'majority' });
    let hello: any;
    try { await client.connect(); hello = await client.db('admin').command({ hello: 1 }); }
    catch { try { await client.close(); } catch { /* */ } throw new StoreError(503, 'STORAGE_UNAVAILABLE', 'mongodb unreachable (fail closed, no fallback)'); }
    if (!hello.setName) { await client.close(); throw new StoreError(503, 'STORAGE_UNAVAILABLE', 'replica set required for transactions'); }
    const s = new MongoDogStore(client, dbName);
    const db = client.db(dbName);
    await db.collection('dogs').createIndex({ companyId: 1, projectId: 1, createdAt: 1 });
    await db.collection('idempotency').createIndex({ companyId: 1, projectId: 1, subjectId: 1, key: 1 }, { unique: true });
    return s;
  }
  schemaVersion() { return LATEST_SCHEMA; }
  async list(s: Scope): Promise<Dog[]> {
    const rows = await this.client.db(this.dbName).collection('dogs').find({ companyId: s.companyId, projectId: s.projectId }).sort({ createdAt: 1, _id: 1 }).toArray();
    return rows.map((r: any) => ({ id: r._id, name: r.name, breed: r.breed, ageYears: r.ageYears ?? null, notes: r.notes ?? '', revision: r.revision, createdAt: r.createdAt, createdBy: r.createdBy, appRevision: r.appRevision }));
  }
  async create(i: CreateInput, admission: () => void): Promise<CreateResult> {
    const session = this.client.startSession(); let out: CreateResult | null = null;
    try {
      await session.withTransaction(async () => {
        admission();
        const db = this.client.db(this.dbName);
        const prev = await db.collection('idempotency').findOne({ companyId: i.companyId, projectId: i.projectId, subjectId: i.subjectId, key: i.key }, { session });
        if (prev) { if (prev.fingerprint !== i.fingerprint) throw new StoreError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key reused'); out = { status: 200, body: { dog: prev.dog, replayed: true } }; return; }
        const n = await db.collection('dogs').countDocuments({ companyId: i.companyId, projectId: i.projectId }, { session });
        if (n >= i.maxDogs) throw new StoreError(429, 'QUOTA_EXCEEDED', 'quota');
        const dog: Dog = { id: 'dog_' + randomUUID(), ...i.dog, revision: 1, createdAt: new Date().toISOString(), createdBy: i.subjectId, appRevision: i.appRevision };
        await db.collection('dogs').insertOne({ _id: dog.id, companyId: i.companyId, projectId: i.projectId, requestId: i.requestId, ...dog }, { session });
        await db.collection('idempotency').insertOne({ companyId: i.companyId, projectId: i.projectId, subjectId: i.subjectId, key: i.key, fingerprint: i.fingerprint, dog }, { session });
        out = { status: 201, body: { dog, replayed: false } };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
    if (!out) throw new StoreError(503, 'STORAGE_UNAVAILABLE', 'transaction produced no result');
    return out;
  }
  close() { void this.client.close(); }
}
