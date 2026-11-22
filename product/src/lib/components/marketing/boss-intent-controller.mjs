/**
 * Grokbot1 BOSS first-intent transport (Fixpass R1).
 * Strictly follows WIRE-CONTRACT-DECISION-R1.md:
 *   POST /api/v1/starli/public/grokbot1/intents
 *   Body: {"requestId": "...", "originalPrompt": "..."}
 *   Headers: Content-Type: application/json, X-Starli-Guest-Intent: 1
 *   Credentials: same-origin
 */
export const INTAKE_ROUTE = '/api/v1/starli/public/grokbot1/intents';
export const SESSION_ROUTE = '/api/v1/starli/public/session';
export const INTENT_STATES = Object.freeze(['idle','checking-session','sending','proposal-received','offline','unauthorized','rate-limited','failed']);
const REQUEST_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function makeRequestId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure request ID generator unavailable');
  return globalThis.crypto.randomUUID();
}

export function validateIntentReceipt(value, requestId, originalPrompt) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 ||
      value.requestId !== requestId || value.idempotencyKey !== requestId ||
      value.originalPrompt !== originalPrompt || value.status !== 'PROPOSED' ||
      !/^[a-f\d]{40}$/i.test(value.intentId ?? '') ||
      !/^[a-f\d]{64}$/i.test(value.guestSessionBinding ?? ''))
    throw new Error('The server returned an unrecognized intent receipt.');
  return Object.freeze({
    schemaVersion: 1, intentId: value.intentId, requestId, originalPrompt,
    status: 'PROPOSED', proposedCompanyName: value.proposedCompanyName ?? null,
    expectedRevision: typeof value.expectedRevision === 'number' ? value.expectedRevision : 0,
    createdAt: value.createdAt, expiresAt: value.expiresAt, observedAt: value.observedAt
  });
}

export class BossIntentController {
  constructor({
    fetcher = globalThis.fetch,
    createId = makeRequestId,
    onState = () => {},
    sessionRoute = SESSION_ROUTE,
    intakeRoute = INTAKE_ROUTE,
    skipSessionCheck = false
  } = {}) {
    this.fetcher = fetcher;
    this.createId = createId;
    this.onState = onState;
    this.sessionRoute = sessionRoute;
    this.intakeRoute = intakeRoute;
    this.skipSessionCheck = skipSessionCheck;
    this.state = 'idle';
    this.pending = null;
    this.receipt = null;
    this.error = '';
    this.lock = false;
  }

  emit(state, error = '') {
    this.state = state;
    this.error = error;
    this.onState({state, error, pending: this.pending, receipt: this.receipt});
  }

  async submit(rawPrompt) {
    if (this.lock) return {ok:false, reason:'IN_FLIGHT'};
    if (this.receipt) return {ok:false, reason:'ALREADY_ACCEPTED', receipt:this.receipt};
    const prompt = String(rawPrompt ?? '').trim();
    if (!prompt || prompt.length > 4000) {
      this.emit('failed','Enter an instruction between 1 and 4000 characters.');
      return {ok:false, reason:'VALIDATION'};
    }
    if (this.pending && this.pending.originalPrompt !== prompt) {
      this.emit('failed','Finish or discard the previous request before sending a different one.');
      return {ok:false, reason:'PENDING_DIFFERENT_PROMPT'};
    }
    this.lock = true;
    try {
      if (!this.pending) {
        const requestId = this.createId();
        if (!REQUEST_RE.test(requestId)) throw new Error('Secure request ID unavailable.');
        this.pending = {requestId, originalPrompt:prompt};
      }
      if (!this.skipSessionCheck) {
        this.emit('checking-session');
        const session = await this.fetcher.call(globalThis, this.sessionRoute, {
          method:'GET', credentials:'same-origin', cache:'no-store'
        });
        if (!session.ok) return this.httpFailure(session.status);
      }
      this.emit('sending');
      const response = await this.fetcher.call(globalThis, this.intakeRoute, {
        method:'POST',
        credentials:'same-origin',
        cache:'no-store',
        headers:{'Content-Type':'application/json','X-Starli-Guest-Intent':'1'},
        body:JSON.stringify(this.pending)
      });
      if (!response.ok) return this.httpFailure(response.status);
      const payload = await response.json();
      this.receipt = validateIntentReceipt(payload, this.pending.requestId, prompt);
      this.pending = null;
      this.emit('proposal-received');
      return {ok:true, receipt:this.receipt};
    } catch (error) {
      if (error instanceof TypeError) this.emit('offline','Network unavailable. Retry safely with the same request ID.');
      else this.emit('failed', error?.message || 'Request failed. Your draft is preserved.');
      return {ok:false, reason:this.state};
    } finally {
      this.lock = false;
    }
  }

  httpFailure(status) {
    if (status===401 || status===403) this.emit('unauthorized','Your session is unavailable. Refresh or sign in, then retry.');
    else if (status===429) this.emit('rate-limited','Too many requests. Retry later with the same request ID.');
    else this.emit('failed', status===404 || status===501 || status===503
      ? 'BOSS onboarding is not enabled on this server yet. Your draft is preserved.'
      : 'Could not save the request. Retry without changing the draft.');
    return {ok:false, reason:this.state, status};
  }

  discard() {
    if (this.lock) return false;
    this.pending=null;
    this.receipt=null;
    this.emit('idle');
    return true;
  }
}
