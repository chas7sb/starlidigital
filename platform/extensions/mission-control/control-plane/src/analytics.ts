/** Plausible CE v2.1.5 Stats v1 adapter.
 * Installed image revision cb57616ee08778e45b94b547b74a3bbd67ce464d.
 * Contract verified against its router.ex, external_stats_controller.ex,
 * legacy_dimensions.ex and external_stats_controller/{aggregate,breakdown,timeseries}_test.exs.
 * https://github.com/plausible/analytics/tree/cb57616ee08778e45b94b547b74a3bbd67ce464d
 */
export type AnalyticsQuery = { from?: string; to?: string; limit?: number };
export type AnalyticsRow = { dimension?: string; visitors: number; pageviews?: number; events?: number; bounce_rate?: number; visit_duration?: number; conversion_rate?: number };
export type AnalyticsResult = {
  status: 'OK' | 'CONFIGURATION_NEEDED' | 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_AUTH_FAILED' | 'INVALID_RESPONSE';
  siteId: 'starlidigital.ro'; source: 'PLAUSIBLE_CE'; apiVersion: 'v1';
  from: string; to: string; rows?: AnalyticsRow[]; message?: string; truncated?: boolean;
};
const TRUSTED = new Set(['http://127.0.0.1:8000','https://plausible.135.125.159.42.sslip.io']);
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const metrics = ['visitors','pageviews','events','bounce_rate','visit_duration','conversion_rate'] as const;
type Metric = typeof metrics[number];
const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response object');
  return value as Record<string,unknown>;
};
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Analytics dates must be valid YYYY-MM-DD dates');
  return value;
}
function row(value: unknown, requested: readonly Metric[], dimension?: string): AnalyticsRow {
  const object = asObject(value); const result: Record<string,string|number> = {};
  if (dimension) {
    const label = object[dimension];
    if (typeof label !== 'string' || label.length > 1024 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error('Invalid analytics dimension');
    // Do not echo query strings/fragments that could contain visitor identifiers.
    result.dimension = dimension === 'page' || dimension === 'referrer' ? label.split(/[?#]/,1)[0] : label;
  }
  for (const metric of requested) {
    const number = object[metric];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) throw new Error('Invalid analytics metric');
    if (['visitors','pageviews','events'].includes(metric) && !Number.isSafeInteger(number)) throw new Error('Invalid analytics count');
    if (['bounce_rate','conversion_rate'].includes(metric) && number > 100) throw new Error('Invalid analytics rate');
    result[metric] = number;
  }
  return result as AnalyticsRow;
}

export class PlausibleAnalytics {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  constructor(options: {apiKey?: string; baseUrl?: string; fetchImpl?: typeof fetch; now?: () => Date} = {}) {
    const raw = options.baseUrl ?? process.env.PLAUSIBLE_BASE_URL ?? 'http://127.0.0.1:8000';
    const url = new URL(raw);
    if (!TRUSTED.has(url.origin) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('Plausible URL must be a fixed trusted CE origin');
    this.baseUrl = url.origin;
    this.apiKey = (options.apiKey ?? process.env.PLAUSIBLE_API_KEY ?? '').trim();
    this.fetcher = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }
  overview(query: AnalyticsQuery = {}) { return this.query('aggregate',query,['visitors','pageviews','bounce_rate','visit_duration']); }
  timeseries(query: AnalyticsQuery = {}) { return this.query('timeseries',query,['visitors','pageviews'],undefined,'date'); }
  pages(query: AnalyticsQuery = {}) { return this.query('breakdown',query,['visitors','pageviews'],'event:page','page'); }
  referrers(query: AnalyticsQuery = {}) { return this.query('breakdown',query,['visitors','pageviews'],'visit:referrer','referrer'); }
  sources(query: AnalyticsQuery = {}) { return this.query('breakdown',query,['visitors','pageviews'],'visit:source','source'); }
  devices(query: AnalyticsQuery = {}) { return this.query('breakdown',query,['visitors','pageviews'],'visit:device','device'); }
  conversions(query: AnalyticsQuery = {}) { return this.query('breakdown',query,['visitors','events','conversion_rate'],'event:goal','goal'); }
  private async query(endpoint: 'aggregate'|'timeseries'|'breakdown', query: AnalyticsQuery, requested: readonly Metric[], property?: string, dimension?: string): Promise<AnalyticsResult> {
    // Reject extra query fields so no host, site, credential or arbitrary API filter can leak through.
    if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !['from','to','limit'].includes(key))) throw new Error('Unsupported analytics query field');
    const today = this.now().toISOString().slice(0,10);
    const to = date(query.to ?? today);
    const from = date(query.from ?? new Date(Date.parse(to)-29*86400000).toISOString().slice(0,10));
    const days = (Date.parse(to)-Date.parse(from))/86400000 + 1;
    if (days < 1 || days > 366) throw new Error('Analytics range must contain 1 to 366 days');
    const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Analytics limit must be 1 to 100');
    const base = {siteId:'starlidigital.ro',source:'PLAUSIBLE_CE',apiVersion:'v1',from,to} as const;
    if (!this.apiKey) return {...base,status:'CONFIGURATION_NEEDED',message:'Configure PLAUSIBLE_API_KEY with a Stats API key authorized for starlidigital.ro.'};
    if (this.apiKey.length > 4096 || /[\r\n]/.test(this.apiKey)) return {...base,status:'CONFIGURATION_NEEDED',message:'Plausible Stats API key configuration is invalid.'};
    const url = new URL('/api/v1/stats/'+endpoint,this.baseUrl);
    url.searchParams.set('site_id','starlidigital.ro'); url.searchParams.set('period','custom'); url.searchParams.set('date',from+','+to); url.searchParams.set('metrics',requested.join(','));
    if (property) { url.searchParams.set('property',property); url.searchParams.set('limit',String(limit)); url.searchParams.set('page','1'); }
    if (endpoint === 'timeseries') url.searchParams.set('interval',days > 100 ? 'month' : 'day');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(),TIMEOUT_MS);
    let response: Response | undefined;
    try {
      response = await this.fetcher(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+this.apiKey,Accept:'application/json'}});
      if (response.status === 401 || response.status === 403) return {...base,status:'UPSTREAM_AUTH_FAILED',message:'Plausible rejected the configured Stats API credentials or site access.'};
      if (!response.ok) return {...base,status:'UPSTREAM_UNAVAILABLE',message:'Plausible Stats API is unavailable.'};
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_BYTES) return {...base,status:'INVALID_RESPONSE',message:'Plausible response exceeds the size limit.'};
      if (!response.body || !(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return {...base,status:'INVALID_RESPONSE',message:'Plausible returned an unsupported response.'};
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BYTES) throw new Error('Response size exceeded'); chunks.push(part.value); }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const data = asObject(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      let rows: AnalyticsRow[];
      if (endpoint === 'aggregate') {
        const values = asObject(data.results); const flattened: Record<string,unknown> = {};
        for (const key of requested) flattened[key] = asObject(values[key]).value;
        rows = [row(flattened,requested)];
      } else {
        if (!Array.isArray(data.results) || data.results.length > 366) throw new Error('Invalid analytics rows');
        rows = data.results.slice(0,limit).map(value => row(value,requested,dimension));
      }
      return {...base,status:'OK',rows,truncated:Array.isArray(data.results) && data.results.length > limit};
    } catch {
      return {...base,status:controller.signal.aborted ? 'UPSTREAM_UNAVAILABLE' : response?.ok ? 'INVALID_RESPONSE' : 'UPSTREAM_UNAVAILABLE',message:'Plausible query failed; no analytics values are available.'};
    } finally { clearTimeout(timeout); await response?.body?.cancel().catch(() => {}); }
  }
}
