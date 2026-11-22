const SENSITIVE_KEY_REGEX = /(?:token|password|secret|key|authorization|bearer|cookie|credential)/i;

export function redactSecrets(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // Redact bearer tokens if present in strings
    return data.replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer [REDACTED]');
  }
  if (Array.isArray(data)) {
    return data.map(item => redactSecrets(item));
  }
  if (typeof data === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        cleaned[key] = '[REDACTED]';
      } else {
        cleaned[key] = redactSecrets(val);
      }
    }
    return cleaned;
  }
  return data;
}
