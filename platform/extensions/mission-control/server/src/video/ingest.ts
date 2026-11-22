/**
 * SSRF-Safe Media Ingestion Engine
 * ================================
 * Provides secure URL import for generated images with DNS pinning, IP range blocking,
 * redirect inspection, and binary MIME verification.
 */

import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { AssetServices } from '../assets/service.js';
import type { IngestAssetResult } from '../assets/types.js';

const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MiB max
const FETCH_TIMEOUT_MS = 10000; // 10s max
const MAX_REDIRECTS = 3;

/** Checks if an IPv4 or IPv6 address is private, loopback, or reserved. */
export function isForbiddenIP(ipStr: string): boolean {
  if (!isIP(ipStr)) return true;

  // IPv4 checks
  if (isIP(ipStr) === 4) {
    const parts = ipStr.split('.').map(Number);
    const [a, b, c, d] = parts;

    // 0.0.0.0/8
    if (a === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (a === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata service e.g. 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private network)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (Private network)
    if (a === 192 && b === 168) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (TEST-NET)
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (a >= 224) return true;

    return false;
  }

  // IPv6 checks
  if (isIP(ipStr) === 6) {
    const lower = ipStr.toLowerCase();
    // ::1 (Loopback)
    if (lower === '::1' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    // :: (Unspecified)
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // fe80::/10 (Link-local)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // fc00::/7 (Unique local / private)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (lower.startsWith('::ffff:')) {
      const v4part = lower.replace('::ffff:', '');
      return isForbiddenIP(v4part);
    }
  }

  return false;
}

export interface ImportFromUrlOptions {
  url: string;
  assetServices: AssetServices;
  ownerId: string;
  projectId?: string;
  filenameHint?: string;
  altText?: string;
}

export async function importMediaFromUrl(options: ImportFromUrlOptions): Promise<IngestAssetResult> {
  const { url: initialUrl, assetServices, ownerId, projectId, filenameHint, altText } = options;

  let currentUrl = initialUrl;
  let redirectsRemaining = MAX_REDIRECTS;

  while (redirectsRemaining >= 0) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new Error(`Invalid URL format: "${currentUrl}"`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Forbidden protocol: "${parsed.protocol}". Only HTTP and HTTPS are permitted.`);
    }

    const hostname = parsed.hostname;

    // Reject localhost hostname variants explicitly
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname === '127.0.0.1' ||
      hostname === '::1'
    ) {
      throw new Error(`Access to local/private target ${hostname} is forbidden.`);
    }

    // DNS Resolution check
    const resolved = await lookup(hostname, { all: true });
    if (!resolved || resolved.length === 0) {
      throw new Error(`DNS resolution failed for hostname "${hostname}"`);
    }

    for (const record of resolved) {
      if (isForbiddenIP(record.address)) {
        throw new Error(`Target address "${record.address}" is within a private or reserved network range and is forbidden.`);
      }
    }

    const pinnedIP = resolved[0].address;
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions = {
      protocol: parsed.protocol,
      hostname: hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        Host: hostname,
        'User-Agent': 'StarliDigital-MediaIngest/1.0',
        Accept: 'image/png,image/jpeg,image/webp,*/*',
      },
      lookup: (_hostname: string, _opts: any, cb: any) => {
        cb(null, pinnedIP, resolved[0].family);
      },
    };

    const res = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; buffer: Buffer }>(
      (resolve, reject) => {
        const req = client.request(requestOptions, (incoming) => {
          const status = incoming.statusCode || 500;

          // Handle redirect
          if (status >= 300 && status < 400 && incoming.headers.location) {
            incoming.resume();
            const nextUrl = new URL(incoming.headers.location, currentUrl).href;
            resolve({ statusCode: status, headers: incoming.headers, buffer: Buffer.from(nextUrl) });
            return;
          }

          if (status !== 200) {
            incoming.resume();
            reject(new Error(`Server responded with HTTP ${status}`));
            return;
          }

          const contentLength = Number(incoming.headers['content-length'] || 0);
          if (contentLength > MAX_IMPORT_BYTES) {
            incoming.resume();
            reject(new Error(`Remote file size (${contentLength} bytes) exceeds 20 MiB limit`));
            return;
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;

          incoming.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_IMPORT_BYTES) {
              incoming.destroy();
              reject(new Error(`Download exceeded maximum limit of 20 MiB`));
              return;
            }
            chunks.push(chunk);
          });

          incoming.on('end', () => {
            resolve({ statusCode: status, headers: incoming.headers, buffer: Buffer.concat(chunks) });
          });

          incoming.on('error', reject);
        });

        req.setTimeout(FETCH_TIMEOUT_MS, () => {
          req.destroy(new Error(`Media fetch timed out after ${FETCH_TIMEOUT_MS}ms`));
        });

        req.on('error', reject);
        req.end();
      }
    );

    if (res.statusCode >= 300 && res.statusCode < 400) {
      currentUrl = res.buffer.toString('utf-8');
      redirectsRemaining--;
      continue;
    }

    // Ingest the downloaded buffer via AssetServices
    const detectedFilename = filenameHint || parsed.pathname.split('/').pop() || 'imported_image';
    return await assetServices.ingestImage({
      buffer: res.buffer,
      mimeType: String(res.headers['content-type'] || 'image/png'),
      filenameHint: detectedFilename,
      altText,
      visibility: 'PRIVATE',
      ownerId,
      projectId,
    });
  }

  throw new Error(`Too many redirects encountered while fetching media`);
}
