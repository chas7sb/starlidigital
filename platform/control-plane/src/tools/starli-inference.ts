import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';

const ENDPOINT = 'https://cad-picture-timely-financing.trycloudflare.com';

export function registerStarliInferenceTools(ctx: ToolContext) {
  const { server, principal, auditCall } = ctx;
  server.tool('starli_inference_test', 'Admin-only test of private Vast.ai inference including streaming; API key stays server-side.', {
    prompt: z.string().min(1).max(1000).default('Reply exactly: STARLI INFERENCE ONLINE'),
    stream: z.boolean().default(true),
  }, async (args) => {
    const start = Date.now();
    if (!hasScope(principal, 'admin')) return errorResponse('Admin only', 'UNAUTHORIZED');
    const key = process.env.STARLI_INFERENCE_API_KEY;
    if (!key) return errorResponse('STARLI_INFERENCE_API_KEY is not configured');
    try {
      const base = process.env.STARLI_INFERENCE_BASE_URL || `${ENDPOINT}/v1`;
      const u = new URL(base);
      if (u.protocol !== 'https:' || u.hostname !== new URL(ENDPOINT).hostname || u.pathname !== '/v1') return errorResponse('Inference endpoint is not allowlisted');
      const response = await fetch(`${u.origin}/v1/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'starli-coder', messages: [{ role: 'user', content: args.prompt }], max_tokens: 80, stream: args.stream }),
        signal: AbortSignal.timeout(45000),
      });
      const raw = (await response.text()).slice(0, 50000);
      const tokens = args.stream ? raw.split('\n').filter(line => line.startsWith('data: ')).map(line => { try { return JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || ''; } catch { return ''; } }).join('') : (JSON.parse(raw).choices?.[0]?.message?.content || '');
      const result = { status: response.status, ok: response.ok, streaming: args.stream, response: tokens.slice(0, 4000), eventCount: args.stream ? raw.split('\n').filter(line => line.startsWith('data: ')).length : 0, durationMs: Date.now() - start };
      auditCall('starli_inference_test', undefined, start, response.ok ? 'SUCCESS' : 'FAILED', { streaming: args.stream }, { status: response.status });
      return jsonResponse(result);
    } catch (err: any) { auditCall('starli_inference_test', undefined, start, 'FAILED', { streaming: args.stream }, undefined, String(err)); return errorResponse('Inference test failed: ' + String(err)); }
  });
}
