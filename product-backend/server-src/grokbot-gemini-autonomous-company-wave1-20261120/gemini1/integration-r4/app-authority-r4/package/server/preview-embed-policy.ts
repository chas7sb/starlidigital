/**
 * Private Embedded Preview Policy & CSRF/Cookie Delivery (GGB1-GEMINI1-INTEGRATION-R3).
 * Enforces explicit approved parent origin (CSP frame-ancestors), HttpOnly app-scoped cookie,
 * explicit CSRF bootstrap header, and conservative previewReady computation.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface PreviewEmbedConfig {
  approvedParentOrigin: string;
  previewOrigin: string;
  isLoopbackTest?: boolean;
}

export interface PreviewReadinessInputs {
  html200: boolean;
  js200: boolean;
  apiPostReadback: boolean;
  restartPersistence: boolean;
  browserExecuted: boolean;
  authorityHealthy: boolean;
  leaseActive: boolean;
}

export function isApprovedParentOrigin(originHeader: string | undefined, approvedParentOrigin: string): boolean {
  if (!originHeader || !approvedParentOrigin) return false;
  try {
    const got = new URL(originHeader).origin;
    const expected = new URL(approvedParentOrigin).origin;
    return got === expected;
  } catch {
    return false;
  }
}

export function buildPreviewSecurityHeaders(config: PreviewEmbedConfig): Record<string, string> {
  const parentOrigin = new URL(config.approvedParentOrigin).origin;
  return {
    'Content-Security-Policy': `default-src 'self'; frame-ancestors ${parentOrigin}; base-uri 'none'; object-src 'none'`,
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function buildAppSessionCookieHeader(sessionValue: string, opts: { isLoopbackTest?: boolean } = {}): string {
  const sameSite = opts.isLoopbackTest ? 'SameSite=Lax' : 'SameSite=None; Secure';
  return `starli_app_session=${encodeURIComponent(sessionValue)}; HttpOnly; Path=/; ${sameSite}`;
}

export function mintAppCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function verifyAppWriteCsrf(
  expectedCsrf: string,
  headerCsrf: string | undefined,
  originHeader: string | undefined,
  allowedWriteOrigin: string
): { ok: boolean; code: string } {
  if (!originHeader || !isApprovedParentOrigin(originHeader, allowedWriteOrigin)) {
    return { ok: false, code: 'WRITE_ORIGIN_DENIED' };
  }
  if (!headerCsrf || !expectedCsrf) {
    return { ok: false, code: 'CSRF_TOKEN_MISSING' };
  }
  const a = Buffer.from(headerCsrf, 'utf8');
  const b = Buffer.from(expectedCsrf, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, code: 'CSRF_TOKEN_INVALID' };
  }
  return { ok: true, code: 'OK' };
}

export function computePreviewReady(inputs: PreviewReadinessInputs): boolean {
  return (
    inputs.html200 === true &&
    inputs.js200 === true &&
    inputs.apiPostReadback === true &&
    inputs.restartPersistence === true &&
    inputs.browserExecuted === true &&
    inputs.authorityHealthy === true &&
    inputs.leaseActive === true
  );
}
