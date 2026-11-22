/**
 * StarliDigital R6 Orchestration Progress & Stop HTTP API Adapter
 * Task: GGB1-GEMINI1-ORCHESTRATION-R6 (closes R6-API-ACTOR & R6-API-RUN)
 *
 * Security invariants:
 * 1. Uses exact MachineryRunActor contract { userId, workspaceTenantId, role } from trusted session.
 *    NEVER fabricates "operator" or "owner" defaults.
 * 2. Enforces actual MachineryRunService authorization (machineryService.getRun / machineryDriver.inspect)
 *    using the canonical actor before returning progress or executing Stop.
 * 3. Derives Stop target strictly from persisted graph.machinery_run_id (distinct from native parent_run_id).
 *    Rejects any conflicting body.runId / body.machineryRunId with 409 RUN_ID_MISMATCH before driver calls.
 */

const PROGRESS_RE = /^\/api\/v1\/starli\/orchestration\/graphs\/([^/]+)\/progress$/;
const STOP_RE = /^\/api\/v1\/starli\/orchestration\/graphs\/([^/]+)\/stop$/;
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body, 'utf8'),
  });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(Object.assign(new Error('JSON body must be an object'), { code: 'INVALID_JSON' }));
          return;
        }
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('Malformed JSON body'), { code: 'INVALID_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function buildCanonicalMachineryActor(resolved) {
  if (!resolved || typeof resolved !== 'object') {
    return { error: { status: 401, code: 'UNAUTHORIZED', detail: 'Authenticated session actor required.' } };
  }
  const userId = typeof resolved.userId === 'string' ? resolved.userId.trim() : '';
  const workspaceTenantId =
    typeof resolved.workspaceTenantId === 'string' ? resolved.workspaceTenantId.trim() : '';
  const companyId = typeof resolved.companyId === 'string' ? resolved.companyId.trim() : '';
  const role = typeof resolved.role === 'string' && resolved.role.trim() ? resolved.role.trim() : undefined;

  if (!userId || !workspaceTenantId) {
    return {
      error: {
        status: 401,
        code: 'UNAUTHORIZED',
        detail: 'Trusted session must provide non-empty userId and workspaceTenantId (no defaults permitted).',
      },
    };
  }
  if (companyId && companyId !== workspaceTenantId) {
    return {
      error: {
        status: 403,
        code: 'TENANT_MISMATCH',
        detail: 'Session companyId disagrees with workspaceTenantId.',
      },
    };
  }

  const actor = { userId, workspaceTenantId };
  if (role !== undefined) actor.role = role;
  return { actor };
}

export function createOrchestrationApiHandler({
  store,
  machineryDriver = null,
  machineryService = null,
  resolveActor,
}) {
  if (!store || typeof store.getGraph !== 'function' || typeof store.buildAuthoritativeProgressEnvelope !== 'function') {
    throw new Error('createOrchestrationApiHandler requires a DurableOrchestrationStore instance');
  }
  if (typeof resolveActor !== 'function') {
    throw new Error('createOrchestrationApiHandler requires a resolveActor(req) function');
  }

  return async function handleOrchestrationRequest(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const pathname = urlObj.pathname;

    const progressMatch = method === 'GET' ? pathname.match(PROGRESS_RE) : null;
    const stopMatch = method === 'POST' ? pathname.match(STOP_RE) : null;
    if (!progressMatch && !stopMatch) {
      return false;
    }

    const graphId = decodeURIComponent((progressMatch || stopMatch)[1]);

    let resolved;
    try {
      resolved = await Promise.resolve(resolveActor(req));
    } catch {
      sendJson(res, 401, { ok: false, errorCode: 'UNAUTHORIZED', detail: 'Actor resolution failed.' });
      return true;
    }

    const actorCheck = buildCanonicalMachineryActor(resolved);
    if (actorCheck.error) {
      sendJson(res, actorCheck.error.status, {
        ok: false,
        errorCode: actorCheck.error.code,
        detail: actorCheck.error.detail,
      });
      return true;
    }
    const driverActor = actorCheck.actor;

    const graph = store.getGraph(graphId);
    if (!graph) {
      sendJson(res, 404, { ok: false, errorCode: 'GRAPH_NOT_FOUND', detail: `Unknown graph: ${graphId}` });
      return true;
    }

    if (String(driverActor.workspaceTenantId) !== String(graph.company_id)) {
      sendJson(res, 403, {
        ok: false,
        errorCode: 'TENANT_MISMATCH',
        detail: 'Authenticated workspace tenant does not own the requested orchestration graph.',
      });
      return true;
    }

    const machineryRunId = typeof graph.machinery_run_id === 'string' ? graph.machinery_run_id.trim() : '';
    if (!machineryRunId) {
      sendJson(res, 409, {
        ok: false,
        errorCode: 'UNBOUND_MACHINERY_RUN',
        detail: 'Graph has no canonical machineryRunId binding.',
      });
      return true;
    }

    // Enforce actual MachineryRunService authorization (not just string comparison)
    if (machineryService && typeof machineryService.getRun === 'function') {
      try {
        const run = await machineryService.getRun(driverActor, machineryRunId);
        if (!run || run.tenantId !== graph.company_id) {
          sendJson(res, 403, {
            ok: false,
            errorCode: 'MACHINERY_AUTH_DENIED',
            detail: 'Canonical MachineryRunService denied access to bound run.',
          });
          return true;
        }
      } catch (err) {
        sendJson(res, 403, {
          ok: false,
          errorCode: 'MACHINERY_AUTH_DENIED',
          detail: err?.message || 'Canonical MachineryRunService denied access.',
        });
        return true;
      }
    } else if (machineryDriver && typeof machineryDriver.inspect === 'function') {
      try {
        const inspection = await machineryDriver.inspect(driverActor, machineryRunId);
        if (!inspection) throw new Error("Canonical inspection returned no authorized run");
      } catch (err) {
        sendJson(res, 403, {
          ok: false,
          errorCode: 'MACHINERY_AUTH_DENIED',
          detail: err?.message || 'Canonical MachineryRunExecutionDriver denied access.',
        });
        return true;
      }
    }

    if (!(machineryService && typeof machineryService.getRun === 'function') &&
        !(machineryDriver && typeof machineryDriver.inspect === 'function')) {
      sendJson(res, 503, { ok: false, errorCode: 'MACHINERY_AUTHORITY_UNAVAILABLE' });
      return true;
    }

    if (progressMatch) {
      const progress = store.buildAuthoritativeProgressEnvelope(graphId);
      const handoffs = typeof store.listStopHandoffs === 'function' ? store.listStopHandoffs(graphId) : [];
      const latestHandoff = handoffs[0] ?? null;
      sendJson(res, 200, {
        ok: true,
        graphId,
        machineryRunId,
        graphState: graph.graph_state,
        expectedContext: progress.expectedContext,
        items: progress.items,
        stopState: latestHandoff?.stopState ?? null,
        computeStopHandoff: latestHandoff,
      });
      return true;
    }

    // POST /stop
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const status = err?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
      sendJson(res, status, { ok: false, errorCode: err?.code || 'INVALID_BODY', detail: err?.message || 'Invalid body' });
      return true;
    }

    // R6-API-RUN: Reject any conflicting body.runId or body.machineryRunId BEFORE calling driver
    for (const key of ['runId', 'machineryRunId']) {
      if (body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== '') {
        if (String(body[key]).trim() !== machineryRunId) {
          sendJson(res, 409, {
            ok: false,
            errorCode: 'RUN_ID_MISMATCH',
            detail: `Request body ${key} does not match canonical bound machineryRunId for graph ${graphId}.`,
          });
          return true;
        }
      }
    }

    if (!machineryDriver || typeof machineryDriver.stop !== 'function') {
      sendJson(res, 503, {
        ok: false,
        errorCode: 'MACHINERY_DRIVER_UNAVAILABLE',
        detail: 'No patched MachineryRunExecutionDriver is bound for Stop.',
      });
      return true;
    }

    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 240)
        : 'Stopped by authenticated user';

    try {
      const result = await machineryDriver.stop(driverActor, machineryRunId, reason);
      const progress = store.buildAuthoritativeProgressEnvelope(graphId);
      const handoffs = typeof store.listStopHandoffs === 'function' ? store.listStopHandoffs(graphId) : [];
      const latestHandoff = result?.computeStopHandoff ?? handoffs[0] ?? null;
      const confirmedStopped =
        result?.confirmedStopped === true &&
        result?.disposition === 'TERMINAL' &&
        result?.disposition !== 'STOP_PENDING' &&
        result?.disposition !== 'UNCERTAIN';
      const statusCode = confirmedStopped ? 200 : 202;

      sendJson(res, statusCode, {
        ok: true,
        graphId,
        machineryRunId,
        disposition: result?.disposition || (confirmedStopped ? 'TERMINAL' : 'STOP_PENDING'),
        confirmedStopped,
        detail: result?.detail || '',
        stopOutcomes: result?.stopOutcomes || [],
        computeStopHandoff: latestHandoff,
        progress,
      });
      return true;
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        errorCode: 'STOP_EXECUTION_FAILED',
        detail: err?.message || 'Unexpected error while awaiting Stop.',
      });
      return true;
    }
  };
}
