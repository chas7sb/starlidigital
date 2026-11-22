// Same-origin client for the generated DogLove Node API. The browser never holds
// platform credentials; the HttpOnly app session cookie is sent automatically.
export type Dog = { id: string; name: string; breed: string; ageYears: number | null; notes: string; revision: number; createdAt: string; createdBy: string; appRevision: number };
export type Health = { buildRevision: number; artifactDigest: string; specRevision: number; storageEngine: string; productionEligibleStorage: boolean };
export class ApiError extends Error { status: number; code: string; constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; } }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  let body: unknown = null; try { body = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) { const e = (body as { error?: { code?: string; message?: string } } | null)?.error; throw new ApiError(r.status, e?.code ?? 'HTTP_' + r.status, e?.message ?? 'Request failed'); }
  return body as T;
}
export const api = {
  health: () => call<Health>('/api/v1/app/health'),
  list: async () => (await call<{ dogs: Dog[]; storageEngine: string }>('/api/v1/customer/dogs')),
  async register(input: Record<string, string | number | null>, idempotencyKey: string): Promise<{ dog: Dog; replayed: boolean }> {
    // Fetch the server-held, session-bound CSRF token before every write.
    const { csrfToken } = await call<{ csrfToken: string }>('/api/v1/customer/csrf');
    if (typeof csrfToken !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(csrfToken)) throw new ApiError(0, 'CSRF_INVALID', 'Could not verify session');
    const res = await call<{ dog: Dog; replayed: boolean }>('/api/v1/customer/dogs', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, 'X-CSRF-Token': csrfToken }, body: JSON.stringify(input) });
    if (!res || !res.dog || typeof res.dog.id !== 'string') throw new ApiError(0, 'BAD_RESPONSE', 'Server did not confirm the record');
    return res;
  },
};
