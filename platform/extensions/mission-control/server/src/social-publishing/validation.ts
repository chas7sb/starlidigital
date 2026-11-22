import { SOCIAL_PLATFORMS, type SocialPlatform, type SocialPostPlan, type SocialPostVariant } from './types.js';

const SECRET_KEY = /(authorization|cookie|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth|jwt|credential)/i;
export const MAX_PLATFORMS = 12;
export const MAX_CAPTION = 5000;
export const MAX_HASHTAGS = 30;
export const MAX_ANALYTICS_LIMIT = 100;

const OPTION_ALLOWLIST: Partial<Record<SocialPlatform, Set<string>>> = {
  TIKTOK: new Set(['privacy','disableComments','disableDuet','disableStitch']),
  INSTAGRAM: new Set(['locationRef','coverMediaRef','shareToFeed']),
  YOUTUBE: new Set(['privacy','categoryId','madeForKids','playlistRef']),
  FACEBOOK: new Set(['pageRef','link']),
  LINKEDIN: new Set(['pageRef','visibility']),
  X: new Set(['replySettings']),
  THREADS: new Set(['replyControl']),
  PINTEREST: new Set(['boardRef','link','altText']),
  GOOGLE_BUSINESS: new Set(['locationRef','callToAction']),
};

export function assertOpaqueRef(value: string, label='reference') {
  if (typeof value !== 'string' || value.length < 1 || value.length > 300 || /\s/.test(value) || /^(https?:|Bearer\s)/i.test(value) || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label}`);
}
export function assertTimezone(value?: string) {
  if (!value) throw new Error('Timezone required');
  try { new Intl.DateTimeFormat('en-US',{ timeZone:value }).format(new Date()); } catch { throw new Error('Invalid timezone'); }
}
export function assertSchedule(plan: Pick<SocialPostPlan,'schedule'>, now=Date.now()) {
  const s=plan.schedule;
  if (s.mode === 'SCHEDULE') {
    assertTimezone(s.timezone);
    const time=Date.parse(String(s.publishAt||''));
    if (!Number.isFinite(time) || time <= now) throw new Error('Scheduled publishAt must be in the future');
  } else if (s.publishAt || s.timezone) throw new Error('publishAt/timezone only valid for SCHEDULE mode');
}
export function assertVariant(v: SocialPostVariant) {
  if (!SOCIAL_PLATFORMS.includes(v.platform)) throw new Error('Unsupported platform');
  if ((v.caption?.length||0) > MAX_CAPTION) throw new Error('Caption too long');
  if ((v.hashtags?.length||0) > MAX_HASHTAGS) throw new Error('Too many hashtags');
  for (const tag of v.hashtags||[]) if (!/^#?[\p{L}\p{N}_-]{1,100}$/u.test(tag)) throw new Error('Invalid hashtag');
  if ((v.mediaRefs?.length||0) > 20) throw new Error('Too many media items');
  const allowed=OPTION_ALLOWLIST[v.platform]||new Set<string>();
  for (const key of Object.keys(v.options||{})) if (!allowed.has(key)) throw new Error(`Unsupported ${v.platform} option: ${key}`);
}
export function assertPlan(plan: SocialPostPlan) {
  if (!plan.tenantId || plan.tenantId.length > 200) throw new Error('Invalid tenant');
  if (!plan.variants.length || plan.variants.length > MAX_PLATFORMS) throw new Error('Platform count out of bounds');
  const platforms=new Set<SocialPlatform>();
  for (const v of plan.variants) { assertVariant(v); if (platforms.has(v.platform)) throw new Error('Duplicate platform variant'); platforms.add(v.platform); }
  assertSchedule(plan);
  if (plan.sourceArtifactRefs.length > 50) throw new Error('Too many source artifacts');
}
export function boundedLimit(value: number|undefined, max=MAX_ANALYTICS_LIMIT) { const n=Math.floor(Number(value||25)); if (!Number.isFinite(n)||n<1) throw new Error('Invalid limit'); return Math.min(n,max); }
export function sanitizeProviderData<T>(value:T, depth=0):T {
  if (depth>5) return '[omitted]' as T;
  if (Array.isArray(value)) return value.slice(0,50).map(v=>sanitizeProviderData(v,depth+1)) as T;
  if (value && typeof value==='object') { const out:Record<string,unknown>={}; for(const [k,v] of Object.entries(value as Record<string,unknown>).slice(0,80)){ if(SECRET_KEY.test(k)) continue; out[k]=sanitizeProviderData(v,depth+1); } return out as T; }
  if (typeof value==='string') return value.slice(0,1000) as T;
  return value;
}
export function sanitizeSocialEventPayload(payload: Record<string,unknown>) {
  const banned=/(message|body|content|text|caption|comment|dm|review|authorization|cookie|secret|token|credential)/i;
  const out:Record<string,unknown>={};
  for(const [k,v] of Object.entries(payload).slice(0,40)) if(!banned.test(k)) out[k]=sanitizeProviderData(v);
  return out;
}
