// DogLove generated-app Node service (grokbot3). Serves the verified compiled React
// dist and the authenticated API. Listens on 127.0.0.1 only.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import type { AppBuildReceiptV1, AppSpecV1 } from '../contracts/app-contracts.ts';
import { validateAppSpec } from '../contracts/app-contracts.ts';
import { type DogStore, StoreError, type NewDog } from './storage.ts';
import { AuthError, type TrustedAppAuthority, type Actor } from './authority.ts';

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p).split(sep).join('/')); } };
  walk(dir); return out.sort();
}
export function treeDigest(dir: string): { digest: string; files: { path: string; sha256: string; bytes: number }[] } {
  const files = listFiles(dir).map(p => { const b = readFileSync(join(dir, p)); return { path: p, sha256: sha256(b), bytes: b.length }; });
  return { digest: sha256(files.map(f => `${f.path}\0${f.sha256}\n`).join('')), files };
}

export type LoadedBuild = { dir: string; spec: AppSpecV1; receipt: AppBuildReceiptV1; dist: Map<string, Buffer> };
/** Fail closed unless dist bytes match the build receipt and the spec matches its digest. */
export function loadVerifiedBuild(buildDir: string): LoadedBuild {
  const receipt = JSON.parse(readFileSync(join(buildDir, 'APP_BUILD_RECEIPT.json'), 'utf8')) as AppBuildReceiptV1;
  if (receipt.schema !== 'APP_BUILD_RECEIPT_V1') throw new Error('BUILD_RECEIPT_INVALID');
  // Legacy r1/r2 receipts carried the sha fingerprint in "buildRevision"; normalise to the accepted mapping
  // (buildRevision = integer specRevision, buildFingerprint = sha256).
  if (typeof (receipt as { buildRevision: unknown }).buildRevision === 'string') { receipt.buildFingerprint = receipt.buildRevision as unknown as string; receipt.buildRevision = receipt.specRevision; }
  if (receipt.buildRevision !== receipt.specRevision || !/^[a-f0-9]{64}$/.test(receipt.buildFingerprint)) throw new Error('BUILD_REVISION_MAPPING_INVALID');
  const specRaw = readFileSync(join(buildDir, 'appspec.json'));
  if (sha256(specRaw) !== receipt.specSha256) throw new Error('BUILD_SPEC_DIGEST_MISMATCH');
  const spec = validateAppSpec(JSON.parse(specRaw.toString('utf8')));
  if (spec.specRevision !== receipt.specRevision || spec.appId !== receipt.appId) throw new Error('BUILD_SPEC_REVISION_MISMATCH');
  const t = treeDigest(join(buildDir, 'dist'));
  if (t.digest !== receipt.artifactDigest) throw new Error(`BUILD_ARTIFACT_DIGEST_MISMATCH ${t.digest} != ${receipt.artifactDigest}`);
  const dist = new Map<string, Buffer>(); for (const f of t.files) dist.set('/' + f.path, readFileSync(join(buildDir, 'dist', f.path)));
  return { dir: buildDir, spec, receipt, dist };
}

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP, 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
class HttpError extends Error { status: number; code: string; constructor(status: number, code: string, msg: string) { super(msg); this.status = status; this.code = code; } }
function send(res: ServerResponse, status: number, obj: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...extra }); res.end(JSON.stringify(obj));
}
function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return undefined;
}
async function readJson(req: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  const ct = String(req.headers['content-type'] || '');
  if (!/^application\/json(\s*;\s*charset=utf-8)?$/i.test(ct)) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json required');
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Body too large'); chunks.push(c as Buffer); }
  let o: unknown; try { o = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'BAD_JSON', 'Invalid JSON'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new HttpError(400, 'BAD_JSON', 'JSON object required');
  return o as Record<string, unknown>;
}
// Control chars (except none) are rejected; markup is stored verbatim as text and
// rendered by React as text (never innerHTML). CSP blocks inline script regardless.
const CTRL = /[\u0000-\u001f\u007f\u2028\u2029]/;
function text(o: Record<string, unknown>, k: string, required: boolean, max: number): string {
  const v = o[k];
  if (v === undefined || v === null || v === '') { if (required) throw new HttpError(400, 'BAD_INPUT', `${k} required`); return ''; }
  if (typeof v !== 'string') throw new HttpError(400, 'BAD_INPUT', `${k} must be text`);
  const t = v.normalize('NFC').trim();
  if ((required && !t) || t.length > max || CTRL.test(t)) throw new HttpError(400, 'BAD_INPUT', `invalid ${k}`);
  return t;
}
export function validateNewDog(spec: AppSpecV1, o: Record<string, unknown>): NewDog {
  const allowed = new Set(spec.fields.map(f => f.name));
  for (const k of Object.keys(o)) if (!allowed.has(k as never)) throw new HttpError(400, 'BAD_INPUT', `field ${k} not allowed by AppSpec r${spec.specRevision}`);
  const f = (n: string) => spec.fields.find(x => x.name === n);
  const name = text(o, 'name', true, f('name')?.maxLength ?? 60);
  const breed = f('breed') ? text(o, 'breed', !!f('breed')?.required, f('breed')?.maxLength ?? 60) : '';
  const notes = f('notes') ? text(o, 'notes', !!f('notes')?.required, f('notes')?.maxLength ?? 200) : '';
  let ageYears: number | null = null;
  if (f('ageYears') && o.ageYears !== undefined && o.ageYears !== null && o.ageYears !== '') {
    const a = o.ageYears; const lo = f('ageYears')?.min ?? 0, hi = f('ageYears')?.max ?? 30;
    if (!Number.isSafeInteger(a) || (a as number) < lo || (a as number) > hi) throw new HttpError(400, 'BAD_INPUT', 'invalid ageYears');
    ageYears = a as number;
  } else if (f('ageYears')?.required) throw new HttpError(400, 'BAD_INPUT', 'ageYears required');
  return { name, breed, ageYears, notes };
}

export type ServerOptions = { build: LoadedBuild; store: DogStore; authority: TrustedAppAuthority; allowedOrigins: string[]; executionClass: 'FIXTURE' | 'NATIVE_NONPRODUCTION' | 'COMBINED_CANDIDATE'; leaseId: string; startGeneration: number; approvedParentOrigin?: string; isLoopbackTest?: boolean };
export function createAppServer(o: ServerOptions): Server {
  const { build, store, authority } = o; const spec = build.spec; const startedAt = new Date().toISOString();
  const effectiveSec: Record<string, string> = o.approvedParentOrigin
    ? {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': CSP.replace("frame-ancestors 'none'", `frame-ancestors ${new URL(o.approvedParentOrigin).origin}`),
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
      }
    : SEC;
  const checkApprovedParent = (req: IncomingMessage) => {
    if (!o.approvedParentOrigin) return;
    const ref = req.headers.referer || req.headers.origin;
    if (typeof ref === 'string' && ref.length > 0) {
      try {
        const refOrigin = new URL(ref).origin;
        const allowedParent = new URL(o.approvedParentOrigin).origin;
        const selfAllowed = o.allowedOrigins.includes(refOrigin);
        if (refOrigin !== allowedParent && !selfAllowed) {
          throw new HttpError(403, 'UNAPPROVED_PREVIEW_PARENT', 'Unapproved parent origin');
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(403, 'UNAPPROVED_PREVIEW_PARENT', 'Invalid parent origin');
      }
    }
  };
  const actorFor = async (req: IncomingMessage, perm: string): Promise<Actor> => {
    const a = await authority.resolve(cookie(req, 'dl_app_session'));
    if (!a.scope.includes(perm)) throw new HttpError(403, 'FORBIDDEN', `${perm} required`);
    // Bind the session to THIS app's company/project; any other tenant is denied.
    if (a.companyId !== spec.binding.companyId || a.projectId !== spec.binding.projectId) throw new HttpError(403, 'FORBIDDEN', 'Session is not bound to this app tenant');
    return a;
  };
  const checkOrigin = (req: IncomingMessage) => {
    const origin = req.headers.origin; const site = req.headers['sec-fetch-site'];
    if (typeof origin !== 'string' || !o.allowedOrigins.includes(origin)) throw new HttpError(403, 'ORIGIN_DENIED', 'Origin not allowed');
    if (site !== undefined && site !== 'same-origin') throw new HttpError(403, 'ORIGIN_DENIED', 'Cross-site request');
  };
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1'); const path = url.pathname; const method = req.method || 'GET';
      if (path === '/api/v1/app/health' && method === 'GET')
        return send(res, 200, { status: 'healthy', appId: spec.appId, specRevision: spec.specRevision, buildRevision: build.receipt.buildRevision, buildFingerprint: build.receipt.buildFingerprint, artifactDigest: build.receipt.artifactDigest, artifactRevision: build.receipt.artifactDigest, specSha256: build.receipt.specSha256,
          storageEngine: store.engine, productionEligibleStorage: store.productionEligible, schemaVersion: store.schemaVersion(), authorityKind: authority.kind,
          binding: spec.binding, executionClass: o.executionClass, leaseId: o.leaseId, startGeneration: o.startGeneration, pid: process.pid, startedAt, previewReady: false });
      if (path === '/api/v1/app/session/bootstrap' && method === 'POST') {
        checkApprovedParent(req);
        if (typeof authority.bootstrapSession !== 'function') throw new HttpError(501, 'BOOTSTRAP_UNSUPPORTED', 'Bootstrap not supported');
        const body = await readJson(req, 8192);
        const ticket = typeof body.ticket === 'string' ? body.ticket : '';
        const session = await authority.bootstrapSession(ticket);
        const sameSite = o.isLoopbackTest ? 'SameSite=Lax' : 'SameSite=None; Secure';
        const setCookie = `dl_app_session=${encodeURIComponent(session.sessionToken)}; HttpOnly; Path=/; ${sameSite}`;
        return send(res, 200, { ok: true, expiresAt: session.expiresAt }, { 'Set-Cookie': setCookie });
      }
      if (path === '/api/v1/customer/csrf') {
        if (method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'GET only');
        const a = await actorFor(req, 'dog:read');
        return send(res, 200, { csrfToken: await authority.csrfToken(a), expiresAt: a.expiresAt });
      }
      if (path === '/api/v1/customer/dogs') {
        if (method === 'GET') {
          const a = await actorFor(req, 'dog:read');
          return send(res, 200, { dogs: await store.list(a), storageEngine: store.engine, scope: { companyId: a.companyId, projectId: a.projectId }, observedAt: new Date().toISOString() });
        }
        if (method === 'POST') {
          checkOrigin(req);
          const a = await actorFor(req, 'dog:write');
          if (!(await authority.verifyCsrf(a, req.headers['x-csrf-token'] as string | undefined))) throw new HttpError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token');
          const key = req.headers['idempotency-key'];
          if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) throw new HttpError(400, 'IDEMPOTENCY_REQUIRED', 'Valid Idempotency-Key required');
          const dog = validateNewDog(spec, await readJson(req, spec.limits.maxBodyBytes));
          const fingerprint = sha256(JSON.stringify(['POST', '/api/v1/customer/dogs', dog]));
          let syncGuard: () => void = () => {};
          const probe = authority.assertWriteAdmission(a);
          if (probe && typeof (probe as Promise<void>).then === 'function') {
            await probe;
          } else {
            syncGuard = () => { authority.assertWriteAdmission(a); };
          }
          const r = await store.create({ companyId: a.companyId, projectId: a.projectId, subjectId: a.subjectId, key, fingerprint, dog, requestId: spec.binding.requestId,
            appRevision: spec.specRevision, maxDogs: spec.limits.maxDogsPerProject, maxWritesPerMinute: spec.limits.maxWritesPerSubjectPerMinute }, syncGuard);
          return send(res, r.status, r.body);
        }
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'GET or POST');
      }
      if (path.startsWith('/api/')) throw new HttpError(404, 'NOT_FOUND', 'Route not found');
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'GET only');
      const file = build.dist.get(path === '/' ? '/index.html' : path) ?? build.dist.get('/index.html')!;
      const name = build.dist.has(path) ? path : '/index.html';
      checkApprovedParent(req);
      res.writeHead(200, { 'Content-Type': MIME[extname(name)] || 'application/octet-stream', 'Cache-Control': name === '/index.html' ? 'no-store' : 'public, max-age=31536000, immutable', 'X-Build-Revision': String(build.receipt.buildRevision), 'X-Artifact-Digest': build.receipt.artifactDigest, ...effectiveSec });
      res.end(method === 'HEAD' ? undefined : file);
    } catch (e) {
      if (e instanceof HttpError || e instanceof StoreError || e instanceof AuthError) return send(res, e.status, { error: { code: e.code, message: e.message } });
      process.stderr.write(`internal error: ${(e as Error)?.stack || e}\n`);
      return send(res, 500, { error: { code: 'STORAGE_UNAVAILABLE', message: 'Internal error' } });
    }
  });
}
