// grokbot3 DogLove service CLI: start | migrate | rollback | issue-session | issue-native-session | revoke | status
// Runs with plain `node` (Node >= 24 type stripping) — no tsx/compiler in the serving tier.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { openSqlite, migrateSqlite, rollbackSqlite, sqliteVersion, SqliteDogStore, MongoDogStore, LATEST_SCHEMA, type DogStore } from './storage.ts';
import { FixtureAppAuthority, type TrustedAppAuthority } from './authority.ts';
import { NativeAppAuthority, verifyNativeJwt } from './native-authority.ts';
import { createAppServer, loadVerifiedBuild } from './app-server.ts';

const [cmd, ...rest] = process.argv.slice(2);
const { values: v } = parseArgs({ args: rest, strict: true, options: {
  build: { type: 'string' }, db: { type: 'string' }, port: { type: 'string', default: '0' }, origin: { type: 'string', multiple: true },
  target: { type: 'string' }, approve: { type: 'boolean', default: false }, company: { type: 'string' }, project: { type: 'string' },
  subject: { type: 'string' }, kind: { type: 'string', default: 'VERIFIED_REGISTERED_PERSON' }, scope: { type: 'string', default: 'dog:read,dog:write' },
  ttl: { type: 'string', default: '3600' }, 'lease-id': { type: 'string', default: 'lease_local_fixture' }, 'start-generation': { type: 'string', default: '1' }, 'mongo-uri-env': { type: 'string' }, authority: { type: 'string', default: 'fixture' }, 'native-root': { type: 'string' }, 'jwt-env': { type: 'string', default: 'GB3_NATIVE_JWT' }, 'execution-class': { type: 'string', default: 'FIXTURE' } } });
const need = (k: keyof typeof v) => { const x = v[k]; if (typeof x !== 'string' || !x) { console.error(`--${String(k)} required`); process.exit(2); } return x as string; };
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');

async function main() {
  if (cmd === 'migrate') { const db = openSqlite(resolve(need('db'))); out({ ok: true, ...migrateSqlite(db, v.target ? Number(v.target) : LATEST_SCHEMA) }); db.close(); return; }
  if (cmd === 'rollback') { const db = openSqlite(resolve(need('db'))); out({ ok: true, ...rollbackSqlite(db, Number(need('target')), !!v.approve) }); db.close(); return; }
  if (cmd === 'status') { const db = openSqlite(resolve(need('db'))); out({ schemaVersion: sqliteVersion(db), latest: LATEST_SCHEMA }); db.close(); return; }
  if (cmd === 'issue-session') {
    const build = loadVerifiedBuild(resolve(need('build'))); // session is bound to this verified release artifact
    const db = openSqlite(resolve(need('db'))); const a = new FixtureAppAuthority(db);
    out({ executionClass: 'FIXTURE', authority: a.kind, ...a.issue({ companyId: need('company'), projectId: need('project'), subjectId: need('subject'), principalKind: v.kind as 'VERIFIED_REGISTERED_PERSON', scope: String(v.scope).split(','), ttlSeconds: Number(v.ttl), artifactDigest: build.receipt.artifactDigest, leaseId: String(v['lease-id']) }) });
    db.close(); return;
  }
  if (cmd === 'issue-native-session') {
    // Trusted launcher/gateway step: native JWT from env only -> grokbot1 adapter verdict -> app-scoped session.
    const build = loadVerifiedBuild(resolve(need('build')));
    const jwt = process.env[String(v['jwt-env'])]; if (!jwt) throw new Error(`env ${v['jwt-env']} empty`);
    const company = v.company || build.spec.binding.companyId; const project = v.project || build.spec.binding.projectId;
    const verdict = verifyNativeJwt(resolve(need('native-root')), company, jwt);
    const db = openSqlite(resolve(need('db'))); const a = new NativeAppAuthority(db, resolve(need('native-root')));
    out({ executionClass: 'NATIVE_NONPRODUCTION', authority: a.kind, nativeUserLabel: 'SYNTHETIC_DISPOSABLE_NATIVE_USER', pinsVerified: Object.keys(verdict.pins).length,
      ...a.grant(verdict, { projectId: project, ttlSeconds: Number(v.ttl), artifactDigest: build.receipt.artifactDigest, leaseId: String(v['lease-id']) }) });
    db.close(); return;
  }
  if (cmd === 'revoke') { const db = openSqlite(resolve(need('db'))); const a = new FixtureAppAuthority(db); out({ ok: true, ...a.revoke(need('company'), need('project'), need('subject')) }); db.close(); return; }
  if (cmd === 'start') {
    const build = loadVerifiedBuild(resolve(need('build')));
    const requiredSchema = build.spec.fields.some(f => f.name === 'notes') ? 2 : 1;
    const db = openSqlite(resolve(need('db')));
    let store: DogStore;
    const mongoEnv = v['mongo-uri-env'];
    if (mongoEnv) { const uri = process.env[mongoEnv]; if (!uri) throw new Error(`env ${mongoEnv} empty`); store = await MongoDogStore.connect(uri, `doglove_${build.spec.binding.projectId}`); }
    else store = new SqliteDogStore(db, requiredSchema);
    const leaseId = String(v['lease-id']); const startGeneration = Number(v['start-generation']);
    if (!Number.isSafeInteger(startGeneration) || startGeneration < 1) throw new Error('--start-generation must be a positive integer');
    const rel = { artifactDigest: build.receipt.artifactDigest, leaseId };
    if (!['fixture', 'native'].includes(String(v.authority))) throw new Error('--authority fixture|native');
    const authority: TrustedAppAuthority = v.authority === 'native' ? new NativeAppAuthority(db, resolve(need('native-root')), rel) : new FixtureAppAuthority(db, rel);
    const port = Number(v.port);
    const origins: string[] = [...(v.origin ?? [])]; // read per request; default filled after bind
    const server = createAppServer({ build, store, authority, allowedOrigins: origins, executionClass: v['execution-class'] as 'FIXTURE', leaseId, startGeneration });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address(); const p = typeof addr === 'object' && addr ? addr.port : port;
      if (!origins.length) origins.push(`http://127.0.0.1:${p}`);
      out({ ready: true, pid: process.pid, port: p, origins, appId: build.spec.appId, specRevision: build.spec.specRevision, buildRevision: build.receipt.buildRevision, buildFingerprint: build.receipt.buildFingerprint, artifactDigest: build.receipt.artifactDigest, storageEngine: store.engine, schemaVersion: store.schemaVersion(), authorityKind: authority.kind, leaseId, startGeneration });
    });
    const stop = () => { server.close(() => { store.close(); try { db.close(); } catch { /* shared handle */ } process.exit(0); }); setTimeout(() => process.exit(0), 2000).unref(); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    return;
  }
  console.error('usage: node server/cli.ts <start|migrate|rollback|status|issue-session|revoke> ...'); process.exit(2);
}
main().catch(e => { console.error(JSON.stringify({ error: String(e?.code || 'ERROR'), message: String(e?.message || e) })); process.exit(1); });
