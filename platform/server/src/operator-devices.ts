import { randomBytes } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import type { WebSocket } from 'ws';
import { Store, id, now, type RecordData } from './store.js';
import { Events } from './events.js';
import { fail, hashToken, limit, type Context } from './security.js';
import { requireOperator, recordOperatorAudit, redactSecrets } from './operator-auth.js';
import {recordAdbSmsOutcome} from './messaging.js';
import {
  createOperatorJob,
  acquireJobLease,
  heartbeatOperatorJob,
  completeOperatorJob,
  approveOperatorJob,
  type OperatorJobRecord
} from './operator-jobs.js';

export type AdbDeviceInfo = {
  serial: string;
  state: 'device' | 'offline' | 'unauthorized' | 'unknown';
  model: string;
  canSendSms: boolean;
  limitation: string | null;
};

export type DeviceRecord = RecordData & {
  id: string;
  name: string;
  platform: string;
  version: string;
  status: 'ONLINE' | 'OFFLINE' | 'REVOKED';
  tokenHash: string;
  tokenPrefix: string;
  capabilities: string[];
  allowedRoots: string[];
  adbStatus: 'CONNECTED' | 'OFFLINE' | 'UNAUTHORIZED' | 'NONE';
  adbDevices: AdbDeviceInfo[];
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
  pairedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type DevicePairingTicket = RecordData & {
  id: string;
  label: string;
  codeHash: string;
  allowedRoots: string[];
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  deviceId: string | null;
  createdAt: string;
};

const activeSockets = new Map<string, WebSocket>();

const APPROVED_DEV_TOOLS = new Set(['git', 'node', 'npm', 'npx', 'tsc', 'adb']);

export function validateSafeDevicePath(candidatePath: string, allowedRoots: string[]): string {
  const raw = String(candidatePath || '').trim();
  if (!raw || raw.length > 500 || raw.includes('\0')) {
    fail('Calea fișierului sau directorului este invalidă.', 'BAD_USER_INPUT');
  }
  // Reject traversal segments, shell metacharacters, or UNC/device paths
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(raw) || /^\\\\/.test(raw) || /[<>|"?*;`$&]/.test(raw)) {
    fail('Calea conține secvențe de traversare sau caractere nepermise.', 'BAD_USER_INPUT');
  }
  const normalizedTarget = raw.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  if (!allowedRoots.length) {
    fail('Dispozitivul nu are directoare de lucru autorizate configurate.', 'FORBIDDEN');
  }
  const matched = allowedRoots.some(root => {
    const normRoot = String(root || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    if (!normRoot) return false;
    return normalizedTarget === normRoot || normalizedTarget.startsWith(normRoot + '\\');
  });
  if (!matched) {
    fail(`Calea „${raw}” se află în afara directoarelor de lucru permise pe dispozitiv.`, 'FORBIDDEN');
  }
  return raw;
}

export function validateStructuredCommandArgs(tool: string, args: string[]): { tool: string; args: string[] } {
  const cleanTool = String(tool || '').trim().toLowerCase();
  if (!APPROVED_DEV_TOOLS.has(cleanTool)) {
    fail(`Instrumentul „${tool}” nu se află pe lista instrumentelor de dezvoltare aprobate (${[...APPROVED_DEV_TOOLS].join(', ')}).`, 'FORBIDDEN');
  }
  if (!Array.isArray(args) || args.length > 32) {
    fail('Lista de argumente structurate este invalidă sau depășește limita.', 'BAD_USER_INPUT');
  }
  const validatedArgs = args.map(arg => {
    const s = String(arg ?? '');
    if (s.length > 1000 || s.includes('\0') || /[\r\n]/.test(s)) {
      fail('Un argument conține caractere de control nepermise.', 'BAD_USER_INPUT');
    }
    if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(s)) {
      fail('Argumentele nu pot conține traversare de directoare (..).', 'BAD_USER_INPUT');
    }
    // Block dangerous flags that evaluate arbitrary code in approved binaries
    if ((cleanTool === 'node' || cleanTool === 'npm' || cleanTool === 'npx') && /^(-e|--eval|-p|--print|--import|--require)$/i.test(s.trim())) {
      fail(`Argumentul „${s}” nu este permis pentru execuție neprivilegiată.`, 'FORBIDDEN');
    }
    return s;
  });
  return { tool: cleanTool, args: validatedArgs };
}

export function createDevicePairingCode(
  store: Store,
  ctx: Context,
  input: { label: string; allowedRoots?: string[]; ttlMinutes?: number }
): { pairingCode: string; ticket: DevicePairingTicket } {
  const { user } = requireOperator(ctx, 'DEVICES');
  const label = String(input.label || 'Windows Workstation').trim().slice(0, 120);
  if (label.length < 2) fail('Numele dispozitivului trebuie să aibă cel puțin 2 caractere.');
  const ttlMinutes = Math.min(Math.max(Number(input.ttlMinutes || 15), 2), 60);
  const allowedRoots = (input.allowedRoots && input.allowedRoots.length
    ? input.allowedRoots
    : ['C:\\Users\\Administrator\\Desktop\\starlidigital-ro']
  ).map(r => String(r).trim()).filter(Boolean);

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) part1 += alphabet[bytes[i] % alphabet.length];
  for (let i = 4; i < 8; i++) part2 += alphabet[bytes[i] % alphabet.length];
  const pairingCode = `PAIR-${part1}-${part2}`;

  const ticket: DevicePairingTicket = {
    id: id(),
    ownerId: user.id,
    label,
    codeHash: hashToken(pairingCode),
    allowedRoots,
    createdBy: user.id,
    expiresAt: new Date(Date.now() + ttlMinutes * 60000).toISOString(),
    usedAt: null,
    deviceId: null,
    createdAt: now()
  };

  store.put('device-pairings', ticket, user.id);
  recordOperatorAudit(store, user.id, 'operator.device.pairing_created', `${ticket.id} (${label})`);
  return { pairingCode, ticket };
}

export function completeDevicePairing(
  store: Store,
  events: Events | undefined,
  input: {
    pairingCode: string;
    deviceName?: string;
    platform?: string;
    version?: string;
    capabilities?: string[];
    allowedRoots?: string[];
    ip?: string;
  }
): { deviceToken: string; device: DeviceRecord } {
  limit('device-pair:' + (input.ip || 'local'), 8, 900000);
  const rawCode = String(input.pairingCode || '').trim().toUpperCase();
  if (!/^PAIR-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(rawCode)) {
    fail('Codul de asociere este invalid sau a expirat.', 'UNAUTHENTICATED');
  }
  const codeHash = hashToken(rawCode);
  const nested = store.db.isTransaction;
  store.db.exec(nested ? 'SAVEPOINT pair_device' : 'BEGIN IMMEDIATE');
  try {
    const ticket = (store.list('device-pairings') as DevicePairingTicket[]).find(
      t => t.codeHash === codeHash
    );
    if (!ticket || ticket.usedAt || Date.parse(ticket.expiresAt) <= Date.now()) {
      fail('Codul de asociere este invalid, a fost deja utilizat sau a expirat.', 'UNAUTHENTICATED');
    }
    const rawToken = 'starli_dev_' + randomBytes(32).toString('hex');
    const deviceId = id();
    const device: DeviceRecord = {
      id: deviceId,
      ownerId: ticket.createdBy,
      name: String(input.deviceName || ticket.label).trim().slice(0, 120),
      platform: String(input.platform || 'win32').trim().slice(0, 40),
      version: String(input.version || '0.1.0').trim().slice(0, 40),
      status: 'ONLINE',
      tokenHash: hashToken(rawToken),
      tokenPrefix: rawToken.slice(0, 17),
      capabilities: Array.isArray(input.capabilities)
        ? input.capabilities.map(c => String(c).slice(0, 60)).slice(0, 20)
        : ['fs.readWrite', 'dev.tools', 'adb.inventory', 'sms.adb'],
      allowedRoots:
        input.allowedRoots && input.allowedRoots.length
          ? input.allowedRoots.map(r => String(r).trim()).filter(Boolean)
          : ticket.allowedRoots,
      adbStatus: 'NONE',
      adbDevices: [],
      lastHeartbeatAt: now(),
      revokedAt: null,
      pairedBy: ticket.createdBy,
      createdAt: now(),
      updatedAt: now()
    };

    store.put('device-pairings', { ...ticket, usedAt: now(), deviceId }, ticket.createdBy);
    store.put('operator-devices', device, ticket.createdBy);
    recordOperatorAudit(store, ticket.createdBy, 'operator.device.paired', `${device.id} (${device.name})`);
    store.db.exec(nested ? 'RELEASE SAVEPOINT pair_device' : 'COMMIT');
    events?.publish('operator-devices');
    return { deviceToken: rawToken, device };
  } catch (err) {
    if (nested) {
      store.db.exec('ROLLBACK TO SAVEPOINT pair_device');
      store.db.exec('RELEASE SAVEPOINT pair_device');
    } else {
      store.db.exec('ROLLBACK');
    }
    throw err;
  }
}

export function authenticateDeviceToken(store: Store, rawToken?: string | null): DeviceRecord | null {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const trimmed = rawToken.trim().replace(/^Bearer\s+/i, '').trim();
  if (!trimmed.startsWith('starli_dev_') || trimmed.length < 30 || trimmed.length > 200) return null;
  const hashed = hashToken(trimmed);
  const device = (store.list('operator-devices') as DeviceRecord[]).find(d => d.tokenHash === hashed);
  if (!device || device.revokedAt || device.status === 'REVOKED') return null;
  return device;
}

export function recordDeviceHeartbeat(
  store: Store,
  events: Events | undefined,
  deviceToken: string,
  payload: {
    version?: string;
    capabilities?: string[];
    adbStatus?: 'CONNECTED' | 'OFFLINE' | 'UNAUTHORIZED' | 'NONE';
    adbDevices?: AdbDeviceInfo[];
  }
): { device: DeviceRecord; pendingJobs: OperatorJobRecord[] } {
  const device = authenticateDeviceToken(store, deviceToken);
  if (!device) {
    fail('Identitatea dispozitivului este invalidă sau a fost revocată.', 'UNAUTHENTICATED');
  }
  const adbDevices: AdbDeviceInfo[] = Array.isArray(payload.adbDevices)
    ? payload.adbDevices.slice(0, 10).map(d => ({
        serial: String(d.serial || 'unknown').slice(0, 80),
        state: (['device', 'offline', 'unauthorized'].includes(d.state) ? d.state : 'unknown') as AdbDeviceInfo['state'],
        model: String(d.model || 'Android').slice(0, 80),
        canSendSms: Boolean(d.canSendSms),
        limitation: d.limitation ? String(d.limitation).slice(0, 240) : null
      }))
    : device.adbDevices;

  const computedAdbStatus: DeviceRecord['adbStatus'] =
    payload.adbStatus ||
    (adbDevices.some(d => d.state === 'device')
      ? 'CONNECTED'
      : adbDevices.some(d => d.state === 'unauthorized')
      ? 'UNAUTHORIZED'
      : adbDevices.some(d => d.state === 'offline')
      ? 'OFFLINE'
      : 'NONE');

  const updated: DeviceRecord = {
    ...device,
    status: 'ONLINE',
    version: payload.version ? String(payload.version).slice(0, 40) : device.version,
    capabilities: Array.isArray(payload.capabilities)
      ? payload.capabilities.map(c => String(c).slice(0, 60)).slice(0, 20)
      : device.capabilities,
    adbStatus: computedAdbStatus,
    adbDevices,
    lastHeartbeatAt: now(),
    updatedAt: now()
  };

  store.put('operator-devices', updated, device.pairedBy);
  events?.publish('operator-devices');

  const pendingJobs = (store.list('operator-jobs') as OperatorJobRecord[])
    .filter(j => j.deviceId === device.id && j.status === 'QUEUED_DEVICE')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { device: updated, pendingJobs };
}

export function markDeviceOffline(store: Store, events: Events | undefined, deviceId: string): DeviceRecord | undefined {
  const existing = store.get('operator-devices', deviceId) as DeviceRecord | undefined;
  if (!existing || existing.status === 'REVOKED') return existing;
  const updated: DeviceRecord = {
    ...existing,
    status: 'OFFLINE',
    adbStatus: existing.adbStatus === 'CONNECTED' ? 'OFFLINE' : existing.adbStatus,
    updatedAt: now()
  };
  store.put('operator-devices', updated, existing.pairedBy);
  activeSockets.delete(deviceId);
  events?.publish('operator-devices');
  return updated;
}

export function revokeDevice(store: Store, events: Events | undefined, ctx: Context, deviceId: string): DeviceRecord {
  const { user } = requireOperator(ctx, 'DEVICES');
  const existing = store.get('operator-devices', deviceId) as DeviceRecord | undefined;
  if (!existing) fail('Dispozitivul nu există.', 'NOT_FOUND');
  const updated: DeviceRecord = {
    ...existing,
    status: 'REVOKED',
    revokedAt: existing.revokedAt || now(),
    updatedAt: now()
  };
  store.put('operator-devices', updated, existing.pairedBy);
  const ws = activeSockets.get(deviceId);
  if (ws) {
    try {
      ws.send(JSON.stringify({ type: 'REVOKED', reason: 'Dispozitivul a fost revocat de operator.' }));
      ws.close(4003, 'Device revoked');
    } catch {
      /* ignore */
    }
    activeSockets.delete(deviceId);
  }
  recordOperatorAudit(store, user.id, 'operator.device.revoked', `${deviceId} (${existing.name})`);
  events?.publish('operator-devices');
  return updated;
}

export function enqueueDeviceTask(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: {
    deviceId: string;
    kind: 'device.fs.read' | 'device.fs.write' | 'device.tool.exec' | 'device.adb.inventory' | 'device.sms.send' | 'device.powershell';
    args: Record<string, unknown>;
    idempotencyKey?: string;
  }
): OperatorJobRecord {
  const requiredPerm = input.kind === 'device.powershell' ? 'PRIVILEGED_POWERSHELL' : 'DEVICES';
  const { user } = requireOperator(ctx, requiredPerm);
  const device = store.get('operator-devices', input.deviceId) as DeviceRecord | undefined;
  if (!device) fail('Dispozitivul specificat nu există.', 'NOT_FOUND');
  if (device.status === 'REVOKED' || device.revokedAt) {
    fail('Dispozitivul este revocat și nu poate primi lucrări.', 'FORBIDDEN');
  }

  let validatedArgs: Record<string, unknown> = {};
  let requiresApproval = false;

  if (input.kind === 'device.fs.read') {
    const targetPath = validateSafeDevicePath(String(input.args.path || ''), device.allowedRoots);
    validatedArgs = { path: targetPath };
  } else if (input.kind === 'device.fs.write') {
    const targetPath = validateSafeDevicePath(String(input.args.path || ''), device.allowedRoots);
    const content = String(input.args.content ?? '');
    if (content.length > 250000) fail('Conținutul fișierului depășește limita permisă (250 KB).');
    validatedArgs = { path: targetPath, content };
  } else if (input.kind === 'device.tool.exec') {
    const cwd = validateSafeDevicePath(String(input.args.cwd || device.allowedRoots[0] || ''), device.allowedRoots);
    const { tool, args } = validateStructuredCommandArgs(
      String(input.args.tool || ''),
      Array.isArray(input.args.args) ? input.args.args.map(String) : []
    );
    validatedArgs = { cwd, tool, args };
  } else if (input.kind === 'device.adb.inventory') {
    validatedArgs = {};
  } else if (input.kind === 'device.sms.send') {
    const messageId = String(input.args.messageId || '').trim();
    const to = String(input.args.to || '').trim();
    const body = String(input.args.body || '').trim();
    if (!messageId || !to || !body) fail('Datele mesajului SMS sunt incomplete.');
    validatedArgs = { messageId, to, body, serial: input.args.serial ? String(input.args.serial) : null };
  } else if (input.kind === 'device.powershell') {
    const command = String(input.args.command || '').trim();
    if (!command || command.length > 4000) {
      fail('Comanda PowerShell privilegiată trebuie să aibă între 1 și 4000 de caractere.');
    }
    const cwd = validateSafeDevicePath(String(input.args.cwd || device.allowedRoots[0] || ''), device.allowedRoots);
    validatedArgs = { command, cwd };
    // Privileged PowerShell ALWAYS requires explicit single-execution operator approval!
    requiresApproval = true;
  } else {
    fail(`Capabilitatea de dispozitiv „${input.kind}” nu este recunoscută.`);
  }

  const { job } = createOperatorJob(store, events, {
    actorId: user.id,
    kind: input.kind,
    targetType: 'device',
    targetId: device.id,
    deviceId: device.id,
    idempotencyKey: input.idempotencyKey,
    args: validatedArgs,
    requiresApproval
  });

  if (job.status === 'QUEUED_DEVICE') {
    pushJobToDeviceSocket(device.id, job);
  }
  return job;
}

export function pushJobToDeviceSocket(deviceId: string, job: OperatorJobRecord): boolean {
  const ws = activeSockets.get(deviceId);
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(
      JSON.stringify({
        type: 'JOB_DISPATCH',
        job: {
          id: job.id,
          kind: job.kind,
          idempotencyKey: job.idempotencyKey,
          args: JSON.parse(job.argsJson || '{}'),
          timeoutMs: job.timeoutMs
        }
      })
    );
    return true;
  } catch {
    return false;
  }
}

export function reportDeviceJobOutcome(
  store: Store,
  events: Events | undefined,
  deviceToken: string,
  input: {
    jobId: string;
    leaseToken?: string;
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INCERT';
    output?: string;
    error?: string;
    exitCode?: number;
  }
): OperatorJobRecord {
  const device = authenticateDeviceToken(store, deviceToken);
  if (!device) fail('Identitatea dispozitivului este invalidă sau revocată.', 'UNAUTHENTICATED');

  const existing = store.get('operator-jobs', input.jobId) as OperatorJobRecord | undefined;
  if (!existing || existing.deviceId !== device.id) {
    fail('Lucrarea nu aparține acestui dispozitiv.', 'FORBIDDEN');
  }
  if (existing.status === 'AWAITING_APPROVAL') {
    fail('Această lucrare privilegiată nu a fost încă aprobată de operator.', 'FORBIDDEN');
  }

  if (input.status === 'RUNNING') {
    if (!['QUEUED_DEVICE', 'RUNNING'].includes(existing.status)) {
      fail('Lucrarea a fost oprită sau finalizată și nu mai poate fi executată.', 'FORBIDDEN');
    }
    if (existing.status === 'QUEUED_DEVICE') {
      const leased = acquireJobLease(store, events, existing.id, existing.timeoutMs);
      if (!leased) fail('Lucrarea nu mai poate fi preluată.');
      return leased.job;
    }
    if (input.leaseToken) {
      return heartbeatOperatorJob(store, events, existing.id, input.leaseToken, input.output, existing.timeoutMs);
    }
    return existing;
  }

  const completed=completeOperatorJob(store, events, existing.id, {
    status: input.status,
    output: input.output ? redactSecrets(input.output) : null,
    error: input.error ? redactSecrets(input.error) : null,
    exitCode: input.exitCode ?? null,
    leaseToken: input.leaseToken || null
  });
  if(existing.kind==='device.sms.send'){
    const args=JSON.parse(existing.argsJson||'{}');let receipt:any;try{receipt=JSON.parse(input.output||'{}').smsReceipt;}catch{}
    if(args.messageId&&store.get('outbound-messages',args.messageId))recordAdbSmsOutcome(store,events,{messageId:args.messageId,outcome:receipt?.state==='DELIVERED'?'DELIVERY_CONFIRMED':receipt?.state==='SENT'?'RADIO_ACCEPTED':receipt?.state==='FAILED_BEFORE_SEND'?'FAILED_BEFORE_SEND':'AMBIGUOUS',detail:receipt?.state?`Android SMS Bridge: ${receipt.state}.`:'Dispozitivul nu a furnizat o confirmare Android a expedierii.'});
  }
  return completed;
}

export function attachDeviceWebSocket(
  store: Store,
  events: Events,
  ws: WebSocket,
  deviceToken: string
): DeviceRecord | null {
  const device = authenticateDeviceToken(store, deviceToken);
  if (!device) {
    try {
      ws.close(4001, 'Unauthorized device');
    } catch {
      /* ignore */
    }
    return null;
  }

  activeSockets.set(device.id, ws);
  recordDeviceHeartbeat(store, events, deviceToken, {});

  ws.on('message', (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(String(raw));
      if (!authenticateDeviceToken(store, deviceToken)) {
        ws.close(4003, 'Device revoked');
        return;
      }
      if (msg.type === 'HEARTBEAT') {
        const { pendingJobs } = recordDeviceHeartbeat(store, events, deviceToken, {
          version: msg.version,
          capabilities: msg.capabilities,
          adbStatus: msg.adbStatus,
          adbDevices: msg.adbDevices
        });
        ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK', timestamp: now(), pendingJobs: pendingJobs.map(j => ({
          id: j.id,
          kind: j.kind,
          idempotencyKey: j.idempotencyKey,
          args: JSON.parse(j.argsJson || '{}'),
          timeoutMs: j.timeoutMs
          ,requiresApproval:j.requiresApproval,approvedBy:j.approvedBy,approvedAt:j.approvedAt
        })) }));
      } else if (msg.type === 'JOB_REPORT' && msg.jobId) {
        const updatedJob = reportDeviceJobOutcome(store, events, deviceToken, {
          jobId: String(msg.jobId),
          leaseToken: msg.leaseToken ? String(msg.leaseToken) : undefined,
          status: msg.status,
          output: msg.output,
          error: msg.error,
          exitCode: typeof msg.exitCode === 'number' ? msg.exitCode : undefined
        });
        ws.send(JSON.stringify({ type: 'JOB_REPORT_ACK', jobId: updatedJob.id, status: updatedJob.status, leaseToken: updatedJob.leaseToken }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'ERROR', message: err instanceof Error ? err.message : 'Eroare protocol dispozitiv.' }));
    }
  });

  ws.on('close', () => {
    if (activeSockets.get(device.id) === ws) {
      markDeviceOffline(store, events, device.id);
    }
  });

  return device;
}
