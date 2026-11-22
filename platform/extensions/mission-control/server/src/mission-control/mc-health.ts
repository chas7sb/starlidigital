import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { AgentPrincipal } from './lcg1-agent-registry.js';

/** Read-only Mission Control health. Reuses the existing SQLite state; never writes, never returns identifiers,
 * tokens, hashes or device/session ids. Anything not provable from state or a host probe is UNKNOWN.
 * A healthy backend/staging HTTP 200 and WSS delivery ACKs are NOT readiness or execution proof. */
export type Tri3<A extends string, B extends string> = A | B | 'UNKNOWN';
export type McHealth = {
  backend: Tri3<'UP', 'DOWN'>;
  wss: Tri3<'CONNECTED', 'DISCONNECTED'>;
  pairedDevices: number | null;
  activeAgents: number | null;
  commandDispatch: Tri3<'READY', 'BLOCKED'>;
  receiptVerification: Tri3<'READY', 'BLOCKED'>;
  stopState: Tri3<'ACTIVE', 'STOPPED'>;
  productionReady: boolean;
  blockers: string[];
};
/** Host-supplied runtime probes. Every probe is optional; absent or throwing => UNKNOWN. */
export type McHealthProbes = {
  backend?: () => 'UP' | 'DOWN';
  /** Number of currently connected authenticated bridge sockets for this tenant. */
  wssConnections?: (tenantId: string) => number;
  /** Live-dispatch gate: READY only after security + operator-consent gates passed. */
  commandDispatch?: (tenantId: string) => 'READY' | 'BLOCKED';
  /** READY only when verified-submission receipts (not WSS ACK / COPY_MANUALLY) are durably proven. */
  receiptVerification?: (tenantId: string) => 'READY' | 'BLOCKED';
  /** True only when independent security + acceptance GO are recorded for the running immutable SHA. */
  releaseGatesGo?: () => boolean;
};

function probe<T>(fn: (() => T) | undefined): T | undefined {
  if (!fn) return undefined;
  try { return fn(); } catch { return undefined; }
}
function hasTable(db: DatabaseSync, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function count(db: DatabaseSync, table: string, sql: string, ...args: (string | number)[]): number | null {
  try { if (!hasTable(db, table)) return null; return Number((db.prepare(sql).get(...args) as { n: number }).n); } catch { return null; }
}

export function getMissionControlHealth(db: DatabaseSync, tenantId: string, probes: McHealthProbes = {}, now: () => number = Date.now): McHealth {
  const blockers: string[] = [];
  const backend = probe(probes.backend) ?? 'UNKNOWN';
  const conns = probe(() => probes.wssConnections?.(tenantId));
  const wss: McHealth['wss'] = typeof conns !== 'number' ? 'UNKNOWN' : conns > 0 ? 'CONNECTED' : 'DISCONNECTED';

  let stopState: McHealth['stopState'] = 'UNKNOWN';
  const stopped = count(db, 'mc_tenant_stop', 'SELECT COUNT(*) n FROM mc_tenant_stop WHERE tenant=?', tenantId);
  if (stopped !== null) stopState = stopped > 0 ? 'STOPPED' : 'ACTIVE';

  // Paired = unrevoked, unexpired grants (distinct devices). Revoked/expired devices are never counted.
  const pairedDevices = stopState === 'STOPPED' ? 0 : count(db, 'mc_bridge_device_grants',
    'SELECT COUNT(DISTINCT device_id) n FROM mc_bridge_device_grants WHERE tenant=? AND revoked_at IS NULL AND expires_at>?', tenantId, now());
  // Active = WORKING/WAITING/REVIEW. IDLE, BLOCKED, DONE and STOPPED agents are not active; a stopped tenant has none.
  const activeAgents = stopState === 'STOPPED' ? 0 : count(db, 'lcg1_roster',
    "SELECT COUNT(*) n FROM lcg1_roster WHERE tenantId=? AND status IN ('WORKING','WAITING','REVIEW')", tenantId);

  const gate = probe(() => probes.commandDispatch?.(tenantId));
  let commandDispatch: McHealth['commandDispatch'] = gate ?? 'UNKNOWN';
  if (stopState === 'STOPPED' || wss === 'DISCONNECTED' || pairedDevices === 0) commandDispatch = 'BLOCKED';
  else if (commandDispatch === 'READY' && (stopState !== 'ACTIVE' || wss !== 'CONNECTED' || pairedDevices === null)) commandDispatch = 'UNKNOWN';

  const receiptVerification: McHealth['receiptVerification'] = probe(() => probes.receiptVerification?.(tenantId)) ?? 'UNKNOWN';
  const gatesGo = probe(probes.releaseGatesGo) === true;

  if (backend !== 'UP') blockers.push(backend === 'DOWN' ? 'Backend is down' : 'Backend status unknown');
  if (wss !== 'CONNECTED') blockers.push(wss === 'DISCONNECTED' ? 'No connected authenticated WSS bridge' : 'WSS status unknown');
  if (pairedDevices === null) blockers.push('Paired device state unavailable');
  else if (pairedDevices === 0) blockers.push('No paired, unexpired Chrome device');
  if (stopState === 'STOPPED') blockers.push('Tenant STOP is active');
  else if (stopState === 'UNKNOWN') blockers.push('STOP state unknown');
  if (commandDispatch !== 'READY') blockers.push(commandDispatch === 'BLOCKED' ? 'Live command dispatch is not enabled' : 'Command dispatch readiness unknown');
  if (receiptVerification !== 'READY') blockers.push(receiptVerification === 'BLOCKED' ? 'Verified-submission receipts are not ready' : 'Receipt verification unknown; WSS ACK is not execution proof');
  if (!gatesGo) blockers.push('Independent security and acceptance GO not recorded for the running SHA');

  return { backend, wss, pairedDevices, activeAgents, commandDispatch, receiptVerification, stopState,
    productionReady: blockers.length === 0, blockers };
}

type ToolServer = { tool: (name: string, description: string, schema: any, handler: (args: any) => Promise<any> | any) => unknown };
/** Read-only tool for the EXISTING MCP server. Tenant comes only from the host-authenticated operator principal. */
export function registerMissionControlHealthTool(server: ToolServer, deps: { db: DatabaseSync; probes?: McHealthProbes; principal: () => AgentPrincipal | undefined; isOperator: (p: AgentPrincipal) => boolean }) {
  server.tool('mission_control_get_health', 'Read-only Mission Control health; staging HTTP 200 and WSS ACK are not production readiness or execution proof.', {}, async (_a: z.infer<z.ZodObject<{}>>) => {
    try {
      const p = deps.principal();
      if (!p || p.operator !== true || deps.isOperator(p) !== true) throw Error('HEALTH_OPERATOR_REQUIRED');
      return { content: [{ type: 'text' as const, text: JSON.stringify(getMissionControlHealth(deps.db, p.tenantId, deps.probes)) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : 'HEALTH_ERROR' }) }] };
    }
  });
}
