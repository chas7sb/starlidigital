import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export type RecordData = { id: string; [key: string]: any };
export class Store {
  db: DatabaseSync;
  constructor(path = process.env.DATABASE_PATH || fileURLToPath(new URL('../data/starli.sqlite',import.meta.url))) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL,id TEXT NOT NULL,owner TEXT,payload TEXT NOT NULL,PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS resets (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS records_owner ON records(collection,owner);`);
  }
  list(collection: string, owner?: string): RecordData[] {
    const rows = owner === undefined ? this.db.prepare('SELECT payload FROM records WHERE collection=?').all(collection) : this.db.prepare('SELECT payload FROM records WHERE collection=? AND owner=?').all(collection, owner);
    return rows.map(r => JSON.parse(String(r.payload)));
  }
  get(collection: string, id: string): RecordData | undefined {
    const row = this.db.prepare('SELECT payload FROM records WHERE collection=? AND id=?').get(collection, id);
    return row ? JSON.parse(String(row.payload)) : undefined;
  }
  put(collection: string, value: RecordData, owner?: string) {
    this.db.prepare('INSERT INTO records(collection,id,owner,payload) VALUES (?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET owner=excluded.owner,payload=excluded.payload').run(collection, value.id, owner ?? value.ownerId ?? null, JSON.stringify(value));
    return value;
  }
  remove(collection: string, id: string) { this.db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(collection, id); }
  user(id: string): RecordData | undefined { const row = this.db.prepare('SELECT payload FROM users WHERE id=?').get(id); return row ? JSON.parse(String(row.payload)) : undefined; }
  findUser(username: string): RecordData | undefined { const row = this.db.prepare('SELECT payload FROM users WHERE username=?').get(username); return row ? JSON.parse(String(row.payload)) : undefined; }
  saveUser(user: RecordData) { this.db.prepare('INSERT INTO users(id,username,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(user.id,user.username,JSON.stringify(user)); return user; }
  users() { return this.db.prepare('SELECT payload FROM users').all().map(row => JSON.parse(String(row.payload))); }
  transferGuest(guest: string, user: string) {
    for (const collection of ['conversations','projects']) for (const record of this.list(collection,guest)) this.put(collection,{...record,ownerId:user},user);
  }
  close() { this.db.close(); }
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
