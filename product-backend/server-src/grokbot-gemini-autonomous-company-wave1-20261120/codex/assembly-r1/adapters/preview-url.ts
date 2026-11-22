/** Mini9 W2 strict, pure URL gate for native-owned private iframe resources.
 * No user/model URL can grant authority. All origins supplied by native backend.
 */
export type PreviewUrlInput = Readonly<{
  trustedUrl: string | null;
  previewOrigin: string | null;
  parentOrigin: string | null;
  previewId: string;
  isolatedStorageAttested: boolean;
}>;

/** Returns null when a URL is unsafe. The SERVER MUST verify ticket on every
 * HTTP request; client-side URL parsing is defense in depth, not access control.
 */
export function trustedPreviewIframeUrl(input: PreviewUrlInput): string | null {
  if (!input.isolatedStorageAttested || !input.trustedUrl ||
      !input.previewOrigin || !input.parentOrigin ||
      !/^[A-Za-z0-9_-]{16,96}$/.test(input.previewId)) return null;
  try {
    const origin = new URL(input.previewOrigin);
    const parent = new URL(input.parentOrigin);
    const u = new URL(input.trustedUrl);
    if (origin.protocol !== 'https:' || parent.protocol !== 'https:' ||
        u.protocol !== 'https:' || !origin.hostname || !parent.hostname ||
        u.origin !== origin.origin || origin.origin === parent.origin) return null;
    if (origin.username || origin.password || u.username || u.password ||
        u.search || u.hash || u.port && u.port !== '443' ||
        origin.pathname !== '/' || origin.search || origin.hash ||
        parent.pathname !== '/' || parent.search || parent.hash) return null;
    if (origin.hostname === parent.hostname ||
        origin.hostname.endsWith('.' + parent.hostname) ||
        parent.hostname.endsWith('.' + origin.hostname)) return null;
    // Resource URL is server-issued, opaque scoped ticket (NOT arbitrary paths).
    const expectedPrefix = '/v2/private/' + input.previewId + '/';
    if (!u.pathname.startsWith(expectedPrefix)) return null;
    const token = u.pathname.slice(expectedPrefix.length);
    if (!/^[A-Za-z0-9_-]{40,3000}\.[A-Za-z0-9_-]{40,120}\/?$/.test(token)) return null;
    if (u.href.length > 4096) return null;
    return u.href;
  } catch {
    return null;
  }
}
