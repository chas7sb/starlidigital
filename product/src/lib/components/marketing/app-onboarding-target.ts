/**
 * Server-verified onboarding target adapter for src/routes/app/+page.svelte (Fixpass R1).
 * Activates the claimed company and exact native room (#doglove) after fresh server readback,
 * reauthorizes capabilities, and loads messages/drafts without resending the original prompt.
 */
import { Grokbot1JourneyClient, type NormalizedOwnerNavigationV1 } from './grokbot1-client';

const INTENT_ID_RE = /^[0-9a-f]{40}$/;

export interface AppOnboardingTargetResult {
  handled: boolean;
  activated: boolean;
  companyId: string | null;
  channelRoomId: string | null;
  bossDmRoomId: string | null;
  bossBotId: string | null;
  originalPromptProvenance: 'system';
  navigation: NormalizedOwnerNavigationV1 | null;
  error: string | null;
}

export function extractOnboardingIntentParam(href: string): { intentId: string | null; cleanedPath: string } {
  try {
    const url = new URL(href, 'https://starlidigital.ro');
    const raw = url.searchParams.get('onboardingIntent');
    if (!raw) {
      return { intentId: null, cleanedPath: url.pathname + url.search + url.hash };
    }
    url.searchParams.delete('onboardingIntent');
    const intentId = INTENT_ID_RE.test(raw) ? raw : null;
    return { intentId, cleanedPath: url.pathname + url.search + url.hash };
  } catch {
    return { intentId: null, cleanedPath: '/app' };
  }
}

export async function resolveVerifiedAppOnboardingTarget(opts: {
  intentId: string;
  companies: { id: string; name: string }[];
  getBearerToken: () => string | null;
  fetcher?: typeof fetch;
  activateCompany: (company: { id: string; name: string }) => Promise<void>;
  verifyCompanyAuthority: (companyId: string) => Promise<boolean>;
  openVerifiedRoom: (companyId: string, channelRoomId: string) => Promise<boolean>;
}): Promise<AppOnboardingTargetResult> {
  if (!INTENT_ID_RE.test(opts.intentId)) {
    return {
      handled: true,
      activated: false,
      companyId: null,
      channelRoomId: null,
      bossDmRoomId: null,
      bossBotId: null,
      originalPromptProvenance: 'system',
      navigation: null,
      error: 'Invalid onboarding intent identifier.',
    };
  }

  const client = new Grokbot1JourneyClient({
    fetcher: opts.fetcher,
    getBearerToken: opts.getBearerToken,
  });

  const navRes = await client.fetchOwnerNavigation(opts.intentId);
  if (navRes.ok === false) {
    return {
      handled: true,
      activated: false,
      companyId: null,
      channelRoomId: null,
      bossDmRoomId: null,
      bossBotId: null,
      originalPromptProvenance: 'system',
      navigation: null,
      error: `Onboarding navigation verification failed (${(navRes as { ok: false; error: { code: string } }).error.code}).`,
    };
  }

  const nav = navRes.data;
  if (nav.status !== 'READY' || !nav.companyId || !nav.channelRoomId) {
    return {
      handled: true,
      activated: false,
      companyId: nav.companyId,
      channelRoomId: nav.channelRoomId,
      bossDmRoomId: nav.bossDmRoomId,
      bossBotId: nav.bossBotId,
      originalPromptProvenance: 'system',
      navigation: nav,
      error: nav.reason,
    };
  }

  const targetCompany = opts.companies.find((c) => c.id === nav.companyId);
  if (!targetCompany) {
    return {
      handled: true,
      activated: false,
      companyId: nav.companyId,
      channelRoomId: nav.channelRoomId,
      bossDmRoomId: nav.bossDmRoomId,
      bossBotId: nav.bossBotId,
      originalPromptProvenance: 'system',
      navigation: nav,
      error: 'Claimed company is not present in your verified company memberships.',
    };
  }

  // Activate the exact claimed company rather than falling back to StarliDigital/list[0]
  await opts.activateCompany(targetCompany);

  // Reauthorize company authority after activation
  const authorized = await opts.verifyCompanyAuthority(targetCompany.id);
  if (!authorized) {
    return {
      handled: true,
      activated: false,
      companyId: targetCompany.id,
      channelRoomId: null,
      bossDmRoomId: null,
      bossBotId: null,
      originalPromptProvenance: 'system',
      navigation: nav,
      error: 'Company authority re-verification failed after activation.',
    };
  }

  // Open the exact verified native room (#doglove) and load canonical messages without resending original prompt
  const roomOpened = await opts.openVerifiedRoom(targetCompany.id, nav.channelRoomId);
  if (!roomOpened) {
    return {
      handled: true,
      activated: false,
      companyId: targetCompany.id,
      channelRoomId: nav.channelRoomId,
      bossDmRoomId: nav.bossDmRoomId,
      bossBotId: nav.bossBotId,
      originalPromptProvenance: 'system',
      navigation: nav,
      error: 'Verified target room could not be opened after company activation.',
    };
  }

  return {
    handled: true,
    activated: true,
    companyId: targetCompany.id,
    channelRoomId: nav.channelRoomId,
    bossDmRoomId: nav.bossDmRoomId,
    bossBotId: nav.bossBotId,
    originalPromptProvenance: 'system',
    navigation: nav,
    error: null,
  };
}
