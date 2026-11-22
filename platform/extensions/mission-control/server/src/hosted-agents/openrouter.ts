export const PREFERRED_FREE_MODELS = [
  'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-ultra-550b-a55b:free',
  'google/gemma-3-27b-it:free', 'google/gemma-3-12b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-next-80b-a3b-instruct:free',
  'mistralai/mistral-small-3.2-24b-instruct:free', 'meta-llama/llama-3.2-3b-instruct:free',
  'qwen/qwen-2.5-7b-instruct:free', 'mistralai/mistral-7b-instruct:free'
] as const;

export interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface CompletionOptions {
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, any>;
    };
  }>;
  toolChoice?: 'auto' | 'none';
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CompletionResult {
  reply: string;
  toolCalls?: OpenRouterToolCall[];
  model: string;
  latencyMs: number;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface ModelRouterOptions {
  apiKey?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  clock?: () => number;
  catalogTtlMs?: number;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxAttempts?: number;
}

class RoutingStopped extends Error {}
const bounded = (value: number | undefined, fallback: number, maximum: number) => Number.isFinite(value) && value! > 0 ? Math.min(value!, maximum) : fallback;
const usageCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const zeroPrice = (value: unknown) => value === 0 || typeof value === 'string' && /^(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i.test(value.trim());
const FREE_ROUTER = 'openrouter/free';

function verifiedTextModel(item: any): boolean {
  if (typeof item?.id !== 'string' || item.id.length > 200 || !/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?$/i.test(item.id)) return false;
  const architecture = item.architecture;
  if (!Array.isArray(architecture?.input_modalities) || !architecture.input_modalities.includes('text') || !Array.isArray(architecture.output_modalities) || architecture.output_modalities.length !== 1 || architecture.output_modalities[0] !== 'text') return false;
  if (!zeroPrice(item.pricing?.prompt) || !zeroPrice(item.pricing?.completion)) return false;
  // Reject nonzero ancillary prices as well: some text-priced-zero entries bill per request.
  if (Object.values(item.pricing).some(value => !zeroPrice(value))) return false;
  if (Array.isArray(item.endpoints) && !item.endpoints.includes('/api/v1/chat/completions') && !item.endpoints.includes('chat/completions')) return false;
  return true;
}

/** Free-only routing: a free suffix does not replace current explicit price verification. */
export class OpenRouterModelRouter {
  private apiKey?: string;
  private fetchFn: typeof fetch;
  private baseUrl: string;
  private clock: () => number;
  private catalogTtlMs: number;
  private requestTimeoutMs: number;
  private totalTimeoutMs: number;
  private maxAttempts: number;
  private cachedFreeModelIds: Set<string> | null = null;
  private catalogCachedAt = 0;
  private modelCooldowns = new Map<string, number>();
  private globalCooldownUntil = 0;

  constructor(options: ModelRouterOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    this.fetchFn = options.fetch || globalThis.fetch;
    this.baseUrl = (options.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    this.clock = options.clock || Date.now;
    this.catalogTtlMs = bounded(options.catalogTtlMs, 5 * 60000, 15 * 60000);
    this.requestTimeoutMs = bounded(options.requestTimeoutMs, 20000, 25000);
    this.totalTimeoutMs = bounded(options.totalTimeoutMs, 35000, 35000);
    this.maxAttempts = Math.floor(bounded(options.maxAttempts, 3, 3));
  }

  private async requestJson(url: string, init: RequestInit, timeoutMs: number, maxBytes: number, parentSignal?: AbortSignal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (parentSignal?.aborted) throw new Error('TURN_ABORTED');
    parentSignal?.addEventListener('abort', onAbort, {once:true});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('PROVIDER_TIMEOUT')); }, Math.max(1, timeoutMs)); });
    const work = async () => {
      const response = await this.fetchFn(url, { ...init, signal: controller.signal });
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
      let text = '';
      if (response.body) {
        const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0;
        try {
          while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > maxBytes) throw new Error('PROVIDER_RESPONSE_TOO_LARGE'); text += decoder.decode(chunk.value, { stream: true }); }
          text += decoder.decode();
        } finally { void reader.cancel().catch(() => {}); }
      }
      let data: any;
      try { data = JSON.parse(text); } catch { if (response.ok) throw new Error('PROVIDER_MALFORMED_RESPONSE'); }
      return { response, data };
    };
    try { return await Promise.race([work(), timeout]); }
    finally { if (timer) clearTimeout(timer); parentSignal?.removeEventListener('abort', onAbort); controller.abort(); }
  }

  async getVerifiedFreeModels(timeoutMs = 10000): Promise<Set<string>> {
    const now = this.clock();
    if (this.cachedFreeModelIds && now - this.catalogCachedAt < this.catalogTtlMs) return new Set(this.cachedFreeModelIds);
    try {
      const { response, data } = await this.requestJson(`${this.baseUrl}/models`, { headers: { Accept: 'application/json', 'HTTP-Referer': 'https://starlidigital.ro', 'X-Title': 'StarliDigital Hosted Agents' } }, Math.min(10000, timeoutMs), 2 * 1024 * 1024);
      if (!response.ok || !Array.isArray(data?.data)) throw new Error('FREE_MODEL_CATALOG_UNAVAILABLE');
      const verified = new Set<string>();
      for (const item of data.data) {
        if (!verifiedTextModel(item)) continue;
        verified.add(item.id);
      }
      this.cachedFreeModelIds = verified; this.catalogCachedAt = now; return new Set(verified);
    } catch { this.cachedFreeModelIds = null; throw new Error('FREE_MODEL_CATALOG_UNAVAILABLE'); }
  }

  async getCandidateModels(timeoutMs = 10000): Promise<string[]> {
    const now = this.clock();
    if (this.globalCooldownUntil > now) throw new RoutingStopped('OPENROUTER_ACCOUNT_COOLDOWN');
    const verified = await this.getVerifiedFreeModels(timeoutMs);
    const preferred = PREFERRED_FREE_MODELS.filter(model => verified.has(model));
    const preferredIds = new Set<string>(preferred);
    const discovered = [...verified].filter(model => !preferredIds.has(model) && model !== FREE_ROUTER).sort();
    return [...(verified.has(FREE_ROUTER) ? [FREE_ROUTER] : []), ...preferred, ...discovered].filter(model => (this.modelCooldowns.get(model) || 0) <= now);
  }

  private matchesVerifiedResponse(selected: string, reported: unknown): boolean {
    if (reported === undefined || reported === null) return selected !== FREE_ROUTER;
    if (typeof reported !== 'string') return false;
    if (reported === selected || reported === selected.replace(/:free$/, '')) return true;
    // The free router reports its selected underlying model, never the router alias.
    if (selected !== FREE_ROUTER) return false;
    return [...(this.cachedFreeModelIds || [])].some(id => id !== FREE_ROUTER && (reported === id || reported === id.replace(/:free$/, '')));
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    if (!this.apiKey) throw new RoutingStopped('OPENROUTER_NOT_CONFIGURED');
    if (!Array.isArray(options.messages) || !options.messages.length || options.messages.length > 50) {
      throw new Error('INVALID_MODEL_CONTEXT');
    }

    const totalChars = options.messages.reduce((len, m) => {
      let l = (m.content || '').length;
      if (m.tool_calls) l += JSON.stringify(m.tool_calls).length;
      return len + l;
    }, 0);
    if (totalChars > 100000) throw new Error('INVALID_MODEL_CONTEXT');

    for (const m of options.messages) {
      if (!['system', 'user', 'assistant', 'tool'].includes(m.role)) {
        throw new Error('INVALID_MODEL_CONTEXT');
      }
      if (m.role === 'tool') {
        if (typeof m.content !== 'string' || typeof m.tool_call_id !== 'string') {
          throw new Error('INVALID_MODEL_CONTEXT');
        }
      } else if (m.role === 'assistant') {
        if (typeof m.content !== 'string' && (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0)) {
          throw new Error('INVALID_MODEL_CONTEXT');
        }
      } else {
        if (typeof m.content !== 'string') {
          throw new Error('INVALID_MODEL_CONTEXT');
        }
      }
    }

    if (options.signal?.aborted) throw new Error('TURN_ABORTED');
    const callTimeout = Math.min(this.totalTimeoutMs, bounded(options.timeoutMs, this.totalTimeoutMs, 35000));
    const deadline = Date.now() + callTimeout;
    const available = await this.getCandidateModels(Math.min(10000, callTimeout));
    const candidates = available.slice(0, this.maxAttempts);
    if (!candidates.length) throw new Error('NO_VERIFIED_FREE_MODEL_AVAILABLE');

    let attempts = 0;
    for (const model of candidates) {
      const remaining = deadline - Date.now(); if (remaining <= 0 || options.signal?.aborted) break;
      attempts++; const attemptStart = Date.now();
      try {
        const bodyPayload: Record<string, any> = {
          model,
          messages: options.messages,
          temperature: Math.min(1, Math.max(0, options.temperature ?? 0.3)),
          max_tokens: Math.min(1500, Math.max(1, options.maxTokens || 800)),
          modalities: ['text'],
          reasoning: { enabled: false, exclude: true },
          provider: { max_price: { prompt: 0, completion: 0, request: 0 } }
        };

        if (Array.isArray(options.tools) && options.tools.length > 0) {
          bodyPayload.tools = options.tools;
          if (options.toolChoice) {
            bodyPayload.tool_choice = options.toolChoice;
          }
        }

        const { response, data } = await this.requestJson(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://starlidigital.ro',
            'X-Title': 'StarliDigital Hosted Agents'
          },
          body: JSON.stringify(bodyPayload)
        }, Math.min(this.requestTimeoutMs, remaining), 64 * 1024, options.signal);

        if ([401, 403, 402].includes(response.status)) {
          this.globalCooldownUntil = this.clock() + 300000;
          throw new RoutingStopped(response.status === 402 ? 'OPENROUTER_ACCOUNT_LIMIT' : 'OPENROUTER_AUTH_UNAVAILABLE');
        }

        if (response.status === 429) {
          const source = String(data?.error?.metadata?.limit_source || '');
          const message = String(data?.error?.message || '').slice(0, 1000);
          if (/account|daily|free.?model|requests_per_day|rpd|budget|credits/i.test(source) || /per.day|daily|account.quota/i.test(message)) {
            this.globalCooldownUntil = this.clock() + 300000;
            throw new RoutingStopped('OPENROUTER_ACCOUNT_LIMIT');
          }
          this.modelCooldowns.set(model, this.clock() + 60000);
          continue;
        }

        if (!response.ok) {
          this.modelCooldowns.set(model, this.clock() + 30000);
          continue;
        }

        if (data?.usage?.cost != null && !zeroPrice(data.usage.cost)) {
          this.globalCooldownUntil = this.clock() + 300000;
          throw new RoutingStopped('OPENROUTER_UNEXPECTED_COST');
        }

        const choice = data?.choices?.[0];
        const content = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
        const rawToolCalls = choice?.message?.tool_calls;
        const toolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length > 0
          ? rawToolCalls.map((tc: any) => ({
              id: String(tc.id || ''),
              type: 'function' as const,
              function: {
                name: String(tc.function?.name || ''),
                arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
              }
            }))
          : undefined;

        if (toolCalls && (toolCalls.length > 8 || toolCalls.some(tc => !/^[a-zA-Z0-9_-]{1,128}$/.test(tc.id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(tc.function.name) || tc.function.arguments.length > 8192))) { this.modelCooldowns.set(model, this.clock() + 15000); continue; }
        if (!content && !toolCalls) {
          this.modelCooldowns.set(model, this.clock() + 15000);
          continue;
        }

        if (content.length > 12000 || !this.matchesVerifiedResponse(model, data.model)) {
          this.modelCooldowns.set(model, this.clock() + 15000);
          continue;
        }

        return {
          reply: content,
          toolCalls,
          model,
          latencyMs: Date.now() - attemptStart,
          finishReason: choice.finish_reason,
          usage: data.usage ? {
            promptTokens: usageCount(data.usage.prompt_tokens),
            completionTokens: usageCount(data.usage.completion_tokens),
            totalTokens: usageCount(data.usage.total_tokens)
          } : undefined
        };
      } catch (error) {
        if (error instanceof RoutingStopped) throw error;
        this.modelCooldowns.set(model, this.clock() + 30000);
      }
    }
    throw new Error(`OPENROUTER_UNAVAILABLE_AFTER_${attempts}_ATTEMPTS`);
  }
}
