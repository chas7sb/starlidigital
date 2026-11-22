/** Customer-only Facebook Pages MCP contract. No MCP endpoint, provider adapter or admin fallback. */
import { z } from 'zod';

const opaque = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const requestKey = z.string().min(12).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(`${v}T`);
}, 'Invalid calendar date');
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const facebookPermalinkUrl = z.string().max(512).url().refine(value => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      (parsed.hostname === 'www.facebook.com' || parsed.hostname === 'facebook.com') &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname.length > 1;
  } catch {
    return false;
  }
}, 'Invalid Facebook permalink URL');

const postBase = z.object({
  pageConnectionId: opaque,
  caption: z.string().min(1).max(5000),
  mediaRefs: z.array(opaque).max(10).default([]),
  idempotencyKey: requestKey,
}).strict();
const post = postBase.refine(v => v.caption.trim().length > 0, 'Post text is required');

/** Human-facing descriptions deliberately distinguish accepted, scheduled and published. */
export const customerFacebookToolContracts = {
  facebook_pages_publish_now: {
    description: 'Publish this explicit customer-requested post now to one Facebook Page you administer. Returns a verified state; an accepted request is not proof of publication.',
    input: post,
    permission: 'facebook.pages.publish',
  },
  facebook_pages_schedule: {
    description: 'Schedule an explicit customer-requested Facebook Page post on a specified local calendar date and time in Europe/Bucharest. Requires a confirmed schedule receipt.',
    input: postBase.extend({ localDate: date, localTime: time, timezone: z.literal('Europe/Bucharest') }).strict().refine(v => v.caption.trim().length > 0, 'Post text is required'),
    permission: 'facebook.pages.publish',
  },
  facebook_pages_list: {
    description: 'List this customer tenant’s Facebook Page publication and scheduling jobs. This does not access other tenants.',
    input: z.object({ limit: z.number().int().min(1).max(50).default(20), cursor: opaque.optional() }).strict(),
    permission: 'facebook.pages.read',
  },
  facebook_pages_cancel: {
    description: 'Cancel one scheduled job owned by the authenticated customer; cancellation is only confirmed if the backend reports CANCELLED.',
    input: z.object({ jobId: opaque, idempotencyKey: requestKey }).strict(),
    permission: 'facebook.pages.publish',
  },
} as const;

export type FacebookMcpToolName = keyof typeof customerFacebookToolContracts;
export type FacebookMcpPrincipal = Readonly<{
  subjectId: string;
  tenantId: string;
  role: 'customer' | 'admin' | 'operator';
  permissions: readonly string[];
}>;
export type FacebookMcpContext = Readonly<{ principal: FacebookMcpPrincipal }>;
export type FacebookMcpJob = Readonly<{
  id: string;
  tenantId: string;
  pageConnectionId: string;
  state: 'QUEUED'|'SCHEDULED'|'PUBLISHING'|'PUBLISHED'|'FAILED'|'NEEDS_REAUTH'|'NEEDS_REVIEW'|'CANCELLED'|'UNCERTAIN';
  providerPostRef?: string;
  providerPostUrl?: string;
  providerJobRef?: string;
  scheduledAt?: string;
  publishedAt?: string;
  errorCode?: string;
}>;

/** Service implementations must authenticate selected Page/media ownership and store idempotency durably. */
export interface CustomerFacebookMcpBackend {
  publishNow(input: { tenantId: string; subjectId: string; pageConnectionId: string; caption: string; mediaRefs: string[]; idempotencyKey: string; explicitCustomerCommand: true }): Promise<FacebookMcpJob>;
  schedule(input: { tenantId: string; subjectId: string; pageConnectionId: string; caption: string; mediaRefs: string[]; idempotencyKey: string; localDate: string; localTime: string; timezone: 'Europe/Bucharest'; explicitCustomerCommand: true }): Promise<FacebookMcpJob>;
  list(input: { tenantId: string; subjectId: string; limit: number; cursor?: string }): Promise<{ jobs: FacebookMcpJob[]; nextCursor?: string }>;
  cancel(input: { tenantId: string; subjectId: string; jobId: string; idempotencyKey: string; explicitCustomerCommand: true }): Promise<FacebookMcpJob>;
}

const jobSchema = z.object({
  id: opaque, tenantId: opaque, pageConnectionId: opaque,
  state: z.enum(['QUEUED','SCHEDULED','PUBLISHING','PUBLISHED','FAILED','NEEDS_REAUTH','NEEDS_REVIEW','CANCELLED','UNCERTAIN']),
  providerPostRef: opaque.optional(),
  providerPostUrl: facebookPermalinkUrl.optional(),
  providerJobRef: opaque.optional(),
  scheduledAt: z.string().datetime({offset:true}).optional(),
  publishedAt: z.string().datetime({offset:true}).optional(),
  errorCode: opaque.optional(),
}).strict();

/** Require durable schedule execution time to match the exact customer wall clock.
 * Queued is internal persistence, never a fabricated Meta provider reservation. */
function scheduleMatchesCustomerClock(utc: string | undefined, localDate: string, localTime: string): boolean {
  if (!utc) return false;
  const instant = new Date(utc);
  if (!Number.isFinite(instant.getTime())) return false;
  const fields = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant);
  const values = Object.fromEntries(fields.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}` === localDate && `${values.hour}:${values.minute}` === localTime;
}

export function createCustomerFacebookMcpHandlers(backend: CustomerFacebookMcpBackend) {
  const authorize = (ctx: FacebookMcpContext, permission: string) => {
    const p = ctx?.principal;
    if (!p || p.role !== 'customer' || !opaque.safeParse(p.subjectId).success || !opaque.safeParse(p.tenantId).success || !p.permissions?.includes(permission)) {
      throw new Error('Customer Facebook MCP access denied');
    }
    return { tenantId: p.tenantId, subjectId: p.subjectId };
  };
  const verify = (job: unknown, tenantId: string) => {
    const checked = jobSchema.parse(job);
    if (checked.tenantId !== tenantId) throw new Error('Cross-tenant Facebook job response denied');
    if (checked.state === 'PUBLISHED' && !checked.providerPostRef) throw new Error('Published post lacks provider receipt');
    if (checked.state !== 'PUBLISHED' && checked.providerPostUrl) throw new Error('Unpublished post must not expose provider permalink');
    if (checked.state === 'SCHEDULED' && (!checked.providerJobRef || !checked.scheduledAt)) throw new Error('Scheduled post lacks provider receipt and execution time');
    if (checked.state === 'QUEUED' && checked.providerJobRef) throw new Error('Queued job must not fabricate provider receipt');
    return checked;
  };
  return {
    async facebook_pages_publish_now(ctx: FacebookMcpContext, raw: unknown) {
      const who = authorize(ctx, 'facebook.pages.publish');
      const input = customerFacebookToolContracts.facebook_pages_publish_now.input.parse(raw);
      const job = verify(await backend.publishNow({...who, ...input, explicitCustomerCommand: true}), who.tenantId);
      if (job.pageConnectionId !== input.pageConnectionId) throw new Error('Facebook page response mismatch');
      if (job.state === 'PUBLISHED' && !job.providerPostRef) throw new Error('Published post lacks provider receipt');
      return {
        job,
        published: job.state === 'PUBLISHED',
        receiptStatus: job.state,
        ...(job.state === 'PUBLISHED' && job.providerPostUrl ? { providerPostUrl: job.providerPostUrl } : {}),
      };
    },
    async facebook_pages_schedule(ctx: FacebookMcpContext, raw: unknown) {
      const who = authorize(ctx, 'facebook.pages.publish');
      const input = customerFacebookToolContracts.facebook_pages_schedule.input.parse(raw);
      const job = verify(await backend.schedule({...who, ...input, explicitCustomerCommand: true}), who.tenantId);
      if (job.pageConnectionId !== input.pageConnectionId) throw new Error('Facebook page response mismatch');
      if ((job.state === 'SCHEDULED' || job.state === 'QUEUED') &&
          !scheduleMatchesCustomerClock(job.scheduledAt, input.localDate, input.localTime))
        throw new Error('Facebook schedule does not match requested local time');
      if (job.state === 'SCHEDULED' && !job.providerJobRef)
        throw new Error('Scheduled post lacks provider job receipt');
      // QUEUED is only an accepted durable internal job, not a provider reservation.
      if (job.state === 'QUEUED' && checkedHasProviderRef(job))
        throw new Error('Queued job must not fabricate provider receipt');
      return {job, queued: job.state === 'QUEUED', scheduled: job.state === 'SCHEDULED', receiptStatus: job.state};
    },
    async facebook_pages_list(ctx: FacebookMcpContext, raw: unknown) {
      const who = authorize(ctx, 'facebook.pages.read');
      const input = customerFacebookToolContracts.facebook_pages_list.input.parse(raw);
      const result = await backend.list({...who, ...input});
      if (!Array.isArray(result.jobs) || result.jobs.length > input.limit) throw new Error('Invalid Facebook jobs response');
      return {jobs: result.jobs.map(job => verify(job, who.tenantId)), nextCursor: result.nextCursor ? opaque.parse(result.nextCursor) : undefined};
    },
    async facebook_pages_cancel(ctx: FacebookMcpContext, raw: unknown) {
      const who = authorize(ctx, 'facebook.pages.publish');
      const input = customerFacebookToolContracts.facebook_pages_cancel.input.parse(raw);
      const job = verify(await backend.cancel({...who, ...input, explicitCustomerCommand: true}), who.tenantId);
      if (job.id !== input.jobId) throw new Error('Facebook cancellation job mismatch');
      return {job, cancelled: job.state === 'CANCELLED', receiptStatus: job.state};
    },
  };
}

function checkedHasProviderRef(job: FacebookMcpJob): boolean {
  return Boolean(job.providerJobRef || job.providerPostRef || job.providerPostUrl);
}
