export const SENSITIVE_QUERY_KEYS = ['token', 'code', 'claim', 'claimcode', 'otp', 'secret', 'key'];

export function isSensitiveSearch(search: string): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.toLowerCase());
  return SENSITIVE_QUERY_KEYS.some((key) => params.has(key));
}

export function sanitizePathForAnalytics(path: string, search: string): string {
  if (!search || !isSensitiveSearch(search)) {
    return path;
  }
  // Strip all sensitive params from analytics
  const params = new URLSearchParams(search);
  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_QUERY_KEYS.includes(key.toLowerCase())) {
      params.delete(key);
    }
  }
  const remaining = params.toString();
  return remaining ? `${path}?${remaining}` : path;
}

export function shouldTrackRoute(previous: string | null, path: string, search: string): boolean {
  if (previous === null || previous === path) return false;
  if (path === '/reset-password') return false;
  if (isSensitiveSearch(search)) return false;
  return true;
}
