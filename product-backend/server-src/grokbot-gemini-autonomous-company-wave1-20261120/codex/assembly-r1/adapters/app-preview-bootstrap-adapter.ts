/**
 * Named adapter consuming Gemini3's private DogLove app authority & browser bootstrap contract:
 * - Cookie name: dl_app_session (HttpOnly, set by app server via browser credentials:'include')
 * - CSRF header: x-csrf-token (sent on mutations)
 * - Bootstrap route: POST <previewOrigin>/api/v1/app/session/bootstrap
 * - Never sends platform JWT or privileged host signing material to the generated app.
 * - Never asserts preview readiness using caller booleans alone; requires bound receipt,
 *   signature/ticket/storage attestation, matching company/project/preview/revision, and active authority.
 */
import { trustedPreviewIframeUrl } from './preview-url.ts';

export type PreviewAuthorityState =
  | 'LOADING'
  | 'PENDING'
  | 'USABLE'
  | 'DENIED'
  | 'REVOKED'
  | 'ERROR';

export interface BoundPreviewReceipt {
  schemaVersion: number;
  status: string;
  previewId: string;
  companyId: string;
  projectId: string;
  revision: number;
  audience: string;
  checks: {
    html200: boolean;
    js200: boolean;
    apiPostReadback: boolean;
    restartPersistence: boolean;
    browserExecuted: boolean;
  };
}

export interface PreviewGateInput {
  receipt: BoundPreviewReceipt | null;
  expectedCompanyId: string;
  expectedProjectId: string;
  authorizedPreviewId: string;
  expectedRevision: number;
  receiptSignatureValid: boolean;
  ticketValidatedByNativeServer: boolean;
  isolatedStorageAttested: boolean;
  authorityState: PreviewAuthorityState;
  previewOrigin: string | null;
  parentOrigin: string | null;
  trustedFrameUrl: string | null;
  /** Explicit staging-only opt-in for local loopback distinct-port preview transport (never production). */
  allowStagingLoopback?: boolean;
}

export interface PreviewGateEvaluation {
  ready: boolean;
  state: PreviewAuthorityState;
  safeFrameUrl: string | null;
  transportMode: 'PRODUCTION_HTTPS' | 'STAGING_LOOPBACK' | 'BLOCKED';
  reason: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * Local/private staging loopback gate (explicitly opt-in and labeled STAGING_LOOPBACK).
 * Still requires distinct origin/port from parentOrigin and exact previewId path binding.
 */
export function stagingLoopbackPreviewUrl(input: {
  trustedUrl: string | null;
  previewOrigin: string | null;
  parentOrigin: string | null;
  previewId: string;
  isolatedStorageAttested: boolean;
}): string | null {
  if (
    !input.isolatedStorageAttested ||
    !input.trustedUrl ||
    !input.previewOrigin ||
    !input.parentOrigin ||
    !/^[A-Za-z0-9_-]{8,96}$/.test(input.previewId)
  ) {
    return null;
  }
  try {
    const origin = new URL(input.previewOrigin);
    const parent = new URL(input.parentOrigin);
    const u = new URL(input.trustedUrl);
    if (origin.protocol !== 'http:' || u.protocol !== 'http:') return null;
    if (!LOOPBACK_HOSTS.has(origin.hostname) || !LOOPBACK_HOSTS.has(u.hostname)) return null;
    if (u.origin !== origin.origin) return null;
    // Preview must be isolated on a distinct origin (port) from parent shell.
    if (origin.origin === parent.origin) return null;
    if (origin.username || origin.password || u.username || u.password) return null;
    if (u.href.length > 4096) return null;
    return u.href;
  } catch {
    return null;
  }
}

export function evaluatePreviewGate(input: PreviewGateInput): PreviewGateEvaluation {
  if (input.authorityState === 'LOADING') {
    return { ready: false, state: 'LOADING', safeFrameUrl: null, transportMode: 'BLOCKED', reason: 'Loading preview authority and receipt.' };
  }
  if (input.authorityState === 'REVOKED') {
    return { ready: false, state: 'REVOKED', safeFrameUrl: null, transportMode: 'BLOCKED', reason: 'Preview authority has been revoked.' };
  }
  if (input.authorityState === 'DENIED') {
    return { ready: false, state: 'DENIED', safeFrameUrl: null, transportMode: 'BLOCKED', reason: 'Preview access denied by authority.' };
  }
  if (input.authorityState === 'ERROR') {
    return { ready: false, state: 'ERROR', safeFrameUrl: null, transportMode: 'BLOCKED', reason: 'Preview authority check failed.' };
  }
  if (input.authorityState === 'PENDING') {
    return { ready: false, state: 'PENDING', safeFrameUrl: null, transportMode: 'BLOCKED', reason: 'Preview build or authority lease is still pending.' };
  }

  const r = input.receipt;
  if (!r) {
    return { ready: false, state: 'PENDING', safeFrameUrl: null, transportMode: 'BLOCKED', reason: 'Missing server-verified preview receipt.' };
  }

  const receiptQualified =
    r.schemaVersion === 1 &&
    input.receiptSignatureValid === true &&
    input.ticketValidatedByNativeServer === true &&
    input.isolatedStorageAttested === true &&
    (r.status === 'PREVIEW_READY' || r.status === 'AUTHORIZED_HEALTHY_PREVIEW') &&
    r.companyId === input.expectedCompanyId &&
    r.projectId === input.expectedProjectId &&
    r.previewId === input.authorizedPreviewId &&
    r.revision === input.expectedRevision &&
    r.audience === 'PRIVATE_SCOPED' &&
    r.checks?.html200 === true &&
    r.checks?.js200 === true;

  if (!receiptQualified) {
    return {
      ready: false,
      state: 'PENDING',
      safeFrameUrl: null,
      transportMode: 'BLOCKED',
      reason: 'Preview receipt failed bound health, identity, signature, or tested readiness verification.',
    };
  }

  const prodUrl = trustedPreviewIframeUrl({
    trustedUrl: input.trustedFrameUrl,
    previewOrigin: input.previewOrigin,
    parentOrigin: input.parentOrigin,
    previewId: input.authorizedPreviewId,
    isolatedStorageAttested: input.isolatedStorageAttested,
  });

  if (prodUrl) {
    return {
      ready: true,
      state: 'USABLE',
      safeFrameUrl: prodUrl,
      transportMode: 'PRODUCTION_HTTPS',
      reason: 'Verified dedicated HTTPS private preview ready.',
    };
  }

  if (input.allowStagingLoopback === true) {
    const stagingUrl = stagingLoopbackPreviewUrl({
      trustedUrl: input.trustedFrameUrl,
      previewOrigin: input.previewOrigin,
      parentOrigin: input.parentOrigin,
      previewId: input.authorizedPreviewId,
      isolatedStorageAttested: input.isolatedStorageAttested,
    });
    if (stagingUrl) {
      return {
        ready: true,
        state: 'USABLE',
        safeFrameUrl: stagingUrl,
        transportMode: 'STAGING_LOOPBACK',
        reason: 'Verified local staging loopback private preview ready (not production TLS).',
      };
    }
  }

  return {
    ready: false,
    state: 'DENIED',
    safeFrameUrl: null,
    transportMode: 'BLOCKED',
    reason: 'Preview URL failed strict origin isolation or ticket path policy.',
  };
}

export interface PreviewBootstrapResult {
  ok: boolean;
  httpStatus: number;
  authorityState: PreviewAuthorityState;
  csrfToken: string | null;
  errorCode: string | null;
}

/**
 * Performs browser-side scoped bootstrap against the app origin using credentials:'include'
 * so the browser receives HttpOnly dl_app_session directly. Never transmits platform JWT.
 */
export async function bootstrapPreviewSession(params: {
  previewOrigin: string;
  bootstrapTicket: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<PreviewBootstrapResult> {
  const fetcher = params.fetcher ?? fetch;
  const origin = params.previewOrigin.replace(/\/+$/, '');
  if (!origin || !params.bootstrapTicket) {
    return { ok: false, httpStatus: 400, authorityState: 'DENIED', csrfToken: null, errorCode: 'MISSING_TICKET' };
  }

  let res: Response;
  try {
    res = await fetcher(`${origin}/api/v1/app/session/bootstrap`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ticket: params.bootstrapTicket }),
      signal: params.signal,
    });
  } catch {
    return { ok: false, httpStatus: 0, authorityState: 'ERROR', csrfToken: null, errorCode: 'NETWORK_ERROR' };
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.status === 401) {
    return { ok: false, httpStatus: 401, authorityState: 'REVOKED', csrfToken: null, errorCode: data?.code ?? 'UNAUTHORIZED' };
  }
  if (res.status === 403 || res.status === 409) {
    return { ok: false, httpStatus: res.status, authorityState: 'DENIED', csrfToken: null, errorCode: data?.code ?? 'FORBIDDEN' };
  }
  if (!res.ok) {
    return { ok: false, httpStatus: res.status, authorityState: 'ERROR', csrfToken: null, errorCode: data?.code ?? `HTTP_${res.status}` };
  }

  return {
    ok: true,
    httpStatus: res.status,
    authorityState: 'USABLE',
    csrfToken: typeof data?.csrfToken === 'string' ? data.csrfToken : null,
    errorCode: null,
  };
}

/** Acceptance proof is independent from permission to open the first private preview. */
export function evaluatePreviewAcceptance(receipt: BoundPreviewReceipt | null): boolean {
 return receipt?.status === 'PREVIEW_READY' &&
 receipt.checks?.apiPostReadback === true &&
 receipt.checks?.restartPersistence === true &&
 receipt.checks?.browserExecuted === true;
}
