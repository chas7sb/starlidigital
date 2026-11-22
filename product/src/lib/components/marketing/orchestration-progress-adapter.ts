/**
 * Named adapter consuming Gemini1's authoritative orchestration progress & awaited Stop API:
 *   GET  /api/v1/starli/orchestration/graphs/:graphId/progress
 *   POST /api/v1/starli/orchestration/graphs/:graphId/stop
 *
 * Security invariants:
 * - Browser props and model text NEVER establish authority or verified worker success.
 * - Every progress response is strictly validated through the 12-case validateWorkerProgressEnvelope.
 * - Stop preserves STOP_PENDING (HTTP 202 or confirmedStopped !== true) distinct from confirmed STOPPED (HTTP 200 + confirmedStopped === true).
 * - Auth denials (401/403) fail closed to REVOKED; transport/5xx errors fail closed to HOLD_UNCERTAIN.
 */
import {
  validateWorkerProgressEnvelope,
  type WorkerExecutionItemV1,
  type ExpectedWorkerContextV1,
  type WorkerGraphSummary,
} from './worker-task-progress.ts';

export interface AuthoritativeProgressEnvelope {
  expectedContext: Partial<ExpectedWorkerContextV1>;
  items: WorkerExecutionItemV1[];
}

export interface ProgressFetchParams {
  baseUrl?: string;
  graphId: string;
  authToken: string;
  expectedCompanyId?: string;
  nowMs?: number;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

export interface ProgressAdapterResult {
  ok: boolean;
  httpStatus: number;
  envelope: AuthoritativeProgressEnvelope | null;
  summary: WorkerGraphSummary;
  error: string | null;
}

export interface StopRequestParams {
  baseUrl?: string;
  graphId: string;
  authToken: string;
  reason?: string;
  nowMs?: number;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

export interface StopAdapterResult {
  ok: boolean;
  httpStatus: number;
  disposition: 'STOPPED' | 'STOP_PENDING' | 'ALREADY_COMPLETED' | 'REVOKED' | 'HOLD_UNCERTAIN';
  confirmedStopped: boolean;
  envelope: AuthoritativeProgressEnvelope | null;
  summary: WorkerGraphSummary;
  error: string | null;
}

function makeFailClosedSummary(
  phase: 'REVOKED' | 'HOLD_UNCERTAIN' | 'STOP_PENDING',
  bannerText: string,
): WorkerGraphSummary {
  return {
    phase,
    companyId: null,
    projectId: null,
    sourceMessageId: null,
    items: [],
    rejectedCount: 0,
    bannerText,
  };
}

function normalizeBase(baseUrl?: string): string {
  if (!baseUrl) return '';
  return baseUrl.replace(/\/+$/, '');
}

export async function fetchAuthoritativeProgress(
  params: ProgressFetchParams,
): Promise<ProgressAdapterResult> {
  const fetcher = params.fetcher ?? fetch;
  const graphId = params.graphId.trim();
  if (!graphId || !params.authToken) {
    return {
      ok: false,
      httpStatus: 401,
      envelope: null,
      summary: makeFailClosedSummary('REVOKED', 'Authenticated session and canonical graphId are required.'),
      error: 'MISSING_AUTH_OR_GRAPH_ID',
    };
  }

  const url = `${normalizeBase(params.baseUrl)}/api/v1/starli/orchestration/graphs/${encodeURIComponent(graphId)}/progress`;
  let res: Response;
  try {
    res = await fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.authToken}`,
        Accept: 'application/json',
      },
      signal: params.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error reading orchestration progress';
    return {
      ok: false,
      httpStatus: 0,
      envelope: null,
      summary: makeFailClosedSummary('HOLD_UNCERTAIN', 'Unable to verify worker progress from authoritative server.'),
      error: msg,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      httpStatus: res.status,
      envelope: null,
      summary: makeFailClosedSummary('REVOKED', 'Orchestration access revoked or unauthorized.'),
      error: `HTTP_${res.status}`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      httpStatus: res.status,
      envelope: null,
      summary: makeFailClosedSummary('HOLD_UNCERTAIN', `Authoritative progress unavailable (HTTP ${res.status}).`),
      error: `HTTP_${res.status}`,
    };
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    return {
      ok: false,
      httpStatus: res.status,
      envelope: null,
      summary: makeFailClosedSummary('HOLD_UNCERTAIN', 'Invalid JSON from authoritative progress server.'),
      error: 'INVALID_JSON',
    };
  }

  const expectedContext: Partial<ExpectedWorkerContextV1> | undefined = data?.expectedContext;
  const items: WorkerExecutionItemV1[] | null = Array.isArray(data?.items) ? data.items : null;
  if (!expectedContext || !items) {
    return {
      ok: false,
      httpStatus: res.status,
      envelope: null,
      summary: makeFailClosedSummary('HOLD_UNCERTAIN', 'Incomplete authoritative progress envelope.'),
      error: 'MALFORMED_ENVELOPE',
    };
  }

  if (params.expectedCompanyId && expectedContext.companyId !== params.expectedCompanyId) {
    return {
      ok: false,
      httpStatus: 403,
      envelope: null,
      summary: makeFailClosedSummary('REVOKED', 'Progress envelope company mismatch blocked.'),
      error: 'COMPANY_MISMATCH',
    };
  }

  const ctxWithClock: Partial<ExpectedWorkerContextV1> =
    typeof params.nowMs === 'number' ? { ...expectedContext, nowMs: params.nowMs } : expectedContext;
  const summary = validateWorkerProgressEnvelope(items, ctxWithClock);
  return {
    ok: true,
    httpStatus: res.status,
    envelope: { expectedContext: ctxWithClock, items },
    summary,
    error: null,
  };
}

export async function requestAuthoritativeStop(
  params: StopRequestParams,
): Promise<StopAdapterResult> {
  const fetcher = params.fetcher ?? fetch;
  const graphId = params.graphId.trim();
  if (!graphId || !params.authToken) {
    return {
      ok: false,
      httpStatus: 401,
      disposition: 'REVOKED',
      confirmedStopped: false,
      envelope: null,
      summary: makeFailClosedSummary('REVOKED', 'Authenticated session and canonical graphId are required to stop.'),
      error: 'MISSING_AUTH_OR_GRAPH_ID',
    };
  }

  const url = `${normalizeBase(params.baseUrl)}/api/v1/starli/orchestration/graphs/${encodeURIComponent(graphId)}/stop`;
  let res: Response;
  try {
    // Never invent arbitrary body.runId; Gemini1's canonical graph -> machineryRunId mapping owns identity.
    res = await fetcher(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.authToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ reason: params.reason ?? 'user_requested_stop' }),
      signal: params.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error requesting stop';
    return {
      ok: false,
      httpStatus: 0,
      disposition: 'HOLD_UNCERTAIN',
      confirmedStopped: false,
      envelope: null,
      summary: makeFailClosedSummary('HOLD_UNCERTAIN', 'Stop request could not reach authoritative server.'),
      error: msg,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      httpStatus: res.status,
      disposition: 'REVOKED',
      confirmedStopped: false,
      envelope: null,
      summary: makeFailClosedSummary('REVOKED', 'Stop denied: session or company authority revoked.'),
      error: `HTTP_${res.status}`,
    };
  }

  if (res.status !== 200 && res.status !== 202) {
    return {
      ok: false,
      httpStatus: res.status,
      disposition: 'HOLD_UNCERTAIN',
      confirmedStopped: false,
      envelope: null,
      summary: makeFailClosedSummary('HOLD_UNCERTAIN', `Stop outcome uncertain (HTTP ${res.status}).`),
      error: `HTTP_${res.status}`,
    };
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    return {
      ok: false,
      httpStatus: res.status,
      disposition: 'HOLD_UNCERTAIN',
      confirmedStopped: false,
      envelope: null,
      summary: makeFailClosedSummary('HOLD_UNCERTAIN', 'Invalid JSON in stop response.'),
      error: 'INVALID_JSON',
    };
  }

  if(res.status===200&&data?.graphId===graphId&&data?.outcome==='ALREADY_COMPLETED'&&
    data?.confirmedQuiescent===true&&data?.confirmedStopped===false&&
    data?.signalRequested===null&&data?.generatedAppTouched===false){
    return {ok:true,httpStatus:200,disposition:'ALREADY_COMPLETED',confirmedStopped:false,envelope:null,
      summary:makeFailClosedSummary('HOLD_UNCERTAIN','Work already completed; no running worker remains. No cancellation was needed.'),error:null};
  }
  const confirmedStopped = res.status === 200 && data?.confirmedStopped === true;
  const disposition: 'STOPPED' | 'STOP_PENDING' = confirmedStopped ? 'STOPPED' : 'STOP_PENDING';

  const progressData = data?.progress;
  let envelope: AuthoritativeProgressEnvelope | null = null;
  let summary: WorkerGraphSummary;

  if (progressData?.expectedContext && Array.isArray(progressData?.items)) {
    const ctxWithClock: Partial<ExpectedWorkerContextV1> =
      typeof params.nowMs === 'number'
        ? { ...progressData.expectedContext, nowMs: params.nowMs }
        : progressData.expectedContext;
    envelope = { expectedContext: ctxWithClock, items: progressData.items };
    summary = validateWorkerProgressEnvelope(progressData.items, ctxWithClock);
    if (!confirmedStopped && summary.phase === 'STOPPED') {
      summary = {
        ...summary,
        phase: 'STOP_PENDING',
        bannerText: 'Stop requested ? awaiting confirmed server/runtime cancellation.',
      };
    }
  } else {
    summary = makeFailClosedSummary(
      confirmedStopped ? 'HOLD_UNCERTAIN' : 'STOP_PENDING',
      confirmedStopped
        ? 'Stop confirmed by server; awaiting refreshed progress envelope.'
        : 'Stop requested ? awaiting confirmed server/runtime cancellation.',
    );
  }

  return {
    ok: true,
    httpStatus: res.status,
    disposition,
    confirmedStopped,
    envelope,
    summary,
    error: null,
  };
}
