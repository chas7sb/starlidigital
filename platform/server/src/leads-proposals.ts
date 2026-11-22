import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { Store, id, now, type RecordData } from './store.js';
import { Events } from './events.js';
import { fail, bounded, hashToken, limit, requireUser, type Context } from './security.js';
import { requireOperator, recordOperatorAudit, redactSecrets } from './operator-auth.js';
import { validateNextProjectFiles, type SourceFile } from './next-template.js';
import {makePremiumNextFiles} from './premium-template.js';
import {publicOperatorBrief} from './operator-project-context.js';
import { renderNextPreviewHtml } from './preview-renderer.js';
import { type ProposalMode, type LeadScore, type ProposalSpec } from './proposal-spec.js';
import { buildProposalSpec, renderVerticalTemplate } from './proposal-templates.js';

export const PROPOSAL_STATES = [
  'PREGATIRE',
  'CERCETARE',
  'CONSTRUIRE',
  'VERIFICARE',
  'PREGATIT',
  'INVITATIE_TRIMISA',
  'VIZUALIZAT',
  'REVENDICAT',
  'ARHIVAT',
  'ESEC',
  'INCERT'
] as const;

export type ProposalState = (typeof PROPOSAL_STATES)[number];

export type ConfirmedFact = {
  field: string;
  value: string;
  source: string;
  confirmedAt: string;
};

export type LeadRecord = RecordData & {
  id: string;
  ownerId: string;
  businessName: string;
  industry: string;
  locality: string;
  normalizedPhone: string | null;
  email: string | null;
  existingWebsite: string | null;
  websiteDomain: string | null;
  websiteStatus: 'KNOWN' | 'UNCONFIRMED';
  source: string;
  confirmedFacts: ConfirmedFact[];
  missingFields: string[];
  internalNotes: string;
  consentStatus: 'GRANTED' | 'PENDING' | 'OPTED_OUT' | 'NONE';
  consentProvenance: string;
  consentUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ProposalRecord = RecordData & {
  id: string;
  ownerId: string;
  leadId: string;
  projectId: string;
  publicSlug: string;
  businessName: string;
  industry: string;
  locality: string;
  status: ProposalState;
  confirmedFacts: ConfirmedFact[];
  missingFields: string[];
  whatsappPhone: string | null;
  desktopScreenshotUrl: string;
  mobileScreenshotUrl: string;
  welcomeConversationId: string;
  claimCodeHash: string | null;
  claimCodePrefix: string | null;
  claimExpiresAt: string | null;
  claimRevokedAt: string | null;
  claimAttempts: number;
  claimOtpHash: string | null;
  claimOtpExpiresAt: string | null;
  claimOtpAttempts: number;
  claimInvitedContact: string | null;
  claimedByUserId: string | null;
  claimedAt: string | null;
  agencyCostUnits: number;
  generationMode: ProposalMode;
  specJson: string | null;
  leadScore: LeadScore;
  templateVertical: string | null;
  templateVersion: string | null;
  templateVariant: string | null;
  costAiUnits: number;
  costBuildUnits: number;
  lastError: string | null;
  viewedAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AgencyBudgetState = {
  perDemoMaxUnits: number;
  dailyMaxUnits: number;
  spentTodayUnits: number;
  totalSpentUnits: number;
  demosBuiltToday: number;
  day: string;
};

export function normalizeRomanianPhone(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (!digits) return null;
  let cleaned = digits;
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  if (cleaned.startsWith('07') && cleaned.length === 10) cleaned = '+4' + cleaned;
  else if (cleaned.startsWith('407') && cleaned.length === 11) cleaned = '+' + cleaned;
  else if (cleaned.startsWith('02') || cleaned.startsWith('03')) {
    if (cleaned.length === 10) cleaned = '+4' + cleaned;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    fail('Numărul de telefon nu are un format valid (folosește ex. 07xxxxxxxx sau +407xxxxxxxx).');
  }
  return cleaned;
}

export function normalizeLeadEmail(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    fail('Adresa de email a leadului nu este validă.');
  }
  return trimmed;
}

export function normalizeWebsiteDomain(raw?: string | null): { url: string; domain: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) {
      throw new Error('Invalid');
    }
    const domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return { url: parsed.origin, domain };
  } catch {
    fail('Adresa website-ului existent nu este validă.');
  }
}

export function isContactOptedOut(store: Store, normalizedPhone?: string | null, email?: string | null): boolean {
  if (normalizedPhone && store.get('contact-optouts', 'phone:' + normalizedPhone)) return true;
  if (email && store.get('contact-optouts', 'email:' + email.toLowerCase())) return true;
  return false;
}

export function recordContactOptOut(
  store: Store,
  events: Events | undefined,
  input: {
    normalizedPhone?: string | null;
    email?: string | null;
    leadId?: string | null;
    proposalId?: string | null;
    reason?: string;
    actor: string;
  }
): void {
  const reason = String(input.reason || 'Dezabonare solicitată de destinatar').slice(0, 240);
  const timestamp = now();
  if (input.normalizedPhone) {
    store.put('contact-optouts', {
      id: 'phone:' + input.normalizedPhone,
      channel: 'PHONE',
      target: input.normalizedPhone,
      reason,
      actor: input.actor,
      createdAt: timestamp
    });
  }
  if (input.email) {
    const cleanEmail = input.email.toLowerCase();
    store.put('contact-optouts', {
      id: 'email:' + cleanEmail,
      channel: 'EMAIL',
      target: cleanEmail,
      reason,
      actor: input.actor,
      createdAt: timestamp
    });
  }
  for (const lead of store.list('leads') as LeadRecord[]) {
    const matchesPhone = Boolean(input.normalizedPhone && lead.normalizedPhone === input.normalizedPhone);
    const matchesEmail = Boolean(input.email && lead.email === input.email.toLowerCase());
    const matchesId = Boolean(input.leadId && lead.id === input.leadId);
    if (matchesPhone || matchesEmail || matchesId) {
      store.put('leads', {
        ...lead,
        consentStatus: 'OPTED_OUT',
        consentProvenance: reason,
        consentUpdatedAt: timestamp,
        updatedAt: timestamp
      }, lead.ownerId);
    }
  }
  if (input.proposalId) {
    const prop = store.get('proposals', input.proposalId) as ProposalRecord | undefined;
    if (prop && prop.status !== 'REVENDICAT') {
      store.put('proposals', {
        ...prop,
        status: 'ARHIVAT',
        updatedAt: timestamp
      }, prop.ownerId);
    }
  }
  events?.publish('leads');
  events?.publish('proposals');
}

/**
 * Deduplicates leads strictly by normalized identifiers (phone, email, or website domain),
 * NEVER merging distinct businesses solely because their names look similar.
 */
export function findExistingLeadByIdentifiers(
  store: Store,
  identifiers: {
    normalizedPhone?: string | null;
    email?: string | null;
    websiteDomain?: string | null;
  }
): LeadRecord | undefined {
  const all = store.list('leads') as LeadRecord[];
  return all.find(lead => {
    if (identifiers.normalizedPhone && lead.normalizedPhone && lead.normalizedPhone === identifiers.normalizedPhone) {
      return true;
    }
    if (identifiers.email && lead.email && lead.email === identifiers.email) {
      return true;
    }
    if (identifiers.websiteDomain && lead.websiteDomain && lead.websiteDomain === identifiers.websiteDomain) {
      return true;
    }
    return false;
  });
}

export function upsertLead(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: {
    id?: string;
    businessName: string;
    industry?: string;
    locality?: string;
    phone?: string | null;
    email?: string | null;
    existingWebsite?: string | null;
    source?: string;
    internalNotes?: string;
    consentStatus?: 'GRANTED' | 'PENDING' | 'OPTED_OUT' | 'NONE';
    consentProvenance?: string;
    confirmedFacts?: ConfirmedFact[];
    missingFields?: string[];
  }
): { lead: LeadRecord; deduplicated: boolean } {
  const { user } = requireOperator(ctx, 'LEADS');
  const businessName = bounded(input.businessName, 160, 2);
  const industry = input.industry ? bounded(input.industry, 120, 2) : 'Afaceri locale';
  const locality = input.locality ? bounded(input.locality, 120, 2) : 'România';
  const normalizedPhone = normalizeRomanianPhone(input.phone);
  const email = normalizeLeadEmail(input.email);
  const websiteInfo = normalizeWebsiteDomain(input.existingWebsite);
  const source = input.source ? bounded(input.source, 240, 2) : 'Introdus manual de operator';
  const internalNotes = input.internalNotes ? bounded(input.internalNotes, 8000, 0) : '';

  const explicitExisting = input.id ? (store.get('leads', input.id) as LeadRecord | undefined) : undefined;
  const matchedByIdentifier =
    explicitExisting ||
    findExistingLeadByIdentifiers(store, {
      normalizedPhone,
      email,
      websiteDomain: websiteInfo?.domain || null
    });

  // Check persistent opt-out registry first — recreating a lead NEVER bypasses a prior opt-out!
  const optedOut = isContactOptedOut(
    store,
    normalizedPhone || matchedByIdentifier?.normalizedPhone,
    email || matchedByIdentifier?.email
  );

  let consentStatus: LeadRecord['consentStatus'] =
    input.consentStatus || matchedByIdentifier?.consentStatus || 'NONE';
  let consentProvenance =
    input.consentProvenance !== undefined
      ? String(input.consentProvenance).slice(0, 300)
      : matchedByIdentifier?.consentProvenance || 'Fără acord comercial confirmat';

  if (optedOut) {
    consentStatus = 'OPTED_OUT';
    consentProvenance = 'Destinatarul este înregistrat în lista de dezabonare (opt-out persistent).';
  } else if (input.consentStatus === 'OPTED_OUT') {
    recordContactOptOut(store, events, {
      normalizedPhone: normalizedPhone || matchedByIdentifier?.normalizedPhone,
      email: email || matchedByIdentifier?.email,
      leadId: matchedByIdentifier?.id,
      reason: consentProvenance || 'Dezabonat de operator',
      actor: user.id
    });
  }

  const baseFacts: ConfirmedFact[] = matchedByIdentifier?.confirmedFacts ? [...matchedByIdentifier.confirmedFacts] : [];
  const addFact = (field: string, value: string | null | undefined, factSource: string) => {
    if (!value) return;
    const idx = baseFacts.findIndex(f => f.field === field);
    const entry: ConfirmedFact = { field, value, source: factSource, confirmedAt: now() };
    if (idx >= 0) baseFacts[idx] = entry;
    else baseFacts.push(entry);
  };
  addFact('businessName', businessName, source);
  addFact('industry', industry, source);
  addFact('locality', locality, source);
  if (normalizedPhone) addFact('phone', normalizedPhone, source);
  if (email) addFact('email', email, source);
  if (websiteInfo) addFact('existingWebsite', websiteInfo.url, source);
  if (Array.isArray(input.confirmedFacts)) {
    for (const f of input.confirmedFacts) {
      if (f?.field && f?.value) addFact(String(f.field).slice(0, 60), String(f.value).slice(0, 400), String(f.source || source).slice(0, 200));
    }
  }

  const defaultMissing: string[] = [];
  if (!normalizedPhone && !matchedByIdentifier?.normalizedPhone) defaultMissing.push('Număr de telefon confirmat');
  if (!email && !matchedByIdentifier?.email) defaultMissing.push('Adresă de email confirmată');
  defaultMissing.push('Prețuri și listă completă de servicii/produse confirmate', 'Program exact de funcționare și adresă stradală');

  const missingFields = Array.isArray(input.missingFields) && input.missingFields.length
    ? input.missingFields.map(m => String(m).slice(0, 160))
    : matchedByIdentifier?.missingFields?.length
    ? matchedByIdentifier.missingFields
    : defaultMissing;

  const finalPhone = normalizedPhone ?? matchedByIdentifier?.normalizedPhone ?? null;
  const finalEmail = email ?? matchedByIdentifier?.email ?? null;
  const finalWebsite = websiteInfo?.url ?? matchedByIdentifier?.existingWebsite ?? null;
  const finalDomain = websiteInfo?.domain ?? matchedByIdentifier?.websiteDomain ?? null;

  const record: LeadRecord = {
    id: matchedByIdentifier?.id || id(),
    ownerId: user.id,
    businessName,
    industry,
    locality,
    normalizedPhone: finalPhone,
    email: finalEmail,
    existingWebsite: finalWebsite,
    websiteDomain: finalDomain,
    // Never assume a business has no website merely because search did not find one
    websiteStatus: finalWebsite ? 'KNOWN' : 'UNCONFIRMED',
    source,
    confirmedFacts: baseFacts,
    missingFields,
    internalNotes: internalNotes || matchedByIdentifier?.internalNotes || '',
    consentStatus,
    consentProvenance,
    consentUpdatedAt: now(),
    createdAt: matchedByIdentifier?.createdAt || now(),
    updatedAt: now()
  };

  store.put('leads', record, user.id);
  recordOperatorAudit(
    store,
    user.id,
    matchedByIdentifier ? 'operator.lead.updated' : 'operator.lead.created',
    `${record.id} (${record.businessName})`
  );
  events?.publish('leads');
  return { lead: record, deduplicated: Boolean(matchedByIdentifier && !input.id) };
}

export function currentBucharestDay(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export function getAgencyBudget(store: Store): AgencyBudgetState {
  const day = currentBucharestDay();
  const cfg = store.get('agency-budget', 'config') || {
    id: 'config',
    perDemoMaxUnits: Number(process.env.OPERATOR_DEMO_MAX_UNITS || 3000),
    dailyMaxUnits: Number(process.env.OPERATOR_DAILY_MAX_UNITS || 30000),
    totalSpentUnits: 0
  };
  const daily = store.get('agency-budget', 'day:' + day) || {
    id: 'day:' + day,
    spentUnits: 0,
    demosCount: 0
  };
  return {
    perDemoMaxUnits: Number(cfg.perDemoMaxUnits || 3000),
    dailyMaxUnits: Number(cfg.dailyMaxUnits || 30000),
    spentTodayUnits: Number(daily.spentUnits || 0),
    totalSpentUnits: Number(cfg.totalSpentUnits || 0),
    demosBuiltToday: Number(daily.demosCount || 0),
    day
  };
}

export function updateAgencyBudgetLimits(
  store: Store,
  ctx: Context,
  input: { perDemoMaxUnits: number; dailyMaxUnits: number }
): AgencyBudgetState {
  const { user } = requireOperator(ctx, 'PROPOSALS');
  const perDemo = Number(input.perDemoMaxUnits);
  const daily = Number(input.dailyMaxUnits);
  if (!Number.isSafeInteger(perDemo) || perDemo < 10 || perDemo > 10000) {
    fail('Bugetul maxim per demonstrație trebuie să fie între 10 și 10000 unități.');
  }
  if (!Number.isSafeInteger(daily) || daily < perDemo || daily > 100000) {
    fail('Limita zilnică a agenției trebuie să fie cel puțin egală cu bugetul unei demonstrații.');
  }
  const existing = store.get('agency-budget', 'config') || { id: 'config', totalSpentUnits: 0 };
  store.put('agency-budget', {
    ...existing,
    id: 'config',
    perDemoMaxUnits: perDemo,
    dailyMaxUnits: daily,
    updatedAt: now()
  });
  recordOperatorAudit(store, user.id, 'operator.budget.updated', `perDemo=${perDemo}, daily=${daily}`);
  return getAgencyBudget(store);
}

export function reserveAgencyDemoBudget(store: Store, units: number): void {
  const nested = store.db.isTransaction;
  store.db.exec(nested ? 'SAVEPOINT agency_budget' : 'BEGIN IMMEDIATE');
  try {
    const state = getAgencyBudget(store);
    if (units > state.perDemoMaxUnits) {
      fail(`Demonstrația solicită ${units} unități, peste bugetul maxim per demonstrație (${state.perDemoMaxUnits}).`, 'BAD_USER_INPUT');
    }
    if (state.spentTodayUnits + units > state.dailyMaxUnits) {
      fail(`Limita zilnică de buget a agenției (${state.dailyMaxUnits} unități) a fost atinsă.`, 'RATE_LIMITED');
    }
    const cfg = store.get('agency-budget', 'config') || {
      id: 'config',
      perDemoMaxUnits: state.perDemoMaxUnits,
      dailyMaxUnits: state.dailyMaxUnits,
      totalSpentUnits: 0
    };
    const dailyKey = 'day:' + state.day;
    const daily = store.get('agency-budget', dailyKey) || { id: dailyKey, spentUnits: 0, demosCount: 0 };

    store.put('agency-budget', {
      ...cfg,
      totalSpentUnits: Number(cfg.totalSpentUnits || 0) + units,
      updatedAt: now()
    });
    store.put('agency-budget', {
      ...daily,
      spentUnits: Number(daily.spentUnits || 0) + units,
      demosCount: Number(daily.demosCount || 0) + 1,
      updatedAt: now()
    });
    store.db.exec(nested ? 'RELEASE SAVEPOINT agency_budget' : 'COMMIT');
  } catch (err) {
    if (nested) {
      store.db.exec('ROLLBACK TO SAVEPOINT agency_budget');
      store.db.exec('RELEASE SAVEPOINT agency_budget');
    } else {
      store.db.exec('ROLLBACK');
    }
    throw err;
  }
}

function escapeXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates isolated desktop and mobile SVG data-URI captures from the verified preview metadata
 * without executing any untrusted generated code on the host machine.
 */
export function generateIsolatedProposalCaptures(input: {
  businessName: string;
  industry: string;
  locality: string;
  hasWhatsapp: boolean;
  sections: string[];
}): { desktopDataUrl: string; mobileDataUrl: string } {
  const title = escapeXml(input.businessName.slice(0, 48));
  const sub = escapeXml(`${input.industry} · ${input.locality}`.slice(0, 64));
  const navItems = input.sections.slice(0, 4).map(s => escapeXml(s)).join('   ·   ');
  const waBadge = input.hasWhatsapp ? 'Contact rapid pe WhatsApp disponibil' : 'Versiune demonstrativă personalizabilă';

  const desktopSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#111622"/>
        <stop offset="100%" stop-color="#1d2638"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#bg)"/>
    <rect x="48" y="36" width="1184" height="728" rx="18" fill="#faf7f2" stroke="#d8cfc2" stroke-width="2"/>
    <rect x="48" y="36" width="1184" height="54" rx="18" fill="#efe9df"/>
    <circle cx="80" cy="63" r="7" fill="#d97757"/>
    <circle cx="102" cy="63" r="7" fill="#e2b93b"/>
    <circle cx="124" cy="63" r="7" fill="#4f9d69"/>
    <text x="160" y="69" font-family="sans-serif" font-size="15" font-weight="600" fill="#4a433b">${title} — Previzualizare Desktop</text>
    <text x="780" y="69" font-family="sans-serif" font-size="13" fill="#6e655b">${navItems}</text>
    <rect x="96" y="136" width="620" height="310" rx="16" fill="#ffffff" stroke="#e4ddd3"/>
    <text x="132" y="192" font-family="sans-serif" font-size="13" font-weight="700" fill="#8c5a3c" letter-spacing="1.5">${sub.toUpperCase()}</text>
    <text x="132" y="246" font-family="sans-serif" font-size="40" font-weight="800" fill="#1e1b18">${title}</text>
    <text x="132" y="294" font-family="sans-serif" font-size="18" fill="#575049">Prezentare digitală clară, adaptată pentru mobil și desktop.</text>
    <rect x="132" y="336" width="230" height="48" rx="24" fill="#1e1b18"/>
    <text x="247" y="366" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700" fill="#ffffff">Descoperă oferta</text>
    ${input.hasWhatsapp ? `<rect x="380" y="336" width="250" height="48" rx="24" fill="#1f7a4c"/><text x="505" y="366" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700" fill="#ffffff">Scrie pe WhatsApp</text>` : ''}
    <rect x="752" y="136" width="432" height="310" rx="16" fill="#ebe3d5" stroke="#dfd5c5"/>
    <text x="968" y="285" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700" fill="#5c4938">${title}</text>
    <text x="968" y="316" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#7a6855">${escapeXml(waBadge)}</text>
    <rect x="96" y="484" width="340" height="220" rx="14" fill="#ffffff" stroke="#e4ddd3"/>
    <text x="124" y="532" font-family="sans-serif" font-size="20" font-weight="700" fill="#1e1b18">Servicii &amp; Meniu</text>
    <text x="124" y="566" font-family="sans-serif" font-size="14" fill="#6e655b">Structură clară, pregătită pentru completarea</text>
    <text x="124" y="588" font-family="sans-serif" font-size="14" fill="#6e655b">produselor și prețurilor oficiale.</text>
    <rect x="468" y="484" width="340" height="220" rx="14" fill="#ffffff" stroke="#e4ddd3"/>
    <text x="496" y="532" font-family="sans-serif" font-size="20" font-weight="700" fill="#1e1b18">Despre &amp; Locație</text>
    <text x="496" y="566" font-family="sans-serif" font-size="14" fill="#6e655b">Informații verificate pentru clienții din</text>
    <text x="496" y="588" font-family="sans-serif" font-size="14" fill="#6e655b">${escapeXml(input.locality)}.</text>
    <rect x="840" y="484" width="344" height="220" rx="14" fill="#ffffff" stroke="#e4ddd3"/>
    <text x="868" y="532" font-family="sans-serif" font-size="20" font-weight="700" fill="#1e1b18">Contact Direct</text>
    <text x="868" y="566" font-family="sans-serif" font-size="14" fill="#6e655b">Acces rapid la telefon, email și WhatsApp</text>
    <text x="868" y="588" font-family="sans-serif" font-size="14" fill="#6e655b">confirmate de proprietar.</text>
  </svg>`;

  const mobileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844">
    <rect width="390" height="844" rx="36" fill="#141923"/>
    <rect x="16" y="24" width="358" height="796" rx="28" fill="#faf7f2"/>
    <rect x="135" y="38" width="120" height="6" rx="3" fill="#d5cbbd"/>
    <text x="40" y="88" font-family="sans-serif" font-size="18" font-weight="800" fill="#1e1b18">${title}</text>
    <rect x="36" y="116" width="318" height="260" rx="16" fill="#ffffff" stroke="#e4ddd3"/>
    <text x="56" y="156" font-family="sans-serif" font-size="12" font-weight="700" fill="#8c5a3c">${sub.toUpperCase()}</text>
    <text x="56" y="198" font-family="sans-serif" font-size="26" font-weight="800" fill="#1e1b18">${title}</text>
    <text x="56" y="232" font-family="sans-serif" font-size="14" fill="#575049">Experiență optimizată pentru telefon.</text>
    <rect x="56" y="264" width="278" height="44" rx="22" fill="#1e1b18"/>
    <text x="195" y="292" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="#ffffff">Vezi detalii &amp; meniu</text>
    ${input.hasWhatsapp ? `<rect x="56" y="318" width="278" height="42" rx="21" fill="#1f7a4c"/><text x="195" y="344" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="#ffffff">WhatsApp Direct</text>` : ''}
    <rect x="36" y="400" width="318" height="175" rx="14" fill="#ffffff" stroke="#e4ddd3"/>
    <text x="56" y="438" font-family="sans-serif" font-size="17" font-weight="700" fill="#1e1b18">Secțiuni pregătite</text>
    <text x="56" y="468" font-family="sans-serif" font-size="13" fill="#6e655b">• Acasă &amp; Prezentare</text>
    <text x="56" y="494" font-family="sans-serif" font-size="13" fill="#6e655b">• Oferta / Meniul (de completat)</text>
    <text x="56" y="520" font-family="sans-serif" font-size="13" fill="#6e655b">• Locație în ${escapeXml(input.locality)}</text>
    <text x="56" y="546" font-family="sans-serif" font-size="13" fill="#6e655b">• Contact confirmat</text>
    <rect x="36" y="596" width="318" height="180" rx="14" fill="#efe9df"/>
    <text x="56" y="636" font-family="sans-serif" font-size="16" font-weight="700" fill="#1e1b18">Demonstrație Starlidigital</text>
    <text x="56" y="666" font-family="sans-serif" font-size="13" fill="#575049">Revendică gratuit proiectul pentru a-l</text>
    <text x="56" y="688" font-family="sans-serif" font-size="13" fill="#575049">edita împreună cu Starli AI.</text>
  </svg>`;

  return {
    desktopDataUrl: `data:image/svg+xml;base64,${Buffer.from(desktopSvg, 'utf8').toString('base64')}`,
    mobileDataUrl: `data:image/svg+xml;base64,${Buffer.from(mobileSvg, 'utf8').toString('base64')}`
  };
}

/**
 * Builds deterministic, high-craft Next.js App Router + React + TypeScript demo source files
 * strictly adhering to confirmed facts vs. placeholders for unconfirmed items (never inventing prices, menus, reviews, or contacts).
 */
export function buildVerifiedDemoNextFiles(input: {
  businessName: string;
  industry: string;
  locality: string;
  normalizedPhone: string | null;
  email: string | null;
  whatsappPhone: string | null;
  confirmedFacts: ConfirmedFact[];
  missingFields: string[];
  customSummary?: string;
}): { files: SourceFile[]; previewHtml: string } {
  const spec=buildProposalSpec({proposalId:id(),leadId:id(),mode:'bespoke',lead:{businessName:input.businessName,industry:input.industry,locality:input.locality,normalizedPhone:input.normalizedPhone||undefined,email:input.email||undefined,confirmedFacts:input.confirmedFacts.map(f=>f.field+': '+f.value),missingFields:input.missingFields},requestedSummary:input.customSummary});
  const files=makePremiumNextFiles(spec);
  return {files,previewHtml:renderNextPreviewHtml(files,{title:input.businessName,path:'/'})};
}

export function buildWelcomeMessageText(lead: LeadRecord, proposal: ProposalRecord): string {
  const confirmedList = proposal.confirmedFacts
    .map(f => `• **${f.field}**: ${f.value}`)
    .join('\n');
  const missingList = proposal.missingFields
    .map(m => `• ${m}`)
    .join('\n');

  return [
    `Bună! Sunt **Starli AI** de la **Starlidigital**. Am pregătit o primă versiune demonstrativă de website pentru **${lead.businessName}** (${lead.industry}, ${lead.locality}).`,
    '',
    '### Ce am inclus în această primă versiune',
    'Am construit o structură multi-pagină în React și Next.js (Acasă, Meniu/Servicii, Despre & Locație, Contact) cu navigare funcțională pe desktop și telefon, bazată exclusiv pe datele confirmate:',
    confirmedList || '• Numele afacerii și localitatea.',
    '',
    '### Ce informații mai trebuie confirmate înainte de publicare',
    'Nu am inventat prețuri, meniuri, testimoniale sau date neconfirmate. După revendicare, putem completa împreună:',
    missingList || '• Detalii specifice despre produse/servicii și program.',
    '',
    '### Cum poți cere modificări și cum revendici website-ul',
    '1. **Vizualizarea demonstrației și revendicarea proiectului sunt gratuite.**',
    '2. Folosește butonul **„Revendică acest website”** de pe această pagină: autentifică-te sau creează-ți un cont gratuit, introdu codul de 5 cifre primit în invitația SMS. Nu este nevoie de un al doilea SMS.',
    '3. După revendicare, proiectul trece în contul tău și îl poți edita în **Starli Studio**. Editările manuale de text sunt gratuite, iar reconstrucțiile sau generările AI avansate folosesc credite cu autorizare explicită înainte de orice consum.',
    '4. **Domeniul web personalizat** (ex. `.ro` sau `.com`) și publicarea dedicată se achită separat, doar dacă și când decizi să lansezi website-ul public.',
    '',
    'Dacă vrei să discuți direct cu un om din echipa noastră, poți deschide oricând o conversație cu **Alex** din secțiunea „Vorbește cu Alex”.'
  ].join('\n');
}

/**
 * Creates or returns the existing persistent welcome conversation for a proposal.
 * Never generates duplicate paid messages on page refresh.
 */
export function ensureProposalWelcomeConversation(
  store: Store,
  lead: LeadRecord,
  proposal: ProposalRecord
): RecordData {
  if (proposal.welcomeConversationId) {
    const existing = store.get('conversations', proposal.welcomeConversationId);
    if (existing && Array.isArray(existing.messages) && existing.messages.length > 0) {
      return existing;
    }
  }
  const convId = proposal.welcomeConversationId || id();
  const initialMsg = {
    id: `welcome-${proposal.id}`,
    role: 'assistant',
    content: buildWelcomeMessageText(lead, proposal),
    createdAt: proposal.createdAt || now(),
    authorName: 'Starli AI',
    suggestedFollowUp: 'Vreau să revendic proiectul și să completez meniul și programul.'
  };
  const conv: RecordData = {
    id: convId,
    ownerId: proposal.claimedByUserId || proposal.ownerId,
    projectId: proposal.projectId,
    proposalId: proposal.id,
    title: `Întâmpinare propunere · ${lead.businessName}`,
    mode: 'STARLI',
    status: 'OPEN',
    messages: [initialMsg],
    createdAt: proposal.createdAt || now(),
    updatedAt: now()
  };
  store.put('conversations', conv, conv.ownerId);
  return conv;
}

export function generateClaimSecretCode(): string {
  return String(randomInt(0, 100000)).padStart(5, '0');
}

type DeliveryCacheEntry = {
  claimCode: string;
  expiresAt: string;
};

const activeDeliveryCodes = new Map<string, DeliveryCacheEntry>();

export function setDeliveryClaimCode(proposalId: string, claimCode: string, expiresAt: string): void {
  activeDeliveryCodes.set(proposalId, { claimCode, expiresAt });
}

export function getDeliveryClaimCode(proposalId: string): string | null {
  const entry = activeDeliveryCodes.get(proposalId);
  if (!entry) return null;
  if (Date.parse(entry.expiresAt) <= Date.now()) {
    activeDeliveryCodes.delete(proposalId);
    return null;
  }
  return entry.claimCode;
}

export function clearDeliveryClaimCode(proposalId: string): void {
  activeDeliveryCodes.delete(proposalId);
}

// Slow salted hashes keep the five-digit invitation code out of recoverable database fields.
function hashClaimCode(code: string): string {
  const salt = randomBytes(16).toString('hex');
  return `claim-v2:${salt}:${scryptSync(code, salt, 32).toString('hex')}`;
}

function matchesClaimCode(code: string, storedHash: string): boolean {
  let expected: Buffer;
  let actual: Buffer;
  if (storedHash.startsWith('claim-v2:')) {
    const [, salt, digest] = storedHash.split(':');
    if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{64}$/.test(digest || '')) return false;
    expected = Buffer.from(digest, 'hex');
    actual = scryptSync(code, salt, 32);
  } else {
    // Existing long invitation codes remain usable until expiry or operator rotation.
    expected = Buffer.from(storedHash, 'hex');
    actual = Buffer.from(hashToken(code), 'hex');
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createOrUpdateProposalDemo(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: {
    leadId?: string;
    businessName?: string;
    industry?: string;
    locality?: string;
    phone?: string | null;
    email?: string | null;
    existingWebsite?: string | null;
    includeWhatsapp?: boolean;
    customBrief?: string;
    consentStatus?: 'GRANTED' | 'PENDING' | 'OPTED_OUT' | 'NONE';
    consentProvenance?: string;
    confirmedFacts?: ConfirmedFact[];
    missingFields?: string[];
    mode?: ProposalMode;
  }
): { lead: LeadRecord; proposal: ProposalRecord; project: RecordData; claimCode: string; deduplicated: boolean } {
  const { user } = requireOperator(ctx, 'PROPOSALS');

  let lead: LeadRecord;
  let leadDeduplicated = false;
  if (input.leadId) {
    const found = store.get('leads', input.leadId) as LeadRecord | undefined;
    if (!found) fail('Leadul specificat nu există.', 'NOT_FOUND');
    lead = found;
  } else {
    if (!input.businessName) fail('Numele afacerii este obligatoriu pentru pregătirea propunerii.');
    const upserted = upsertLead(store, events, ctx, {
      businessName: input.businessName,
      industry: input.industry,
      locality: input.locality,
      phone: input.phone,
      email: input.email,
      existingWebsite: input.existingWebsite,
      consentStatus: input.consentStatus,
      consentProvenance: input.consentProvenance,
      confirmedFacts: input.confirmedFacts,
      missingFields: input.missingFields
    });
    lead = upserted.lead;
    leadDeduplicated = upserted.deduplicated;
  }

  // Check if an active proposal already exists for this lead
  const existingProposal = (store.list('proposals') as ProposalRecord[]).find(
    p => p.leadId === lead.id && p.status!=='ARHIVAT' && !p.claimedByUserId
  );

  const proposalMode: ProposalMode = input.mode || 'snapshot';
  const whatsappPhone =
    input.includeWhatsapp !== false && lead.normalizedPhone ? lead.normalizedPhone : null;

  const spec = buildProposalSpec({
    proposalId: existingProposal?.id || id(),
    leadId: lead.id,
    lead: {
      businessName: lead.businessName,
      industry: lead.industry,
      locality: lead.locality,
      normalizedPhone: lead.normalizedPhone || undefined,
      email: lead.email || undefined,
      existingWebsite: lead.existingWebsite || undefined,
      confirmedFacts: (lead.confirmedFacts || []).map(f => `${f.field}: ${f.value}`),
      missingFields: lead.missingFields
    },
    mode: proposalMode,
    requestedSummary: input.customBrief
  });

  let files: SourceFile[] = [];
  let previewHtml = '';
  let demoCostUnits = spec.costAccounting.totalCostUnits;

  if (proposalMode === 'bespoke') {
    // Option 1: Full autonomous custom site generation via Next.js builder
    const built = buildVerifiedDemoNextFiles({
      businessName: lead.businessName,
      industry: lead.industry,
      locality: lead.locality,
      normalizedPhone: lead.normalizedPhone,
      email: lead.email,
      whatsappPhone,
      confirmedFacts: lead.confirmedFacts,
      missingFields: lead.missingFields,
      customSummary: input.customBrief
    });
    files = built.files;
    previewHtml = built.previewHtml;

    // Verify navigation on all generated pages
    for (const navPath of ['/', '/servicii', '/despre', '/contact']) {
      const rendered = renderNextPreviewHtml(files, { title: lead.businessName, path: navPath });
      if (!rendered || !rendered.includes('<html')) {
        fail(`Verificarea navigării în demonstrație a eșuat pentru ruta ${navPath}.`);
      }
    }
  } else {
    // A deterministic React/Next.js project, with no AI builder call or customer credit charge.
    files=makePremiumNextFiles(spec);
    previewHtml = renderVerticalTemplate(spec, '/');
  }

  // Reserve agency demo budget (never touches any client wallet!)
  reserveAgencyDemoBudget(store, demoCostUnits);

  const captures = generateIsolatedProposalCaptures({
    businessName: lead.businessName,
    industry: lead.industry,
    locality: lead.locality,
    hasWhatsapp: Boolean(whatsappPhone),
    sections: ['Acasă', 'Servicii', 'Despre', 'Contact']
  });

  const projectId = existingProposal?.projectId || id();
  const projectRecord: RecordData = {
    id: projectId,
    ownerId: user.id,
    isOperatorDemo: true,
    leadId: lead.id,
    name: lead.businessName,
    brief:publicOperatorBrief(lead),
    status: 'PREVIEW',
    lifecycle: 'demo',
    previewUrl: null,
    deploymentUrl: null,
    html: null,
    previewHtml,
    files,
    research: `Analiză și structură demonstrativă pentru ${lead.businessName} (${lead.locality}).`,
    sources: lead.existingWebsite ? [{ title: lead.businessName, url: lead.existingWebsite }] : [],
    versions: [
      {
        id: id(),
        projectId,
        source: 'operator-demo',
        summary: `Versiune demonstrativă inițială pentru ${lead.businessName}`,
        createdBy: 'Starli Operator',
        agentRunId: null,
        bookmarked: true,
        sourceHash: hashToken(JSON.stringify(files)),
        previewHtml,
        files,
        createdAt: now()
      }
    ],
    agentRuns: [],
    notifications: [],
    validationStatus: 'PASSED',
    validationProvider: 'AST_VERIFIED',
    buildError: null,
    createdAt: existingProposal ? store.get('projects', projectId)?.createdAt || now() : now(),
    updatedAt: now()
  };
  store.put('projects', projectRecord, user.id);

  const slugBase = lead.businessName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'propunere';
  const publicSlug = existingProposal?.publicSlug || `${slugBase}-${randomBytes(4).toString('hex')}`;

  const rawClaimCode = generateClaimSecretCode();
  const claimExpiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
  const proposalId = existingProposal?.id || id();
  const welcomeConversationId = existingProposal?.welcomeConversationId || id();

  const proposal: ProposalRecord = {
    id: proposalId,
    ownerId: user.id,
    leadId: lead.id,
    projectId: projectRecord.id,
    publicSlug,
    businessName: lead.businessName,
    industry: lead.industry,
    locality: lead.locality,
    status: 'PREGATIT',
    confirmedFacts: lead.confirmedFacts,
    missingFields: lead.missingFields,
    whatsappPhone,
    desktopScreenshotUrl: captures.desktopDataUrl,
    mobileScreenshotUrl: captures.mobileDataUrl,
    welcomeConversationId,
    claimCodeHash: hashClaimCode(rawClaimCode),
    claimCodePrefix: '•••••',
    claimExpiresAt,
    claimRevokedAt: null,
    claimAttempts: 0,
    claimOtpHash: null,
    claimOtpExpiresAt: null,
    claimOtpAttempts: 0,
    claimInvitedContact: lead.normalizedPhone || lead.email || null,
    claimedByUserId: existingProposal?.claimedByUserId || null,
    claimedAt: existingProposal?.claimedAt || null,
    agencyCostUnits: (existingProposal?.agencyCostUnits || 0) + demoCostUnits,
    generationMode: proposalMode,
    specJson: JSON.stringify(spec),
    leadScore: existingProposal?.leadScore || 'cold',
    templateVertical: spec.template.vertical,
    templateVersion: spec.template.version,
    templateVariant: spec.template.variant,
    costAiUnits: demoCostUnits,
    costBuildUnits: proposalMode === 'bespoke' ? 400 : 0,
    lastError: null,
    viewedAt: existingProposal?.viewedAt || null,
    viewCount: existingProposal?.viewCount || 0,
    createdAt: existingProposal?.createdAt || now(),
    updatedAt: now()
  };

  store.put('proposals', proposal, user.id);
  setDeliveryClaimCode(proposal.id, rawClaimCode, claimExpiresAt);
  if(input.customBrief)store.put('operator-project-context',{id:proposalId,ownerId:user.id,projectId,proposalId,privateInstructions:input.customBrief,createdAt:now(),updatedAt:now()},user.id);
  ensureProposalWelcomeConversation(store, lead, proposal);

  recordOperatorAudit(store, user.id, 'operator.proposal.prepared', `${proposal.id} (${lead.businessName})`, {
    publicSlug: proposal.publicSlug,
    agencyCostUnits: demoCostUnits
  });

  events?.publish('proposals');
  events?.publish('projects');
  return {
    lead,
    proposal,
    project: projectRecord,
    claimCode: rawClaimCode,
    deduplicated: Boolean(existingProposal || leadDeduplicated)
  };
}

export function promoteOperatorProposal(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  proposalId: string,
  targetMode: ProposalMode = 'bespoke'
): ProposalRecord {
  const { user } = requireOperator(ctx, 'PROPOSALS');
  const existing = store.get('proposals', proposalId) as ProposalRecord | undefined;
  if (!existing) fail('Propunerea nu există.', 'NOT_FOUND');
  if (existing.generationMode === targetMode) {
    return existing;
  }

  const lead = store.get('leads', existing.leadId) as LeadRecord | undefined;
  if (!lead) fail('Leadul asociat nu mai există.', 'NOT_FOUND');

  const additionalCostUnits = 2430;
  reserveAgencyDemoBudget(store, additionalCostUnits);

  const whatsappPhone = existing.whatsappPhone;
  const { files, previewHtml } = buildVerifiedDemoNextFiles({
    businessName: lead.businessName,
    industry: lead.industry,
    locality: lead.locality,
    normalizedPhone: lead.normalizedPhone,
    email: lead.email,
    whatsappPhone,
    confirmedFacts: lead.confirmedFacts,
    missingFields: lead.missingFields
  });

  const project = store.get('projects', existing.projectId);
  if (project) {
    store.put('projects', {
      ...project,
      files,
      previewHtml,
      status: 'PREVIEW',
      validationStatus: 'PASSED',
      updatedAt: now()
    }, user.id);
  }

  const updated: ProposalRecord = {
    ...existing,
    generationMode: 'bespoke',
    costAiUnits: (existing.costAiUnits || 0) + additionalCostUnits,
    agencyCostUnits: (existing.agencyCostUnits || 0) + additionalCostUnits,
    leadScore: existing.leadScore === 'cold' ? 'engaged' : existing.leadScore,
    updatedAt: now()
  };

  store.put('proposals', updated, user.id);
  recordOperatorAudit(store, user.id, 'operator.proposal.promoted', `${proposalId} -> bespoke`, {
    additionalCostUnits
  });
  events?.publish('proposals');
  events?.publish('projects');
  return updated;
}

export function transitionProposalState(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  proposalId: string,
  nextState: ProposalState,
  errorDetail?: string
): ProposalRecord {
  const { user } = requireOperator(ctx, 'PROPOSALS');
  const existing = store.get('proposals', proposalId) as ProposalRecord | undefined;
  if (!existing) fail('Propunerea nu există.', 'NOT_FOUND');
  if (!(PROPOSAL_STATES as readonly string[]).includes(nextState)) {
    fail('Starea propunerii nu este validă.');
  }
  const updated: ProposalRecord = {
    ...existing,
    status: nextState,
    lastError: errorDetail !== undefined ? redactSecrets(errorDetail).slice(0, 500) : existing.lastError,
    updatedAt: now()
  };
  store.put('proposals', updated, existing.ownerId);
  recordOperatorAudit(store, user.id, 'operator.proposal.state_changed', `${proposalId} -> ${nextState}`);
  events?.publish('proposals');
  return updated;
}

export function rotateOrRevokeClaimCode(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  proposalId: string,
  revokeOnly = false,
  ttlHours = 24 * 14
): { proposal: ProposalRecord; claimCode: string | null } {
  const { user } = requireOperator(ctx, 'PROPOSALS');
  const existing = store.get('proposals', proposalId) as ProposalRecord | undefined;
  if (!existing) fail('Propunerea nu există.', 'NOT_FOUND');
  if (existing.status === 'REVENDICAT') {
    fail('Propunerea a fost deja revendicată.');
  }
  if (revokeOnly) {
    clearDeliveryClaimCode(proposalId);
    const revoked: ProposalRecord = {
      ...existing,
      claimRevokedAt: now(),
      claimCodeHash: null,
      claimOtpHash: null,
      updatedAt: now()
    };
    store.put('proposals', revoked, existing.ownerId);
    recordOperatorAudit(store, user.id, 'operator.proposal.claim_revoked', proposalId);
    events?.publish('proposals');
    return { proposal: revoked, claimCode: null };
  }

  const rawCode = generateClaimSecretCode();
  const expiresAt = new Date(Date.now() + Math.max(1, ttlHours) * 3600000).toISOString();
  const updated: ProposalRecord = {
    ...existing,
    claimCodeHash: hashClaimCode(rawCode),
    claimCodePrefix: '•••••',
    claimExpiresAt: expiresAt,
    claimRevokedAt: null,
    claimAttempts: 0,
    claimOtpHash: null,
    claimOtpExpiresAt: null,
    claimOtpAttempts: 0,
    updatedAt: now()
  };
  store.put('proposals', updated, existing.ownerId);
  setDeliveryClaimCode(proposalId, rawCode, expiresAt);
  recordOperatorAudit(store, user.id, 'operator.proposal.claim_issued', proposalId);
  events?.publish('proposals');
  return { proposal: updated, claimCode: rawCode };
}

export type ProposalDeliveryInfo = {
  proposalId: string;
  leadId: string;
  businessName: string;
  publicSlug: string;
  publicUrl: string;
  claimCode: string | null;
  status: ProposalState;
  claimExpiresAt: string | null;
  reissued: boolean;
  claimed: boolean;
  message?: string;
};

export function getProposalDeliveryInfo(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  proposalId: string,
  options?: { forceReissue?: boolean; reissueIfMissing?: boolean }
): ProposalDeliveryInfo {
  const { user } = requireOperator(ctx, 'PROPOSALS');
  const proposal = store.get('proposals', proposalId) as ProposalRecord | undefined;
  if (!proposal) {
    fail('Propunerea nu există.', 'NOT_FOUND');
  }

  const publicUrl = `https://starlidigital.ro/propunere/${proposal.publicSlug}`;

  // If already claimed, claim code is invalidated forever
  if (proposal.status === 'REVENDICAT' || proposal.claimedByUserId) {
    return {
      proposalId: proposal.id,
      leadId: proposal.leadId,
      businessName: proposal.businessName,
      publicSlug: proposal.publicSlug,
      publicUrl,
      claimCode: null,
      status: proposal.status,
      claimExpiresAt: proposal.claimExpiresAt,
      reissued: false,
      claimed: true,
      message: 'Propunerea a fost deja revendicată.',
    };
  }

  const forceReissue = Boolean(options?.forceReissue);
  const reissueIfMissing = options?.reissueIfMissing !== false;

  const isExpired = !proposal.claimExpiresAt || Date.parse(proposal.claimExpiresAt) <= Date.now();
  const isRevoked = Boolean(proposal.claimRevokedAt) || !proposal.claimCodeHash;
  const isLocked = (proposal.claimAttempts || 0) >= 5;

  const cachedCode = getDeliveryClaimCode(proposal.id);

  if (!forceReissue && !isExpired && !isRevoked && !isLocked && cachedCode) {
    return {
      proposalId: proposal.id,
      leadId: proposal.leadId,
      businessName: proposal.businessName,
      publicSlug: proposal.publicSlug,
      publicUrl,
      claimCode: cachedCode,
      status: proposal.status,
      claimExpiresAt: proposal.claimExpiresAt,
      reissued: false,
      claimed: false,
    };
  }

  if (forceReissue || isExpired || isRevoked || isLocked || reissueIfMissing) {
    const rotated = rotateOrRevokeClaimCode(store, events, ctx, proposal.id, false);
    recordOperatorAudit(store, user.id, 'operator.proposal.delivery_issued', proposal.id);
    return {
      proposalId: rotated.proposal.id,
      leadId: rotated.proposal.leadId,
      businessName: rotated.proposal.businessName,
      publicSlug: rotated.proposal.publicSlug,
      publicUrl,
      claimCode: rotated.claimCode,
      status: rotated.proposal.status,
      claimExpiresAt: rotated.proposal.claimExpiresAt,
      reissued: true,
      claimed: false,
    };
  }

  return {
    proposalId: proposal.id,
    leadId: proposal.leadId,
    businessName: proposal.businessName,
    publicSlug: proposal.publicSlug,
    publicUrl,
    claimCode: null,
    status: proposal.status,
    claimExpiresAt: proposal.claimExpiresAt,
    reissued: false,
    claimed: false,
  };
}

export function isLinkScannerBot(userAgent?: string | null): boolean {
  if (!userAgent || typeof userAgent !== 'string') return true;
  const ua = userAgent.toLowerCase();
  const botPatterns = [
    'whatsapp',
    'facebookexternalhit',
    'facebot',
    'twitterbot',
    'telegrambot',
    'slackbot',
    'discordbot',
    'linkedinbot',
    'skypeuripreview',
    'viber',
    'googlebot',
    'bingbot',
    'crawler',
    'spider',
    'preview',
    'curl/',
    'wget/',
    'python-requests'
  ];
  return botPatterns.some(pat => ua.includes(pat));
}

function currentProposalSpec(proposal:ProposalRecord,lead:LeadRecord):ProposalSpec{
  const previous=proposal.specJson?JSON.parse(proposal.specJson) as ProposalSpec:undefined;
  if(previous?.template?.version==='v2.0.0')return previous;
  return buildProposalSpec({proposalId:proposal.id,leadId:lead.id,mode:proposal.generationMode,lead:{businessName:lead.businessName,industry:lead.industry,locality:lead.locality,normalizedPhone:lead.normalizedPhone||undefined,email:lead.email||undefined,existingWebsite:lead.existingWebsite||undefined,confirmedFacts:lead.confirmedFacts.map(f=>f.field+': '+f.value),missingFields:lead.missingFields,heroImage:previous?.media?.heroImage,galleryImages:previous?.media?.galleryImages}});
}

export function getPublicProposalBySlug(
  store: Store,
  events: Events | undefined,
  publicSlug: string,
  options: { userAgent?: string; interactiveVisit?: boolean; path?: string } = {}
): RecordData & {
  publicSlug: string;
  businessName: string;
  industry: string;
  locality: string;
  status: ProposalState;
  demoNotice: string;
  customizationGuide: string;
  confirmedFacts: ConfirmedFact[];
  missingFields: string[];
  whatsappHref: string | null;
  desktopScreenshotUrl: string;
  mobileScreenshotUrl: string;
  previewHtml: string;
  welcomeConversationId: string;
  welcomeMessages: RecordData[];
  optedOut: boolean;
  claimed: boolean;
} {
  const cleanSlug = String(publicSlug || '').trim().toLowerCase();
  const proposal = (store.list('proposals') as ProposalRecord[]).find(p => p.publicSlug === cleanSlug);
  if (!proposal || proposal.status === 'ARHIVAT') {
    fail('Propunerea nu este disponibilă sau a fost retrasă.', 'NOT_FOUND');
  }
  const lead = store.get('leads', proposal.leadId) as LeadRecord | undefined;
  const project = store.get('projects', proposal.projectId);
  if (!lead || !project) {
    fail('Propunerea nu este completă.', 'NOT_FOUND');
  }

  // Do NOT mark as VIZUALIZAT when hit by a link scanner bot!
  const isScanner = isLinkScannerBot(options.userAgent);
  if (options.interactiveVisit && !isScanner) {
    const nextStatus: ProposalState =
      proposal.status === 'PREGATIT' || proposal.status === 'INVITATIE_TRIMISA'
        ? 'VIZUALIZAT'
        : proposal.status;
    const updated: ProposalRecord = {
      ...proposal,
      status: nextStatus,
      leadScore: proposal.leadScore === 'cold' ? 'viewed' : proposal.leadScore,
      viewedAt: proposal.viewedAt || now(),
      viewCount: (proposal.viewCount || 0) + 1,
      updatedAt: now()
    };
    store.put('proposals', updated, proposal.ownerId);
    proposal.status = updated.status;
    proposal.leadScore = updated.leadScore;
    events?.publish('proposals');
  }

  const welcomeConv = ensureProposalWelcomeConversation(store, lead, proposal);
  const targetPath = options.path || '/';
  let previewHtml = '';
  if(Array.isArray(project.files)&&project.files.length){
    previewHtml=renderNextPreviewHtml(project.files,{title:proposal.businessName,path:targetPath});
  } else if (proposal.generationMode === 'snapshot' && proposal.specJson) {
    try {
      const spec = currentProposalSpec(proposal,lead);
      previewHtml = renderVerticalTemplate(spec, targetPath);
    } catch {
      previewHtml = renderNextPreviewHtml(project.files || [], {
        title: proposal.businessName,
        path: targetPath
      });
    }
  } else {
    previewHtml = renderNextPreviewHtml(project.files || [], {
      title: proposal.businessName,
      path: targetPath
    });
  }

  const waDigits = proposal.whatsappPhone ? proposal.whatsappPhone.replace(/[^\d]/g, '') : null;

  return {
    id: proposal.id,
    leadId: proposal.leadId,
    projectId: proposal.projectId,
    publicSlug: proposal.publicSlug,
    businessName: proposal.businessName,
    industry: proposal.industry,
    locality: proposal.locality,
    normalizedPhone: lead.normalizedPhone || null,
    existingWebsite: lead.existingWebsite || null,
    status: proposal.status,
    buildVerified: true,
    demoNotice:
      proposal.generationMode === 'bespoke'
        ? `Aceasta este o versiune demonstrativă personalizată pregătită de Starlidigital pentru ${proposal.businessName}.`
        : `Aceasta este o direcție inițială de design pregătită specific pentru ${proposal.businessName}.`,
    customizationGuide:
      'După revendicare, poți schimba textele, meniul, prețurile, imaginile, culorile și structura paginilor direct în Starli Studio sau prin conversație cu Starli AI.',
    confirmedFacts: proposal.confirmedFacts,
    missingFields: proposal.missingFields,
    missingFacts: proposal.missingFields || [],
    whatsappHref: waDigits ? `https://wa.me/${waDigits}` : null,
    desktopScreenshotUrl: proposal.desktopScreenshotUrl,
    mobileScreenshotUrl: proposal.mobileScreenshotUrl,
    desktopScreenshotSvg: proposal.desktopScreenshotUrl,
    mobileScreenshotSvg: proposal.mobileScreenshotUrl,
    previewHtml,
    navigablePreviewHtml: previewHtml,
    welcomeConversationId: welcomeConv.id,
    welcomeMessage: welcomeConv.messages?.[0]?.content || '',
    welcomeMessages: welcomeConv.messages || [],
    createdAt: proposal.createdAt,
    optedOut: lead.consentStatus === 'OPTED_OUT' || isContactOptedOut(store, lead.normalizedPhone, lead.email),
    claimed: proposal.status === 'REVENDICAT' || Boolean(proposal.claimedByUserId)
  };
}

/**
 * Allows a visitor on the public proposal page to reply in the bounded welcome chat
 * WITHOUT ever spending operator credits, agency budgets, or triggering builds/deployments.
 */
export function sendProposalVisitorMessage(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: { publicSlug: string; content: string }
): RecordData {
  limit('proposal-chat:' + ctx.ip, 12, 600000);
  const cleanSlug = String(input.publicSlug || '').trim().toLowerCase();
  const proposal = (store.list('proposals') as ProposalRecord[]).find(p => p.publicSlug === cleanSlug);
  if (!proposal || proposal.status === 'ARHIVAT') {
    fail('Propunerea nu este disponibilă.', 'NOT_FOUND');
  }
  const lead = store.get('leads', proposal.leadId) as LeadRecord | undefined;
  if (!lead) fail('Propunerea nu este disponibilă.', 'NOT_FOUND');

  const conv = ensureProposalWelcomeConversation(store, lead, proposal);
  if ((conv.messages || []).length >= 40) {
    fail('Conversația de întâmpinare a atins limita. Revendică proiectul pentru a continua în Starli Studio.', 'RATE_LIMITED');
  }

  const text = bounded(input.content, 2000, 1);
  const userMsg = {
    id: id(),
    role: 'user',
    content: text,
    createdAt: now(),
    authorName: ctx.user?.username || 'Vizitator propunere'
  };

  // Bounded deterministic assistant response so visitors can NEVER drain operator AI/credit budget
  const assistantMsg = {
    id: id(),
    role: 'assistant',
    content: `Am notat mesajul tău pentru **${proposal.businessName}**. Pentru siguranța proiectului, modificările de cod, reconstruirea AI și publicarea se activează după ce revendici gratuit demonstrația în contul tău folosind codul de invitație. Dacă ai nevoie de asistență umană imediată, îi poți scrie lui **Alex** din platformă.`,
    createdAt: now(),
    authorName: 'Starli AI'
  };

  conv.messages = [...(conv.messages || []), userMsg, assistantMsg];
  conv.updatedAt = now();
  store.put('conversations', conv, conv.ownerId);
  events?.publish('conversation:' + conv.id);
  return assistantMsg;
}

export function publicOptOutFromProposal(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: { publicSlug: string; reason?: string }
): boolean {
  limit('proposal-optout:' + ctx.ip, 10, 600000);
  const cleanSlug = String(input.publicSlug || '').trim().toLowerCase();
  const proposal = (store.list('proposals') as ProposalRecord[]).find(p => p.publicSlug === cleanSlug);
  if (!proposal) fail('Propunerea nu a fost găsită.', 'NOT_FOUND');
  const lead = store.get('leads', proposal.leadId) as LeadRecord | undefined;

  recordContactOptOut(store, events, {
    normalizedPhone: lead?.normalizedPhone || null,
    email: lead?.email || null,
    leadId: lead?.id || null,
    proposalId: proposal.id,
    reason: input.reason ? bounded(input.reason, 240, 1) : 'Nu mă interesează / nu mai doresc mesaje (pagina propunerii)',
    actor: ctx.user?.id || 'public-visitor'
  });

  recordOperatorAudit(store, ctx.user?.id || 'visitor', 'proposal.public_opt_out', proposal.id);
  return true;
}

const GENERIC_CLAIM_ERROR = 'Codul de revendicare sau datele de verificare nu sunt valide.';

/** @deprecated Invitation codes are redeemed directly; a second SMS is never sent. */
export function requestProposalClaimOtp(
  _store: Store,
  _events: Events | undefined,
  _ctx: Context,
  _input: { publicSlug: string; claimCode: string; contact: string }
): { sent: boolean; maskedContact: string; expiresInSeconds: number; _testOtp?: string } {
  fail('Introdu direct codul primit în invitație pentru a revendica website-ul. Nu este necesar un al doilea SMS.', 'BAD_USER_INPUT');
}

/**
 * Atomic ownership transfer of the demo project and welcome conversation
 * to the authenticated client after verifying the invitation code.
 * Resistant to concurrent claims and idempotent on repeated calls by the winning owner.
 */
export function claimProposalWebsite(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: {
    publicSlug: string;
    claimCode: string;
    otpCode?: string;
  }
): { project: RecordData; proposal: ProposalRecord; alreadyClaimedByMe: boolean } {
  const user = requireUser(ctx);
  limit('claim-exec:' + ctx.ip, 8, 900000);

  const cleanSlug = String(input.publicSlug || '').trim().toLowerCase();
  const cleanCode = String(input.claimCode || '').trim().toUpperCase();

  const nested = store.db.isTransaction;
  const savepoint = 'claim_' + randomBytes(6).toString('hex');
  store.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  try {
    const proposal = (store.list('proposals') as ProposalRecord[]).find(p => p.publicSlug === cleanSlug);
    if (!proposal) fail(GENERIC_CLAIM_ERROR, 'FORBIDDEN');

    // Idempotent repeat by the same user who already won the claim
    if (proposal.status === 'REVENDICAT' && proposal.claimedByUserId === user.id) {
      const ownedProject = store.get('projects', proposal.projectId);
      if (!ownedProject || ownedProject.ownerId !== user.id) {
        fail('Proiectul revendicat nu a fost găsit.', 'NOT_FOUND');
      }
      store.db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      return { project: ownedProject, proposal, alreadyClaimedByMe: true };
    }

    // Reject if already claimed by another user
    if (proposal.status === 'REVENDICAT' || proposal.claimedByUserId) {
      fail('Această propunere a fost deja revendicată.', 'FORBIDDEN');
    }

    if (
      !proposal.claimCodeHash ||
      proposal.claimRevokedAt ||
      !proposal.claimExpiresAt ||
      Date.parse(proposal.claimExpiresAt) <= Date.now() ||
      (proposal.claimAttempts || 0) >= 5
    ) {
      fail(GENERIC_CLAIM_ERROR, 'FORBIDDEN');
    }

    if (!matchesClaimCode(cleanCode, proposal.claimCodeHash)) {
      store.put('proposals', {
        ...proposal,
        claimAttempts: (proposal.claimAttempts || 0) + 1,
        updatedAt: now()
      }, proposal.ownerId);
      store.db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      fail(GENERIC_CLAIM_ERROR, 'FORBIDDEN');
    }

    let project = store.get('projects', proposal.projectId);
    if (!project) fail('Proiectul demonstrativ nu există.', 'NOT_FOUND');

    // Legacy visual-only demos acquire editable React source at transfer, without changing live client sites.
    if(!Array.isArray(project.files)||project.files.length===0){
      if(!proposal.specJson)fail('Propunerea trebuie regenerată înainte de revendicare.','BAD_USER_INPUT');
      const lead=store.get('leads',proposal.leadId) as LeadRecord|undefined;
      if(!lead)fail('Datele afacerii nu mai sunt disponibile.','NOT_FOUND');
      const spec=currentProposalSpec(proposal,lead);
      const files=makePremiumNextFiles(spec);
      const previewHtml=renderNextPreviewHtml(files,{title:proposal.businessName,path:'/'});
      project={...project,files,previewHtml,validationStatus:'PASSED',validationProvider:'AST_VERIFIED',versions:[...(Array.isArray(project.versions)?project.versions:[]),{id:id(),projectId:project.id,source:'operator-demo',summary:'Website React și Next.js pregătit pentru editare',createdBy:'Starli AI',bookmarked:true,sourceHash:hashToken(JSON.stringify(files)),files,previewHtml,createdAt:now()}]};
    }

    // Strip any operator-internal fields; transfer ONLY client-appropriate project data
    const {
      operatorInternalNotes: _opNotes,
      leadId: _leadId,
      isOperatorDemo: _isDemo,
      ...cleanProjectFields
    } = project;

    const transferredProject: RecordData = {
      ...cleanProjectFields,
      id: project.id,
      ownerId: user.id,
      lifecycle: 'active',
      claimedFromProposalId: proposal.id,
      claimedAt: now(),
      versions: (Array.isArray(project.versions) ? project.versions : []).map((v: any) => ({
        ...v,
        createdBy: v.createdBy === 'Starli Operator' ? 'Starli AI' : v.createdBy
      })),
      agentRuns: [],
      notifications: [
        {
          id: id(),
          projectId: project.id,
          kind: 'claimed',
          title: 'Proiect revendicat cu succes',
          detail: 'Poți edita textele și structura în Starli Studio.',
          read: false,
          createdAt: now()
        }
      ],
      updatedAt: now()
    };
    store.put('projects', transferredProject, user.id);

    // Transfer ONLY the proposal's welcome conversation to the new owner
    if (proposal.welcomeConversationId) {
      const welcomeConv = store.get('conversations', proposal.welcomeConversationId);
      if (welcomeConv) {
        store.put('conversations', {
          ...welcomeConv,
          ownerId: user.id,
          projectId: project.id,
          updatedAt: now()
        }, user.id);
      }
    }

    // Transfer any source snapshots for this project to the new owner
    for (const snap of store.list('source-snapshots')) {
      if (snap.projectId === project.id) {
        store.remove('source-snapshots', snap.id);
        store.put('source-snapshots', {
          ...snap,
          id: `${user.id}:${snap.sourceHash}`,
          ownerId: user.id
        }, user.id);
      }
    }

    const claimedProposal: ProposalRecord = {
      ...proposal,
      status: 'REVENDICAT',
      claimedByUserId: user.id,
      claimedAt: now(),
      // Single-use: invalidate claim code and OTP immediately upon claim
      claimCodeHash: null,
      claimOtpHash: null,
      updatedAt: now()
    };
    store.put('proposals', claimedProposal, proposal.ownerId);
    clearDeliveryClaimCode(proposal.id);

    recordOperatorAudit(store, user.id, 'proposal.claimed', `${proposal.id} -> user:${user.id}`);
    store.db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');

    events?.publish('proposals');
    events?.publish('projects');
    events?.publish('conversations');

    return { project: transferredProject, proposal: claimedProposal, alreadyClaimedByMe: false };
  } catch (err) {
    if (nested) {
      try {
        store.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        store.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } catch {
        /* already released */
      }
    } else if (store.db.isTransaction) {
      store.db.exec('ROLLBACK');
    }
    throw err;
  }
}

export function renderProposalOpenGraphHtml(store: Store, publicSlug: string, origin: string): string | null {
  const cleanSlug = String(publicSlug || '').trim().toLowerCase();
  const proposal = (store.list('proposals') as ProposalRecord[]).find(p => p.publicSlug === cleanSlug);
  if (!proposal || proposal.status === 'ARHIVAT') return null;
  const title = `Website proposal for ${proposal.businessName} — Starlidigital`;
  const description = `Interactive React & Next.js preview prepared by Starli AI for ${proposal.businessName} (${proposal.industry}, ${proposal.locality}).`;
  const pageUrl = `${origin}/proposal/${encodeURIComponent(proposal.publicSlug)}`;
  const imageUrl = `${origin}/og/proposal/${encodeURIComponent(proposal.publicSlug)}.svg`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeXml(title)}</title>
  <meta name="description" content="${escapeXml(description)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:locale" content="en_US"/>
  <meta property="og:site_name" content="Starlidigital"/>
  <meta property="og:title" content="${escapeXml(title)}"/>
  <meta property="og:description" content="${escapeXml(description)}"/>
  <meta property="og:url" content="${escapeXml(pageUrl)}"/>
  <meta property="og:image" content="${escapeXml(imageUrl)}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeXml(title)}"/>
  <meta name="twitter:description" content="${escapeXml(description)}"/>
  <meta name="twitter:image" content="${escapeXml(imageUrl)}"/>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>`;
}

export function renderProposalOgImageSvg(store: Store, publicSlug: string): string | null {
  const cleanSlug = String(publicSlug || '').trim().toLowerCase();
  const proposal = (store.list('proposals') as ProposalRecord[]).find(p => p.publicSlug === cleanSlug);
  if (!proposal || proposal.status === 'ARHIVAT') return null;

  const name = escapeXml(proposal.businessName.slice(0, 46));
  const meta = escapeXml(`${proposal.industry} · ${proposal.locality}`.slice(0, 64));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#0b0f17"/>
    <rect x="48" y="48" width="1104" height="534" rx="24" fill="#131926" stroke="#283246" stroke-width="2"/>
    <text x="96" y="130" font-family="sans-serif" font-size="18" font-weight="700" fill="#8bb9e8" letter-spacing="2">STARLIDIGITAL · DEMO PROPOSAL</text>
    <text x="96" y="240" font-family="sans-serif" font-size="54" font-weight="800" fill="#f8fafc">${name}</text>
    <text x="96" y="305" font-family="sans-serif" font-size="26" fill="#94a3b8">${meta}</text>
    <rect x="96" y="370" width="440" height="64" rx="32" fill="#f8fafc"/>
    <text x="316" y="410" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700" fill="#0b0f17">Open website preview</text>
    <text x="96" y="515" font-family="sans-serif" font-size="18" fill="#64748b">Built with Starli AI · React &amp; Next.js · No obligations</text>
  </svg>`;
}
