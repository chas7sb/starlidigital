/**
 * Trusted-Host Authority HTTP Service & App-Side RemoteTrustedAppAuthority Adapter (R4-10).
 * Keeps canonical native SQLite databases, revocation store, and signing keys strictly on the trusted host.
 * The app server only calls this service over HTTP using RemoteTrustedAppAuthority (implementing TrustedAppAuthority).
 */
import { createServer, type Server } from 'node:http';
import { AuthError, type Actor, type TrustedAppAuthority } from './authority.ts';
import type { PortableAppAuthority, AuthorityStateSnapshot } from './portable-authority.ts';

export interface TrustedAuthorityHostConfig {
  backingAuthority: TrustedAppAuthority;
  portableAuthority: PortableAppAuthority;
  getAuthorityState: () => AuthorityStateSnapshot;
  expectedBinding: { companyId: string; projectId: string; leaseId: string; processGeneration: number };
  issueSessionForClaims: (claims: { companyId: string; projectId: string; userId: string; authorityRevision: number }) => {
    token: string;
    expiresAt: string;
  };
  internalSharedSecret: string;
}

export function createTrustedAuthorityService(cfg: TrustedAuthorityHostConfig): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-starli-authority-key'] !== cfg.internalSharedSecret) {
      return send(403, { error: { code: 'INTERNAL_AUTH_DENIED', message: 'Invalid internal authority key' } });
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: Record<string, unknown> = {};
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      return send(400, { error: { code: 'BAD_JSON', message: 'Invalid JSON' } });
    }

    try {
      if (req.method === 'POST' && req.url === '/internal/v1/authority/bootstrap-session') {
        const ticket = String(body.ticket || '');
        const state = cfg.getAuthorityState();
        const ver = cfg.portableAuthority.verifyTicket(
          ticket,
          { ...cfg.expectedBinding, singleUseBootstrap: true },
          state
        );
        if (!ver.ok || !ver.claims) {
          return send(ver.status, { error: { code: ver.code, message: ver.code } });
        }
        const issued = cfg.issueSessionForClaims({
          companyId: ver.claims.companyId,
          projectId: ver.claims.projectId,
          userId: ver.claims.userId,
          authorityRevision: ver.claims.authorityRevision,
        });
        return send(200, { sessionToken: issued.token, expiresAt: issued.expiresAt });
      }

      if (req.method === 'POST' && req.url === '/internal/v1/authority/resolve') {
        const actor = await cfg.backingAuthority.resolve(body.sessionToken as string | undefined);
        return send(200, { actor });
      }

      if (req.method === 'POST' && req.url === '/internal/v1/authority/csrf') {
        const csrfToken = await cfg.backingAuthority.csrfToken(body.actor as Actor);
        return send(200, { csrfToken });
      }

      if (req.method === 'POST' && req.url === '/internal/v1/authority/verify-csrf') {
        const valid = await cfg.backingAuthority.verifyCsrf(body.actor as Actor, body.token as string | undefined);
        return send(200, { valid });
      }

      if (req.method === 'POST' && req.url === '/internal/v1/authority/admit-write') {
        await cfg.backingAuthority.assertWriteAdmission(body.actor as Actor);
        return send(200, { admitted: true });
      }

      return send(404, { error: { code: 'NOT_FOUND', message: 'Unknown authority endpoint' } });
    } catch (e) {
      if (e instanceof AuthError) {
        return send(e.status, { error: { code: e.code, message: e.message } });
      }
      return send(503, { error: { code: 'AUTHORITY_UNAVAILABLE', message: String((e as Error)?.message || 'error') } });
    }
  });
}

export class RemoteTrustedAppAuthority implements TrustedAppAuthority {
  readonly kind = 'GROKBOT1_NATIVE_ADAPTER' as const;
  private readonly baseUrl: string;
  private readonly sharedSecret: string;

  constructor(opts: { baseUrl: string; sharedSecret: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.sharedSecret = opts.sharedSecret;
  }

  private async post(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Starli-Authority-Key': this.sharedSecret,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new AuthError(403, 'AUTHORITY_UNAVAILABLE', 'Trusted authority service unreachable');
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error || {}) as Record<string, unknown>;
      throw new AuthError(res.status, String(err.code || 'AUTHORITY_DENIED'), String(err.message || 'Authority denied'));
    }
    return data;
  }

  async bootstrapSession(ticket: string): Promise<{ sessionToken: string; expiresAt: string }> {
    const data = await this.post('/internal/v1/authority/bootstrap-session', { ticket });
    return { sessionToken: String(data.sessionToken), expiresAt: String(data.expiresAt) };
  }

  async resolve(sessionToken: string | undefined): Promise<Actor> {
    const data = await this.post('/internal/v1/authority/resolve', { sessionToken });
    return data.actor as Actor;
  }

  async csrfToken(actor: Actor): Promise<string> {
    const data = await this.post('/internal/v1/authority/csrf', { actor });
    return String(data.csrfToken);
  }

  async verifyCsrf(actor: Actor, token: string | undefined): Promise<boolean> {
    const data = await this.post('/internal/v1/authority/verify-csrf', { actor, token });
    return data.valid === true;
  }

  async assertWriteAdmission(actor: Actor): Promise<void> {
    await this.post('/internal/v1/authority/admit-write', { actor });
  }
}
