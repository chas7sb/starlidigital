import DOMPurify from 'dompurify';

const FILE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const CONTROLS = /[\u0000-\u001f\u007f]/;
const fallbackOrigin = 'https://starlidigital.invalid';

/** Navigation remains explicit; script/data/file URLs and user-info are never accepted. */
export function safeNavigationUrl(value: unknown, origin = typeof window === 'undefined' ? fallbackOrigin : window.location.origin): string | null {
 if (typeof value !== 'string' || !value.trim() || CONTROLS.test(value)) return null;
 try {
  const url = new URL(value.trim(), origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  return url.href;
 } catch { return null; }
}

export function fileContentUrl(id: unknown, backendBase = '', html = false): string | null {
 if (typeof id !== 'string' || !FILE_ID.test(id)) return null;
 return backendBase.replace(/\/$/, '') + '/api/v1/files/' + encodeURIComponent(id) + '/content' + (html ? '/html' : '');
}

/** Exact same-backend owned-file content path; no prefix or substring trust. */
export function safeOwnedFileUrl(value: unknown, backendBase = '', origin = typeof window === 'undefined' ? fallbackOrigin : window.location.origin): string | null {
 if (typeof value !== 'string' || CONTROLS.test(value)) return null;
 try {
  const base = new URL(backendBase || '/', origin);
  const url = new URL(value, origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password || url.search || url.hash) return null;
  const prefix = base.pathname.replace(/\/$/, '') + '/api/v1/files/';
  if (!url.pathname.startsWith(prefix)) return null;
  const suffix = url.pathname.slice(prefix.length);
  const match = suffix.match(/^([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/content(?:\/html)?$/);
  return match ? url.href : null;
 } catch { return null; }
}

/** Parse only the known embed shape; never return attacker-authored HTML or attributes. */
export function ownedFileEmbedUrl(value: unknown, backendBase = '', origin?: string): string | null {
 if (typeof value !== 'string' || value.length > 20_000 || typeof DOMParser === 'undefined') return null;
 const doc = new DOMParser().parseFromString(value, 'text/html');
 if (doc.body.childElementCount !== 1 || doc.body.firstElementChild?.tagName !== 'IFRAME') return null;
 const frame = doc.body.firstElementChild;
 return safeOwnedFileUrl(frame.getAttribute('src'), backendBase, origin);
}

/** Static rich text: keep formatting, tables and media; never executable document containers. */
export function sanitizeRichHtml(value: unknown): string {
 if (typeof value !== 'string' || typeof DOMPurify.sanitize !== 'function') return '';
 return DOMPurify.sanitize(value, {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'style', 'link', 'meta', 'base'],
  FORBID_ATTR: ['srcdoc', 'formaction', 'autofocus'],
  SANITIZE_NAMED_PROPS: true
 });
}

/** Only the application window may request automatic chat input/submission. */
export function trustedChatMessage(event: any, self: Window): boolean {
 if (!event || event.source !== self || event.origin !== self.location.origin || !event.data || typeof event.data !== 'object') return false;
 if (!['input:prompt', 'action:submit', 'input:prompt:submit'].includes(event.data.type)) return false;
 return event.data.type === 'action:submit' || (typeof event.data.text === 'string' && event.data.text.length <= 100_000);
}

/** Model-driven client execution belongs to one authenticated active conversation/session. */
export function currentSocketExecution(event: any, chatId: unknown, sessionId: unknown, userId: unknown, connected: boolean): boolean {
 return connected === true && typeof userId === 'string' && userId.length > 0 &&
  typeof chatId === 'string' && chatId.length > 0 && typeof sessionId === 'string' && sessionId.length > 0 &&
  event?.chat_id === chatId && event?.data?.data?.session_id === sessionId;
}
