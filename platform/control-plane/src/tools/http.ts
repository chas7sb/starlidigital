import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';
import { publicRequest } from '../public-http.js';

export function registerHttpTools(ctx: ToolContext) {
  const { server, principal, auditCall } = ctx;

  // 1. http_request
  server.tool(
    'http_request',
    'Execute a safe outbound HTTP/HTTPS request from the server side. Enforces SSRF protection, timeout, and response size limits. (Read/Write)',
    {
      url: z.string().url().describe('The destination URL to request'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional().default('GET').describe('HTTP method'),
      headers: z.record(z.string()).optional().describe('Optional request headers'),
      body: z.string().optional().describe('Optional request body'),
      timeoutSeconds: z.number().int().min(1).max(30).optional().default(15).describe('Timeout in seconds'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.method !== 'GET' && args.method !== 'HEAD';
      if (!hasScope(principal, isWrite ? 'write' : 'read')) {
        auditCall('http_request', args.url, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope', 'UNAUTHORIZED');
      }

      try {
        const res = await publicRequest(args.url, {
          method: args.method,
          headers: args.headers,
          body: args.body,
          timeoutMs: args.timeoutSeconds * 1000,
        });

        const text = res.text;
        const durationMs = Date.now() - start;

        const headersObj = res.headers;

        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          data = text.slice(0, 16000);
        }

        const result = {
          status: res.status,
          finalUrl: res.url,
          headers: headersObj,
          data,
          durationMs,
        };

        auditCall('http_request', args.url, start, res.status < 400 ? 'SUCCESS' : 'FAILED', args, { status: res.status });
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('http_request', args.url, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`HTTP request failed: ${err.message}`);
      }
    }
  );

  // 2. url_inspect
  server.tool(
    'url_inspect',
    'Inspect a public website URL: extract HTTP status, title, meta description, OpenGraph tags, and headers. (Read-Only)',
    {
      url: z.string().url().describe('The URL to inspect'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('url_inspect', args.url, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const res = await publicRequest(args.url, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StarliBot/1.0)' },
          timeoutMs: 15000,
        });

        const html = res.text;
        const titleMatch = html.match(/<title\b[^>]*>([^<]+)<\/title>/i);
        const descMatch = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
        const ogTitleMatch = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
        const ogDescMatch = html.match(/<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
        const ogImageMatch = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i);

        const data = {
          url: args.url,
          status: res.status,
          title: titleMatch ? titleMatch[1].trim() : null,
          description: descMatch ? descMatch[1].trim() : null,
          openGraph: {
            title: ogTitleMatch ? ogTitleMatch[1].trim() : null,
            description: ogDescMatch ? ogDescMatch[1].trim() : null,
            image: ogImageMatch ? ogImageMatch[1].trim() : null,
          },
          contentType: res.headers['content-type'],
          contentLengthBytes: html.length,
        };

        auditCall('url_inspect', args.url, start, 'SUCCESS', args);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('url_inspect', args.url, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`URL inspection failed: ${err.message}`);
      }
    }
  );
}
