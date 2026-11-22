import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import type { TokenVerifier, TokenVerificationResult, AuthPrincipal } from './types.js';
import type { Store } from '../../server/src/store.js';

export interface OAuthJwtVerifierOptions {
  issuer: string;
  audience: string;
  jwksUri?: string;
  requiredScope?: string;
  revocationChecker?: (jti: string) => Promise<boolean> | boolean;
}

export class OAuthJwtVerifier implements TokenVerifier {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private options: OAuthJwtVerifierOptions) {
    if (options.jwksUri) {
      this.jwks = createRemoteJWKSet(new URL(options.jwksUri));
    }
  }

  async verify(token: string): Promise<TokenVerificationResult> {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token missing or invalid format' };
    }

    if (!this.jwks) {
      return { valid: false, error: 'OAuth JWKS not configured on server' };
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        clockTolerance: 10,
      });

      if (payload.jti && this.options.revocationChecker) {
        const isRevoked = await this.options.revocationChecker(payload.jti);
        if (isRevoked) {
          return { valid: false, error: 'Token has been revoked' };
        }
      }

      const scopes = this.extractScopes(payload);
      if (this.options.requiredScope && !scopes.includes(this.options.requiredScope)) {
        return { valid: false, error: `Token missing required scope: ${this.options.requiredScope}` };
      }

      const role = String(payload.role || 'customer');
      if (role !== 'admin') {
        return { valid: false, error: 'Access denied: principal is not an admin' };
      }

      const principal: AuthPrincipal = {
        id: String(payload.sub || 'unknown'),
        role: 'admin',
        scopes,
        clientId: typeof payload.client_id === 'string' ? payload.client_id : undefined,
        email: typeof payload.email === 'string' ? payload.email : undefined,
      };

      return { valid: true, principal };
    } catch (err: any) {
      return { valid: false, error: err?.message || 'Token verification failed' };
    }
  }

  private extractScopes(payload: JWTPayload): string[] {
    if (typeof payload.scope === 'string') {
      return payload.scope.split(' ').map(s => s.trim()).filter(Boolean);
    }
    if (Array.isArray(payload.scp)) {
      return payload.scp.map(String);
    }
    if (Array.isArray(payload.scopes)) {
      return payload.scopes.map(String);
    }
    return [];
  }
}

/**
 * Starli Native Token Verifier:
 * Validates opaque Bearer tokens issued by Starli OAuth endpoint (`starli_mcp_...`).
 */
export class StarliNativeTokenVerifier implements TokenVerifier {
  constructor(private store: Store) {}

  async verify(token: string): Promise<TokenVerificationResult> {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token missing' };
    }

    const tokenRecord = this.store.get('oauth_tokens', token) as any;
    if (!tokenRecord) {
      return { valid: false, error: 'Invalid or unrecognized access token' };
    }

    if (Date.now() > tokenRecord.expiresAt) {
      return { valid: false, error: 'Token has expired' };
    }

    const user = this.store.user(tokenRecord.userId);
    if (!user || user.disabled) {
      return { valid: false, error: 'User disabled or not found' };
    }

    if (user.role !== 'ADMIN') {
      return { valid: false, error: 'Access denied: principal is not an admin' };
    }

    const scopes = String(tokenRecord.scope || 'read write admin').split(' ').filter(Boolean);
    const principal: AuthPrincipal = {
      id: user.id,
      role: 'admin',
      scopes,
      clientId: tokenRecord.clientId,
      email: user.email,
    };

    return { valid: true, principal };
  }
}

export class FixtureTokenVerifier implements TokenVerifier {
  private validTokens: Map<string, AuthPrincipal> = new Map();
  private revokedJtis: Set<string> = new Set();

  registerToken(token: string, principal: AuthPrincipal, jti?: string) {
    this.validTokens.set(token, principal);
    if (jti && this.revokedJtis.has(jti)) {
      this.revokedJtis.delete(jti);
    }
  }

  revoke(jti: string) {
    this.revokedJtis.add(jti);
  }

  async verify(token: string): Promise<TokenVerificationResult> {
    if (!token) {
      return { valid: false, error: 'Token missing' };
    }
    if (token === 'expired-token') {
      return { valid: false, error: 'Token has expired' };
    }
    if (token === 'wrong-aud-token') {
      return { valid: false, error: 'Token audience does not match starli-mcp' };
    }
    if (token === 'revoked-token') {
      return { valid: false, error: 'Token has been revoked' };
    }

    const principal = this.validTokens.get(token);
    if (!principal) {
      return { valid: false, error: 'Token signature or record not found' };
    }

    if (principal.role !== 'admin') {
      return { valid: false, error: 'Non-admin principal denied from control-plane' };
    }

    return { valid: true, principal };
  }
}
