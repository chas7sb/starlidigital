import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const AI_RUNTIME_KEYS=new Set(['STARLI_MODEL','STARLI_MODEL_ID','STARLI_ENABLE_THINKING','STARLI_COOKIE','STARLI_CSRF_TOKEN','STARLI_TIMEOUT_SECONDS','STARLI_DEBUG','STARLI_AUTO_CREATE_CONVERSATION','STARLI_CREATE_MODEL','STARLI_RATE_LIMIT_MAX_RETRIES','STARLI_RATE_LIMIT_BASE_DELAY_MS','STARLI_RATE_LIMIT_MAX_DELAY_MS','STARLI_CONVERSATION_API_BASE','STARLI_CONVERSATION_ID','STARLI_API_URL']);

export class LLMConfigurationError extends Error {}
export class LLMRateLimitError extends Error {
  retryAfterMs: number;
  transient: boolean;
  constructor(message: string, { retryAfterMs = 0 }: { retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'LLMRateLimitError';
    this.retryAfterMs = Number(retryAfterMs || 0);
    this.transient = true;
  }
}

export function resolveRootEnvPath(customPath?: string): string {
  if (customPath) return path.resolve(customPath);
  if(process.env.STARLI_RUNTIME_ENV_PATH)return path.resolve(process.env.STARLI_RUNTIME_ENV_PATH);
  const rootCandidate = fileURLToPath(new URL('../../.env', import.meta.url));
  if (fs.existsSync(rootCandidate)) return rootCandidate;
  const serverCandidate = fileURLToPath(new URL('../.env', import.meta.url));
  if (fs.existsSync(serverCandidate)) return serverCandidate;
  return rootCandidate;
}

export function readDotenv(dotenvPath?: string): Record<string, string> {
  const resolved = resolveRootEnvPath(dotenvPath);
  if (!fs.existsSync(resolved)) {
    return {};
  }
  const values: Record<string, string> = {};
  const text = fs.readFileSync(resolved, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (!key) {
      continue;
    }
    if (value.length >= 2 && value[0] === value[value.length - 1] && ["'", '"'].includes(value[0])) {
      try{value=value[0]==='"'?JSON.parse(value):value.slice(1,-1);}catch{value=value.slice(1,-1);}
    }
    values[key] = value;
  }
  return values;
}

export function loadAIRuntimeEnv():void{
  if(!process.env.STARLI_RUNTIME_ENV_PATH)return;
  const values=readDotenv(process.env.STARLI_RUNTIME_ENV_PATH);
  for(const [key,value]of Object.entries(values))if(AI_RUNTIME_KEYS.has(key)&&!/[\r\n\0]/.test(value))process.env[key]=value;
}

export function localEnvValue(localEnv: Record<string, string>, key: string, fallback = ''): string {
  if (process.env[key] !== undefined && process.env[key] !== '') {
    return String(process.env[key]);
  }
  if (localEnv && Object.prototype.hasOwnProperty.call(localEnv, key) && localEnv[key] !== '') {
    return localEnv[key];
  }
  return fallback;
}

export function upsertEnvValues(values: Record<string, string>, dotenvPath?: string): void {
  const resolved = resolveRootEnvPath(dotenvPath);
  for(const [key,value]of Object.entries(values))if(!AI_RUNTIME_KEYS.has(key)||typeof value!=='string'||/[\r\n\0]/.test(value)||value.length>20000)throw new LLMConfigurationError('Configurația AI conține un câmp sau o valoare nepermisă.');
  const lines = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8').split(/\r?\n/) : [];
  const found = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    let replaced = false;
    for (const [key, value] of Object.entries(values)) {
      if (line.startsWith(`${key}=`)) {
        output.push(`${key}=${JSON.stringify(value)}`);
        found.add(key);
        replaced = true;
        break;
      }
    }
    if (!replaced && line !== ''&&(!process.env.STARLI_RUNTIME_ENV_PATH||AI_RUNTIME_KEYS.has(line.split('=')[0].trim()))) {
      output.push(line);
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (!found.has(key)) {
      output.push(`${key}=${JSON.stringify(value)}`);
    }
  }

  fs.mkdirSync(path.dirname(resolved),{recursive:true,mode:0o700});const temporary=resolved+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,`${output.join('\n')}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});fs.renameSync(temporary,resolved);fs.chmodSync(resolved,0o600);}
  catch{try{fs.rmSync(temporary,{force:true});}catch{}throw new LLMConfigurationError('Configurația AI nu a putut fi salvată în fișierul runtime. Verifică permisiunile serverului.');}
}

export type OutlierClientOptions = {
  systemPromptBuilder?: () => string;
  continuityContextBuilder?: (() => Record<string, unknown>) | null;
  envPath?: string;
  persistRuntime?: boolean;
  /** Operator diagnostics only. Customer sessions must never inherit global conversation state. */
  allowGlobalConversation?: boolean;
  onRotate?: (conversationId: string, apiUrl: string, parentIdx: number) => void;
  initialConversationId?: string;
  initialApiUrl?: string;
  initialParentIdx?: number;
};

export class OutlierClient {
  env: Record<string, string>;
  provider: string;
  systemPromptBuilder: () => string;
  continuityContextBuilder: (() => Record<string, unknown>) | null;
  envPath: string;
  persistRuntime: boolean;
  onRotate?: (conversationId: string, apiUrl: string, parentIdx: number) => void;
  parentIdx: number;
  model: string;
  modelId: string;
  enableThinking: boolean;
  cookie: string;
  csrfToken: string;
  requestTimeout: number;
  debug: boolean;
  autoCreateConversation: boolean;
  createModel: string;
  rateLimitMaxRetries: number;
  rateLimitBaseDelayMs: number;
  rateLimitMaxDelayMs: number;
  conversationApiBase: string;
  conversationId: string;
  apiUrl: string;

  constructor({
    systemPromptBuilder = () => '-',
    continuityContextBuilder = null,
    envPath = undefined,
    persistRuntime = false,
    allowGlobalConversation = false,
    onRotate = undefined,
    initialConversationId = undefined,
    initialApiUrl = undefined,
    initialParentIdx = 0
  }: OutlierClientOptions = {}) {
    if(!envPath)loadAIRuntimeEnv();
    this.envPath = resolveRootEnvPath(envPath);
    this.env = readDotenv(this.envPath);
    this.provider = 'outlier';
    this.systemPromptBuilder = systemPromptBuilder;
    this.continuityContextBuilder = continuityContextBuilder;
    this.persistRuntime = persistRuntime && process.env.NODE_ENV !== 'test';
    this.onRotate = onRotate;
    this.parentIdx = Number(initialParentIdx || 0);
    this.model = normalizeOutlierModel(localEnvValue(this.env, 'STARLI_MODEL', 'claude-opus-4-6'));
    this.modelId = String(localEnvValue(this.env, 'STARLI_MODEL_ID', '')).trim();
    this.enableThinking = !['0', 'false', 'no', 'off'].includes(String(localEnvValue(this.env, 'STARLI_ENABLE_THINKING', '1')).toLowerCase());
    this.cookie = String(localEnvValue(this.env, 'STARLI_COOKIE', '')).trim();
    this.csrfToken = String(localEnvValue(this.env, 'STARLI_CSRF_TOKEN', '')).trim();
    this.requestTimeout = Number(localEnvValue(this.env, 'STARLI_TIMEOUT_SECONDS', '120'));
    this.debug = ['1', 'true', 'yes', 'on'].includes(String(localEnvValue(this.env, 'STARLI_DEBUG', '')).toLowerCase());
    this.autoCreateConversation = !['0', 'false', 'no', 'off'].includes(String(localEnvValue(this.env, 'STARLI_AUTO_CREATE_CONVERSATION', '1')).toLowerCase());
    this.createModel = normalizeOutlierModel(String(localEnvValue(this.env, 'STARLI_CREATE_MODEL', this.model)).trim());
    this.rateLimitMaxRetries = Math.max(1, Number(localEnvValue(this.env, 'STARLI_RATE_LIMIT_MAX_RETRIES', '4')));
    this.rateLimitBaseDelayMs = Math.max(250, Number(localEnvValue(this.env, 'STARLI_RATE_LIMIT_BASE_DELAY_MS', '5000')));
    this.rateLimitMaxDelayMs = Math.max(
      this.rateLimitBaseDelayMs,
      Number(localEnvValue(this.env, 'STARLI_RATE_LIMIT_MAX_DELAY_MS', '60000'))
    );
    let defaultApiBase = 'https://app.outlier.ai/internal/experts/assistant/conversations';
    const rawApiUrl = String(initialApiUrl || (allowGlobalConversation?localEnvValue(this.env, 'STARLI_API_URL', ''):'')).trim();
    if (rawApiUrl && /^https?:\/\//.test(rawApiUrl)) {
      try {
        const parsed = new URL(rawApiUrl);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const convIdx = parts.indexOf('conversations');
        if (convIdx >= 0) {
          defaultApiBase = `${parsed.protocol}//${parsed.host}/${parts.slice(0, convIdx + 1).join('/')}`;
        }
      } catch {
        // ignore
      }
    }
    this.conversationApiBase = localEnvValue(this.env, 'STARLI_CONVERSATION_API_BASE', defaultApiBase);
    try{const base=new URL(this.conversationApiBase);if(base.origin!=='https://app.outlier.ai'||base.username||base.password||base.search||base.hash||base.pathname!=='/internal/experts/assistant/conversations')throw new Error();}catch{throw new LLMConfigurationError('Endpointul Outlier trebuie să folosească originea HTTPS oficială.');}
    this.conversationId = this.normalizeConversationId(initialConversationId || (allowGlobalConversation?localEnvValue(this.env, 'STARLI_CONVERSATION_ID', ''):''));
    this.apiUrl = rawApiUrl ? this.normalizeApiUrl(rawApiUrl) : '';
    if (this.apiUrl && !this.conversationId) {
      this.conversationId = this.extractConversationId(this.apiUrl);
    } else if (this.conversationId && !this.apiUrl) {
      this.apiUrl = this.buildApiUrl(this.conversationId);
    }
  }

  debugLog(message: string): void {
    if (this.debug) {
      process.stdout.write(`[STARLI DEBUG] ${message}\n`);
    }
  }

  validate(): void {
    const report = this.doctor();
    if (!report.ok) {
      throw new LLMConfigurationError(report.summary);
    }
  }

  headers(): Record<string, string> {
    return {
      Cookie: this.cookie,
      'x-csrf-token': this.csrfToken,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      Origin: 'https://app.outlier.ai',
      Referer: 'https://app.outlier.ai/',
      'User-Agent': 'Mozilla/5.0'
    };
  }

  normalizeConversationId(value: string): string {
    const cleaned = String(value || '').trim();
    if (!cleaned) {
      return '';
    }
    if (cleaned.includes('://')) {
      return this.extractConversationId(cleaned);
    }
    if (cleaned.includes('/')) {
      return cleaned.replace(/\/+$/, '').split('/').pop() || '';
    }
    return cleaned;
  }

  extractConversationId(url: string): string {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/').filter(Boolean);
    const index = parts.indexOf('conversations');
    if (index >= 0 && index + 1 < parts.length) {
      return parts[index + 1];
    }
    return parts[parts.length - 1] || '';
  }

  buildApiUrl(conversationId: string): string {
    return `${this.conversationApiBase}/${conversationId}/turn-streaming`;
  }

  normalizeApiUrl(value: string): string {
    const cleaned = String(value || '').trim();
    if (!cleaned) {
      return '';
    }
    if (cleaned.includes('turn-streaming')) {
      return this.buildApiUrl(this.extractConversationId(cleaned));
    }
    return this.buildApiUrl(this.normalizeConversationId(cleaned));
  }

  persistRuntimeConversation(): void {
    if (this.onRotate) {
      this.onRotate(this.conversationId, this.apiUrl, this.parentIdx);
    }
    if (!this.persistRuntime) {
      return;
    }
    upsertEnvValues({
      STARLI_CONVERSATION_ID: this.conversationId,
      STARLI_API_URL: this.apiUrl
    }, this.envPath);
    this.env.STARLI_CONVERSATION_ID = this.conversationId;
    this.env.STARLI_API_URL = this.apiUrl;
    process.env.STARLI_CONVERSATION_ID = this.conversationId;
    process.env.STARLI_API_URL = this.apiUrl;
  }

  async createNewConversation(initialText: string, { signal }: { signal?: AbortSignal | null } = {}): Promise<string> {
    signal?.throwIfAborted();
    const payload = {
      prompt: { text: initialText, images: [] },
      model: this.createModel,
      challengeId: ''
    };
    const response = await fetch(this.conversationApiBase, {
      signal: signal || undefined,
      method: 'POST',
      headers: this.headers(),
      redirect: 'error',
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Conversation creation failed with status ${response.status}.`);
    }
    const data = await response.json() as any;
    if (!data.id) {
      throw new Error('Conversation creation returned no id.');
    }
    this.conversationId = String(data.id);
    this.apiUrl = this.buildApiUrl(this.conversationId);
    this.parentIdx = 0;
    this.persistRuntimeConversation();
    return this.conversationId;
  }

  setModel(modelId: string): { provider: string; model: string } {
    const normalized = normalizeOutlierModel(modelId);
    if (!normalized) {
      throw new Error('Model is required.');
    }
    this.model = normalized;
    this.createModel = normalized;
    if (this.persistRuntime) {
      upsertEnvValues({ STARLI_MODEL: normalized }, this.envPath);
    }
    this.env.STARLI_MODEL = normalized;
    process.env.STARLI_MODEL = normalized;
    return { provider: this.provider, model: this.model };
  }

  async rotateConversationFromPayload(payload: any, reason: string, signal?: AbortSignal | null): Promise<boolean> {
    signal?.throwIfAborted();
    if (!this.autoCreateConversation) {
      return false;
    }
    const brief = this.buildRotationBrief(payload, reason);
    this.debugLog(`rotating conversation because: ${reason}`);
    await this.createNewConversation(brief, { signal });
    payload.parentIdx = this.parentIdx;
    this.debugLog(`rotated conversation to ${this.conversationId}`);
    return true;
  }

  buildRotationBrief(payload: any, reason: string): string {
    const context = this.continuityContextBuilder ? this.continuityContextBuilder() : {};
    const promptText = String(payload?.prompt?.text || '');
    const summary = promptText.slice(0, 1200);
    return [
      'BRIEF DE CONTINUITATE STARLI AI (Conversația anterioară Outlier s-a umplut sau s-a încheiat; continuăm într-o conversație nouă):',
      `Motiv rotație: ${reason}`,
      context && Object.keys(context).length ? `Context conversație și proiect:\n${JSON.stringify(context, null, 2)}` : '',
      summary ? `Ultima cerere în lucru:\n${summary}` : '',
      'Continuă natural de unde ai rămas, în limba română, păstrând toate detaliile stabilite cu clientul.'
    ].filter(Boolean).join('\n\n');
  }

  buildPayload(userText: string, minimal = false): any {
    if (this.model === 'gemini-3-flash') {
      const systemMessage = "You are a helpful chat assistant. You are part of a product called the Model Playground, in which users can chat with various models from leading LLM providers in the Generative AI space. The Model Playground is a perk for contributors on Outlier, a platform that connects subject matter experts to help build the world's most advanced Generative AI.";
      const payload = {
        isMysteryModel: false,
        model: 'gemini-3-flash',
        modelId: this.modelId || '695eb241ebfe65cbcfb1c96c',
        prompt: {
          model: 'gemini-3-flash',
          turnType: 'Text',
          modelId: this.modelId || '695eb241ebfe65cbcfb1c96c',
          text: userText
        },
        systemMessage,
        turnMode: 'Normal',
        turnType: 'Text'
      };
      return payload;
    }
    const systemMessage = minimal ? '-' : this.systemPromptBuilder();
    const prompt: any = {
      model: this.model,
      turnType: 'Text',
      text: userText,
      images: [],
      enableThinking: this.enableThinking,
      systemMessage,
      modelWasSwitched: false,
      isMysteryModel: false,
      turnMode: 'Normal'
    };
    const payload: any = {
      prompt,
      model: this.model,
      turnMode: 'Normal',
      systemMessage,
      parentIdx: this.parentIdx,
      turnType: 'Text',
      isMysteryModel: false
    };
    if (this.modelId) {
      prompt.modelId = this.modelId;
      payload.modelId = this.modelId;
    }
    return payload;
  }

  doctor() {
    const findings: string[] = [];
    const warnings: string[] = [];
    const conversationId = this.conversationId;
    const apiUrl = this.apiUrl;

    if (!this.modelId) {
      warnings.push('Missing STARLI_MODEL_ID.');
    }
    if (!this.cookie) {
      findings.push('Missing STARLI_COOKIE.');
    }
    if (!this.csrfToken) {
      findings.push('Missing STARLI_CSRF_TOKEN.');
    }
    if (!conversationId && !apiUrl && !this.autoCreateConversation) {
      findings.push('Missing STARLI_CONVERSATION_ID or STARLI_API_URL.');
    }
    if (apiUrl && !/^https?:\/\//.test(apiUrl)) {
      findings.push('STARLI_API_URL is not a valid absolute URL.');
    }
    if (!apiUrl && conversationId) {
      warnings.push('STARLI_API_URL is not set; STARLI will derive it from STARLI_CONVERSATION_ID.');
    }

    return {
      ok: findings.length === 0,
      findings,
      warnings,
      values: {
        model: this.model,
        modelIdPresent: Boolean(this.modelId),
        enableThinking: this.enableThinking,
        cookiePresent: Boolean(this.cookie),
        csrfTokenPresent: Boolean(this.csrfToken),
        conversationIdPresent: Boolean(conversationId),
        apiUrlPresent: Boolean(apiUrl),
        apiUrl: apiUrl || '',
        conversationId: conversationId || ''
      },
      summary: findings.length
        ? `Outlier configuration is incomplete:\n- ${findings.join('\n- ')}`
        : warnings.length
          ? `Outlier configuration looks usable with warnings:\n- ${warnings.join('\n- ')}`
          : 'Outlier configuration looks complete.'
    };
  }

  async ask(userText: string, { minimal = false, onDelta = null, signal = null }: { minimal?: boolean; onDelta?: ((delta: string) => void) | null; signal?: AbortSignal | null } = {}): Promise<string> {
    this.validate();
    let promptText = String(userText || '');
    const maxAttempts = 2;

    if (!this.apiUrl && this.autoCreateConversation) {
      const initialBrief = this.buildRotationBrief({ prompt: { text: promptText } }, 'initial_session');
      await this.createNewConversation(initialBrief, { signal });
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const payload = this.buildPayload(promptText, minimal);
      try {
        return await this.streamRequest(payload, { onDelta, signal });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (attempt < maxAttempts && shouldRotateOutlierConversation(error)) {
          const rotated = await this.rotateConversationFromPayload(payload, 'conversation_full_or_terminated', signal);
          if (rotated) {
            promptText = this.buildContinuationPrompt(userText, error);
            continue;
          }
        }
        throw error;
      }
    }

    throw new Error('Outlier request failed.');
  }

  async askWithImages(): Promise<never> {
    throw new LLMConfigurationError('The Outlier provider does not support image input in STARLI yet.');
  }

  async ping() {
    this.validate();
    const payload = this.buildPayload('ping', true);
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: this.headers(),
      redirect: 'error',
        body: JSON.stringify(payload)
      });
      const body = response.body ? '' : await response.text().catch(() => '');
      return {
        ok: response.ok,
        status: response.status,
        bodyPreview: body.slice(0, 500)
      };
    } catch (error: any) {
      return {
        ok: false,
        status: 0,
        error: String(error?.message || error)
      };
    }
  }

  async streamRequest(payload: any, { onDelta = null, signal = null }: { onDelta?: ((delta: string) => void) | null; signal?: AbortSignal | null } = {}): Promise<string> {
    const maxRetries = Math.max(3, this.rateLimitMaxRetries);

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      throwIfAborted(signal);
      this.debugLog(`attempt=${attempt} url=${this.apiUrl} parentIdx=${this.parentIdx}`);
      let liveText = '';
      let lastDataLine = '';

      try {
        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: this.headers(),
      redirect: 'error',
          body: JSON.stringify(payload),
          signal: signal || undefined
        });

        this.debugLog(`status=${response.status}`);

        if (response.status === 500 && this.autoCreateConversation) {
          const rotated = await this.rotateConversationFromPayload(payload, 'http_500', signal);
          if (rotated) {
            payload.prompt.text = this.buildContinuationPrompt(payload.prompt.text, new Error('HTTP 500 conversation limit reached'));
            continue;
          }
        }

        if (response.status === 429) {
          const body = await response.text().catch(() => '');
          const retryAfterMs = this.resolveRetryAfterMs(response, attempt);
          if (attempt < maxRetries) {
            this.debugLog(`rate limited; sleeping ${retryAfterMs}ms before retry`);
            await delay(retryAfterMs, signal);
            continue;
          }
          throw new LLMRateLimitError(
            `Unexpected HTTP status 429. Body preview: ${body.slice(0, 1000)}`,
            { retryAfterMs }
          );
        }

        if (!response.ok || !response.body) {
          const body = await response.text().catch(() => '');
          throw new Error(`Unexpected HTTP status ${response.status}. Body preview: ${body.slice(0, 1000)}`);
        }

        const decoder = new TextDecoder();
        let buffer = '';
        const reader = response.body.getReader();

        while (true) {
          throwIfAborted(signal);
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data:')) {
              continue;
            }
            const data = line.slice(5).trim();
            lastDataLine = data.slice(0, 500);
            if (!data) {
              continue;
            }
            if (data === '[DONE]') {
              this.parentIdx += 1;
              if (this.onRotate) {
                this.onRotate(this.conversationId, this.apiUrl, this.parentIdx);
              }
              return liveText;
            }

            let event: any;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }
            if (event?.error || event?.type === 'error') {
              const errMsg = typeof event.error === 'string' ? event.error : event.error?.message || event.message || JSON.stringify(event);
              throw new Error(`Outlier stream error: ${errMsg}`);
            }
            const delta = extractStreamDeltaText(event, this.model);
            if (delta) {
              liveText += delta;
              if (onDelta) {
                onDelta(delta);
              }
              continue;
            }

            const completedText = extractCompletedStreamText(event, this.model);
            if (completedText) {
              liveText = completedText;
            }
          }
        }

        if (String(liveText || '').trim()) {
          this.parentIdx += 1;
          if (this.onRotate) {
            this.onRotate(this.conversationId, this.apiUrl, this.parentIdx);
          }
          return liveText;
        }

        if (!lastDataLine && attempt < maxRetries) {
          const rotated = await this.rotateConversationFromPayload(payload, 'stream_ended_without_events', signal);
          if (rotated) {
            payload.prompt.text = this.buildContinuationPrompt(payload.prompt.text, new Error('stream_ended_without_events'));
            continue;
          }
        }

        throw new Error(`Stream ended without text. Last event preview: ${lastDataLine || '[none]'}`);
      } catch (error: any) {
        this.debugLog(`stream failure: ${String(error?.message || error)}`);
        if (isAbortError(error)) {
          throw error;
        }
        if (error instanceof LLMRateLimitError) {
          throw error;
        }
        if (attempt < maxRetries && shouldRotateOutlierConversation(error)) {
          payload.prompt.text = this.buildContinuationPrompt(payload.prompt.text, error);
          const rotated = await this.rotateConversationFromPayload(payload, 'terminated', signal);
          if (rotated) {
            continue;
          }
        }
        if (attempt < maxRetries && String(error?.message || '').includes('[none]')) {
          payload.prompt.text = this.buildContinuationPrompt(payload.prompt.text, error);
          const rotated = await this.rotateConversationFromPayload(payload, 'stream_failed_without_events', signal);
          if (rotated) {
            continue;
          }
        }
        if (attempt === maxRetries) {
          throw error;
        }
      }
    }

    throw new Error('LLM request failed without a response.');
  }

  buildContinuationPrompt(userText: string, error: unknown): string {
    const context = this.continuityContextBuilder ? this.continuityContextBuilder() : {};
    const errMsg = error instanceof Error ? error.message : String(error);
    return [
      'Conversația Outlier anterioară a ajuns la limită sau s-a încheiat neașteptat. Continuă fără întrerupere în această conversație nouă.',
      `Motiv rotație: ${errMsg}`,
      '',
      'Brief de continuitate (Context transmis mai departe):',
      JSON.stringify(context, null, 2),
      '',
      'Reia exact munca în curs pentru client, respectând toate instrucțiunile de sistem Starli AI.',
      '',
      'Cererea curentă:',
      String(userText || '')
    ].join('\n');
  }

  resolveRetryAfterMs(response: Response, attempt: number): number {
    const retryAfterHeader = response?.headers?.get?.('retry-after');
    const parsedRetryAfterMs = parseRetryAfterHeader(retryAfterHeader);
    if (parsedRetryAfterMs > 0) {
      return Math.min(parsedRetryAfterMs, this.rateLimitMaxDelayMs);
    }

    const backoff = this.rateLimitBaseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
    return Math.min(backoff, this.rateLimitMaxDelayMs);
  }
}

function extractStreamDeltaText(event: any, model = ''): string {
  if (!event || typeof event !== 'object') {
    return '';
  }

  if (isClaudeOpusModel(model)) {
    const claudeDelta = extractClaudeOpusDeltaText(event);
    if (claudeDelta) {
      return claudeDelta;
    }
  }

  if (event.type === 'response.output_text.delta') {
    return String(event.delta || '');
  }

  if (event.object === 'chat.completion.chunk' && Array.isArray(event.choices)) {
    return event.choices
      .map((choice: any) => String(choice?.delta?.content || ''))
      .join('');
  }

  return '';
}

function extractCompletedStreamText(event: any, model = ''): string {
  if (!event || typeof event !== 'object') {
    return '';
  }

  if (isClaudeOpusModel(model)) {
    const claudeCompleted = extractClaudeOpusCompletedText(event);
    if (claudeCompleted) {
      return claudeCompleted;
    }
  }

  if (event.type === 'response.output_text.done' && event.text) {
    return String(event.text);
  }

  if (event.type === 'response.output_item.done') {
    const content = event?.item?.content?.[0]?.text;
    if (content && String(content).trim()) {
      return String(content);
    }
  }

  if (event.object === 'chat.completion' && Array.isArray(event.choices)) {
    return event.choices
      .map((choice: any) => String(choice?.message?.content || ''))
      .join('');
  }

  return '';
}

function isClaudeOpusModel(model: string): boolean {
  const value = String(model || '').toLowerCase();
  return value.includes('claude-opus') || value.includes('opus-4-6') || value.includes('opus-4.6');
}

function extractClaudeOpusDeltaText(event: any): string {
  if (event.object !== 'chat.completion.chunk' || !Array.isArray(event.choices)) {
    return '';
  }

  return event.choices
    .map((choice: any) => {
      const delta = choice?.delta;
      if (!delta || typeof delta !== 'object') {
        return '';
      }
      return String(delta.content || '');
    })
    .join('');
}

function extractClaudeOpusCompletedText(event: any): string {
  if (event.object !== 'chat.completion' || !Array.isArray(event.choices)) {
    return '';
  }

  return event.choices
    .map((choice: any) => String(choice?.message?.content || ''))
    .join('');
}

export function shouldRotateOutlierConversation(error: unknown): boolean {
  const message = String(error && (error as any).message ? (error as any).message : error).toLowerCase();
  return [
    'terminated',
    'conversation is full',
    'conversation full',
    'max_tokens',
    'context_length_exceeded',
    'maximum context length',
    'too many messages',
    'turn limit',
    'invalid_request_error',
    'stream ended without text',
    'stream_failed_without_events',
    'stream_ended_without_events',
    'unexpected http status 500',
    'unexpected http status 400'
  ].some((needle) => message.includes(needle));
}

export function normalizeOutlierModel(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  return normalized
    .replace(/claude-opus-4\.6/gi, 'claude-opus-4-6')
    .replace(/claude-sonnet-4\.5/gi, 'claude-sonnet-4-5');
}

function parseRetryAfterHeader(value: string | null | undefined): number {
  const raw = String(value || '').trim();
  if (!raw) {
    return 0;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return 0;
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, Number(ms || 0)));
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason || 'Request aborted'));
}

function isAbortError(error: any): boolean {
  const message = String(error?.message || error || '').toLowerCase();
  return error?.name === 'AbortError' || message.includes('aborted');
}
