import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PortableAppAuthority } from '../package/server/portable-authority.ts';
import {
  isApprovedParentOrigin,
  buildPreviewSecurityHeaders,
  buildAppSessionCookieHeader,
  mintAppCsrfToken,
  verifyAppWriteCsrf,
  computePreviewReady,
} from '../package/server/preview-embed-policy.ts';

test('PortableAppAuthority enforces store identity/replacement, unavailability, expiry, replay, membership revision, generation, and cross-tenant denials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'starli-portable-auth-'));
  const storePath = join(dir, 'authority.sqlite');
  writeFileSync(storePath, 'original-store-bytes');
  try {
    const key = randomBytes(32);
    const auth = new PortableAppAuthority({ signingKey: key, pinnedStorePath: storePath });
    const now = Date.now();
    const state = {
      available: true,
      storeFilePath: storePath,
      revokedJtis: new Set(),
      revokedUsers: new Set(),
      activeMemberships: new Map([['comp-1:user-1', { active: true, revision: 2, role: 'owner' }]]),
      activeLeases: new Map([['lease-1', { companyId: 'comp-1', projectId: 'proj-1', generation: 1, active: true }]]),
    };
    const expected = { companyId: 'comp-1', projectId: 'proj-1', leaseId: 'lease-1', processGeneration: 1, nowMs: now };

    const ticket = auth.issueTicket({
      companyId: 'comp-1',
      projectId: 'proj-1',
      userId: 'user-1',
      leaseId: 'lease-1',
      processGeneration: 1,
      authorityRevision: 2,
      issuedAt: now - 1000,
      expiresAt: now + 60000,
    });

    // 1. Valid ticket passes
    const ok = auth.verifyTicket(ticket, expected, state);
    assert.equal(ok.ok, true);
    assert.equal(ok.status, 200);

    // 2. Single-use bootstrap replay denied
    const boot1 = auth.verifyTicket(ticket, { ...expected, singleUseBootstrap: true }, state);
    assert.equal(boot1.ok, true);
    const boot2 = auth.verifyTicket(ticket, { ...expected, singleUseBootstrap: true }, state);
    assert.equal(boot2.ok, false);
    assert.equal(boot2.code, 'TICKET_REPLAYED');

    // 3. Cross-tenant denied
    const cross = auth.verifyTicket(ticket, { ...expected, companyId: 'comp-2' }, state);
    assert.equal(cross.ok, false);
    assert.equal(cross.code, 'CROSS_TENANT_DENIED');

    // 4. Stale processGeneration denied
    const staleGen = auth.verifyTicket(ticket, { ...expected, processGeneration: 2 }, state);
    assert.equal(staleGen.ok, false);
    assert.equal(staleGen.code, 'LEASE_OR_GENERATION_MISMATCH');

    // 5. Membership revision change denied
    state.activeMemberships.set('comp-1:user-1', { active: true, revision: 3, role: 'owner' });
    const staleRev = auth.verifyTicket(ticket, expected, state);
    assert.equal(staleRev.ok, false);
    assert.equal(staleRev.code, 'MEMBERSHIP_OR_REVISION_STALE');
    state.activeMemberships.set('comp-1:user-1', { active: true, revision: 2, role: 'owner' });

    // 6. Unavailable authority store denied
    const unavail = auth.verifyTicket(ticket, expected, { ...state, available: false });
    assert.equal(unavail.ok, false);
    assert.equal(unavail.code, 'AUTHORITY_UNAVAILABLE');

    // 7. Expired ticket denied
    const expired = auth.verifyTicket(ticket, { ...expected, nowMs: now + 120000 }, state);
    assert.equal(expired.ok, false);
    assert.equal(expired.code, 'TICKET_EXPIRED');

    // 8. Replaced store file (new inode) detected and denied
    writeFileSync(storePath + '.new', 'silently-replaced-store');
    renameSync(storePath + '.new', storePath);
    const replaced = auth.verifyTicket(ticket, expected, state);
    assert.equal(replaced.ok, false);
    assert.equal(replaced.code, 'AUTHORITY_STORE_REPLACED');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Private embedded preview policy enforces approved parent origin, HttpOnly cookie, CSRF header, and previewReady=false until all checks pass', async () => {
  const approvedParent = 'https://starlidigital.ro';
  const csrfToken = mintAppCsrfToken();

  const server = http.createServer((req, res) => {
    const originHdr = req.headers['origin'] || req.headers['referer'];
    if (req.method === 'GET' && req.url === '/preview') {
      if (!isApprovedParentOrigin(originHdr, approvedParent)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'UNAPPROVED_PREVIEW_PARENT' }));
        return;
      }
      const headers = {
        ...buildPreviewSecurityHeaders({ approvedParentOrigin: approvedParent, previewOrigin: 'https://preview.starli-preview.net' }),
        'Set-Cookie': buildAppSessionCookieHeader('opaque-app-sess-1', { isLoopbackTest: false }),
        'Content-Type': 'text/html',
      };
      res.writeHead(200, headers);
      res.end('<!doctype html><html><body>DogLove Preview</body></html>');
      return;
    }
    if (req.method === 'POST' && req.url === '/api/dogs') {
      const csrfCheck = verifyAppWriteCsrf(csrfToken, req.headers['x-starli-app-csrf'], req.headers['origin'], 'https://preview.starli-preview.net');
      if (!csrfCheck.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: csrfCheck.code }));
        return;
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    // 1. Unapproved parent denied 403
    const badParent = await fetch(`${base}/preview`, { headers: { Referer: 'https://evil.attacker.tld/embed' } });
    assert.equal(badParent.status, 403);

    // 2. Approved parent allowed 200 with strict CSP frame-ancestors and HttpOnly SameSite=None Secure cookie
    const goodParent = await fetch(`${base}/preview`, { headers: { Referer: 'https://starlidigital.ro/app' } });
    assert.equal(goodParent.status, 200);
    assert.match(goodParent.headers.get('content-security-policy') || '', /frame-ancestors https:\/\/starlidigital\.ro/);
    const setCookie = goodParent.headers.get('set-cookie') || '';
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=None; Secure/);

    // 3. State write without CSRF header denied 403; with valid CSRF header + origin returns 201
    const badWrite = await fetch(`${base}/api/dogs`, { method: 'POST', headers: { Origin: 'https://preview.starli-preview.net' } });
    assert.equal(badWrite.status, 403);
    const goodWrite = await fetch(`${base}/api/dogs`, {
      method: 'POST',
      headers: { Origin: 'https://preview.starli-preview.net', 'X-Starli-App-Csrf': csrfToken },
    });
    assert.equal(goodWrite.status, 201);

    // 4. previewReady remains false if any readiness criterion is false
    assert.equal(
      computePreviewReady({
        html200: true, js200: true, apiPostReadback: true, restartPersistence: true,
        browserExecuted: false, authorityHealthy: true, leaseActive: true,
      }),
      false
    );
    assert.equal(
      computePreviewReady({
        html200: true, js200: true, apiPostReadback: true, restartPersistence: true,
        browserExecuted: true, authorityHealthy: true, leaseActive: true,
      }),
      true
    );
  } finally {
    server.close();
  }
});
