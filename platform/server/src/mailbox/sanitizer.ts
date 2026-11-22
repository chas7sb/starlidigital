export interface SanitizeResult {
  sanitizedHtml: string;
  hasRemoteImages: boolean;
  blockedTagsCount: number;
}

const DANGEROUS_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'meta',
  'link',
  'base',
  'form',
  'input',
  'button',
  'svg',
  'canvas',
  'audio',
  'video'
]);

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'a', 'img', 'hr', 'font', 'small', 'sub', 'sup'
]);

const ALLOWED_ATTRS = new Set([
  'href', 'title', 'alt', 'src', 'width', 'height', 'align', 'valign', 'border', 'cellpadding', 'cellspacing', 'style', 'class', 'target', 'data-original-src'
]);

const DANGEROUS_PROTOCOLS = /^(javascript|data|vbscript|file):/i;

/**
 * Sanitizes inbound HTML emails.
 * Strips active content, scripts, object tags, forms, event handlers.
 * Blocks remote images by default to prevent tracking beacons unless explicit flag is passed.
 * Neutralizes javascript: / data: hrefs.
 */
export function sanitizeHtml(html: string, options: { allowRemoteImages?: boolean } = {}): SanitizeResult {
  if (!html || typeof html !== 'string') {
    return { sanitizedHtml: '', hasRemoteImages: false, blockedTagsCount: 0 };
  }

  let hasRemoteImages = false;
  let blockedTagsCount = 0;

  // 1. Strip comments and DOCTYPE
  let clean = html.replace(/<!--[\s\S]*?-->/g, '');
  clean = clean.replace(/<!DOCTYPE[\s\S]*?>/gi, '');

  // 2. Strip dangerous tags and their content for executable types
  for (const dangerous of ['script', 'style', 'iframe', 'object', 'embed', 'applet', 'meta', 'link']) {
    const reg = new RegExp(`<${dangerous}\\b[^>]*>[\\s\\S]*?<\\/${dangerous}>`, 'gi');
    if (reg.test(clean)) {
      blockedTagsCount++;
      clean = clean.replace(reg, '');
    }
    const singleReg = new RegExp(`<${dangerous}\\b[^>]*\\/?>`, 'gi');
    if (singleReg.test(clean)) {
      blockedTagsCount++;
      clean = clean.replace(singleReg, '');
    }
  }

  // 3. Parse tags and sanitize attributes
  clean = clean.replace(/<\/?([a-zA-Z0-9_-]+)([^>]*)>/g, (match, tagName, attrsStr) => {
    const lowerTag = tagName.toLowerCase();
    const isClosing = match.startsWith('</');

    if (!ALLOWED_TAGS.has(lowerTag)) {
      blockedTagsCount++;
      return '';
    }

    if (isClosing) {
      return `</${lowerTag}>`;
    }

    // Process attributes
    const attrRegex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+)))?/g;
    let attrMatch: RegExpExecArray | null;
    const cleanAttrs: string[] = [];

    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      let attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

      // Block all inline event handlers (onload, onclick, onerror, etc.)
      if (attrName.startsWith('on')) {
        continue;
      }

      if (!ALLOWED_ATTRS.has(attrName)) {
        continue;
      }

      // Handling img src (tracking pixels / remote images)
      if (lowerTag === 'img' && attrName === 'src') {
        const isRemote = /^https?:\/\//i.test(attrVal.trim());
        if (isRemote) {
          hasRemoteImages = true;
          if (!options.allowRemoteImages) {
            cleanAttrs.push(`data-original-src="${escapeHtml(attrVal)}"`);
            cleanAttrs.push('src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'1\' height=\'1\'></svg>"');
            continue;
          }
        }
      }

      // Check URL protocols for other href/src (including HTML entity decoded checks like &#x6A;avascript:)
      if (attrName === 'href' || (attrName === 'src' && lowerTag !== 'img')) {
        const decodedEntities = attrVal
          .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/&#([0-9]+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
        const decodedVal = decodedEntities.trim().replace(/[\u0000-\u001F\u007F-\u009F\s]/g, '');
        if (DANGEROUS_PROTOCOLS.test(decodedVal)) {
          attrVal = '#blocked-unsafe-url';
        }
      }

      // Sanitize inline styles - block url(), expression(), behavior, -moz-binding, and clean background-image
      if (attrName === 'style') {
        if (/url\s*\(|expression|behavior|-moz-binding/i.test(attrVal)) {
          attrVal = attrVal
            .replace(/(?:background-image|background)\s*:[^;]+;?/gi, '')
            .replace(/url\s*\([^)]*\)/gi, '')
            .replace(/expression\([^)]*\)/gi, '');
        }
      }

      if (attrName === 'target') {
        attrVal = '_blank';
      }

      cleanAttrs.push(`${attrName}="${escapeHtml(attrVal)}"`);
    }

    if (lowerTag === 'a') {
      if (!cleanAttrs.some(a => a.startsWith('rel='))) {
        cleanAttrs.push('rel="noopener noreferrer"');
      }
    }

    const attrsSerialized = cleanAttrs.length > 0 ? ' ' + cleanAttrs.join(' ') : '';
    return `<${lowerTag}${attrsSerialized}>`;
  });

  return {
    sanitizedHtml: clean.trim(),
    hasRemoteImages,
    blockedTagsCount
  };
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Redacts OTP codes, password reset tokens, and raw credential secrets
 * from summaries and email previews for logging and CRM timeline display.
 */
export function redactSecrets(text: string): string {
  if (!text) return '';
  let result = text;

  // 1. Redact reset token queries: ?token=xyz or &token=xyz
  result = result.replace(/([?&]token=)[a-zA-Z0-9_\-\.%]{6,}/gi, '$1[REDACTED_TOKEN]');

  // 2. Redact OTP 4-8 digit codes in standard phrases (e.g., "codul tău este 123456", "codul valid: 12345", "code is 1234")
  result = result.replace(/(cod(?:ul| de securitate| de confirmare|ul valid|ul tău)?(?:\s+de\s+[a-zA-Z]+)?\s*(?:este|:)?\s*)\b\d{4,8}\b/gi, '$1[REDACTED_OTP]');
  result = result.replace(/(code\s*(?:is|:)?\s*)\b\d{4,8}\b/gi, '$1[REDACTED_OTP]');
  result = result.replace(/(verification code\s*(?:is|:)?\s*)\b\d{4,8}\b/gi, '$1[REDACTED_OTP]');

  // 3. Redact raw password assignments / mentions (do not match words ending in -password like /reset-password)
  result = result.replace(/(?<![\/-])\b(parola(?: aleasă)?\s*(?:este|:)?\s*)(["']?[^"'\s\n]{6,}["']?)/gi, '$1[REDACTED_PASSWORD]');
  result = result.replace(/(?<![\/-])\b(password\s*(?:is|:)?\s*)(["']?[^"'\s\n]{6,}["']?)/gi, '$1[REDACTED_PASSWORD]');

  // 4. Redact JWT / bearer tokens
  result = result.replace(/\beyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\b/g, '[REDACTED_JWT]');

  return result;
}
