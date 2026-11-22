import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, hostname, platform as osPlatform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import WebSocket from 'ws';
import {SMS_BRIDGE_COMPONENT,bridgeCall,sendSmsThroughBridge} from './sms-bridge.js';

export const DEVICE_VERSION = '0.1.2';
export const MAX_OUTPUT_BYTES = 32_768;
export const DEFAULT_TIMEOUT_MS = 30_000;

export type AdbDeviceEntry = {
  serial: string;
  state: 'device' | 'offline' | 'unauthorized' | 'unknown';
  model?: string;
  smsCapable?: boolean;
  canSendSms?: boolean;
};

export type ExecutedJobRecord = {
  jobId: string;
  idempotencyKey?: string;
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'INCERT';
  output: string;
  error?: string;
  exitCode: number | null;
  executedAt: string;
};

export type DeviceState = {
  apiUrl: string;
  deviceId?: string;
  deviceName?: string;
  deviceToken?: string;
  allowedRoots: string[];
  executedJobs: Record<string, ExecutedJobRecord>;
  updatedAt?: string;
};

export function defaultDeviceStatePath(): string {
  if (process.env.STARLI_DEVICE_STATE) return process.env.STARLI_DEVICE_STATE;
  return join(homedir(), '.starli-device', 'state.json');
}

export function loadDeviceState(statePath = defaultDeviceStatePath()): DeviceState {
  const apiUrl = (process.env.STARLI_API_URL || 'https://api.starlidigital.ro').replace(/\/$/, '');
  if (!existsSync(statePath)) {
    return {
      apiUrl,
      allowedRoots: [process.cwd()],
      executedJobs: {}
    };
  }
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as Partial<DeviceState>;
    return {
      apiUrl: (process.env.STARLI_API_URL || raw.apiUrl || apiUrl).replace(/\/$/, ''),
      deviceId: raw.deviceId,
      deviceName: raw.deviceName,
      deviceToken: process.env.STARLI_DEVICE_TOKEN || raw.deviceToken,
      allowedRoots: Array.isArray(raw.allowedRoots) && raw.allowedRoots.length ? raw.allowedRoots : [process.cwd()],
      executedJobs: raw.executedJobs && typeof raw.executedJobs === 'object' ? raw.executedJobs : {},
      updatedAt: raw.updatedAt
    };
  } catch {
    return {
      apiUrl,
      allowedRoots: [process.cwd()],
      executedJobs: {}
    };
  }
}

export function saveDeviceState(state: DeviceState, statePath = defaultDeviceStatePath()): void {
  mkdirSync(dirname(statePath), { recursive: true });
  // Keep at most 300 executed job deduplication entries
  const entries = Object.entries(state.executedJobs || {});
  const trimmedEntries = entries.slice(-300);
  const next: DeviceState = {
    ...state,
    executedJobs: Object.fromEntries(trimmedEntries),
    updatedAt: new Date().toISOString()
  };
  writeFileSync(statePath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export function redactDeviceOutput(input: string): string {
  if (!input) return '';
  return input
    .replace(/starli_op_[A-Za-z0-9_-]{16,}/g, 'starli_op_[REDACTED]')
    .replace(/starli_dev_[A-Za-z0-9_-]{16,}/g, 'starli_dev_[REDACTED]')
    .replace(/SC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/g, 'SC-[REDACTED]')
    .replace(/\b(sk_live_|sk_test_|rk_live_|rk_test_|whsec_)[A-Za-z0-9_]+\b/g, '$1[REDACTED]')
    .replace(/\b(AIza[0-9A-Za-z-_]{25,})\b/g, '[GEMINI_KEY_REDACTED]')
    .slice(0, MAX_OUTPUT_BYTES);
}

const FORBIDDEN_METACHARS = /[;&|`$<>]/;

export function validateStructuredArgs(args: string[]): void {
  for (const arg of args) {
    const value = String(arg);
    if (value.length > 500 || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
      throw new Error('Argument invalid sau prea lung pentru execuția structurată pe dispozitiv.');
    }
    if (FORBIDDEN_METACHARS.test(value)) {
      throw new Error(`Metacaracterele shell nu sunt permise în argumentele structurate: "${value}"`);
    }
  }
}

function normalizeComparisonPath(p: string): string {
  const cleaned = p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return osPlatform() === 'win32' ? cleaned.toLowerCase() : cleaned;
}

export function isDevicePathAllowed(candidatePath: string, allowedRoots: string[]): boolean {
  if (!candidatePath || typeof candidatePath !== 'string') return false;
  if (candidatePath.includes('\0')) return false;
  const rawSegments = candidatePath.replace(/\\/g, '/').split('/');
  if (rawSegments.includes('..')) return false;
  const resolvedCandidate = normalizeComparisonPath(resolve(candidatePath));
  return allowedRoots.some((root) => {
    const resolvedRoot = normalizeComparisonPath(resolve(root));
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}/`);
  });
}

export function parseAdbDevicesOutput(stdoutText: string): {
  adbStatus: 'CONNECTED' | 'OFFLINE' | 'UNAUTHORIZED' | 'NONE';
  adbDevices: AdbDeviceEntry[];
} {
  const lines = String(stdoutText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('List of devices attached') && !l.startsWith('* daemon'));
  const adbDevices: AdbDeviceEntry[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const rawState = parts[1] || 'unknown';
    if (!serial) continue;
    const state: AdbDeviceEntry['state'] =
      rawState === 'device' || rawState === 'offline' || rawState === 'unauthorized' ? rawState : 'unknown';
    const modelMatch = line.match(/model:([^\s]+)/);
    adbDevices.push({
      serial,
      state,
      model: modelMatch ? modelMatch[1] : undefined,
      smsCapable: state === 'device',
      canSendSms: state === 'device'
    });
  }
  let adbStatus: 'CONNECTED' | 'OFFLINE' | 'UNAUTHORIZED' | 'NONE' = 'NONE';
  if (adbDevices.some((d) => d.state === 'device')) adbStatus = 'CONNECTED';
  else if (adbDevices.some((d) => d.state === 'unauthorized')) adbStatus = 'UNAUTHORIZED';
  else if (adbDevices.some((d) => d.state === 'offline')) adbStatus = 'OFFLINE';
  return { adbStatus, adbDevices };
}

/** Background connectors may retain a PATH from before platform-tools was installed. */
export function resolveAdbExecutable(env:NodeJS.ProcessEnv=process.env,platform=osPlatform()):string{
 const configured=env.STARLI_ADB_PATH||env.ADB_PATH;
 if(configured){if(!existsSync(configured))throw Error('Executabilul ADB configurat nu există: '+configured);return configured;}
 if(platform!=='win32')return 'adb';
 const candidates=[...(env.Path||env.PATH||'').split(';').filter(Boolean).map(folder=>join(folder.replace(/^"|"$/g,''),'adb.exe')),
  ...[env.ANDROID_HOME,env.ANDROID_SDK_ROOT].filter(Boolean).map(root=>join(root!,'platform-tools','adb.exe')),
  ...[env.ProgramFiles,env.PROGRAMFILES].filter(Boolean).map(root=>join(root!,'platform-tools','adb.exe')),
  ...(env.LOCALAPPDATA?[join(env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe')]:[])];
 return candidates.find(path=>existsSync(path))||'adb';
}

export async function runStructuredProcess(
  binary: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  if(options.signal?.aborted)throw Error('Lucrarea a fost oprită înainte de execuție.');
  if(/^adb(?:\.exe)?$/i.test(binary)&&args.includes(SMS_BRIDGE_COMPONENT)){
    for(const arg of args)if(arg.length>32768||/[\0\r\n;&|`$<>]/.test(arg))throw Error('Argument invalid pentru protocolul SMS Bridge.');
  }else validateStructuredArgs(args);
  if(/^adb(?:\.exe)?$/i.test(binary))binary=resolveAdbExecutable();
  const timeoutMs = Math.min(Math.max(options.timeoutMs || DEFAULT_TIMEOUT_MS, 1000), 120_000);
  return new Promise((resolvePromise) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(binary, args, {
      cwd: options.cwd || process.cwd(),
      shell: false,
      windowsHide: true
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {}
    }, timeoutMs);

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          try {
            child.kill('SIGTERM');
          } catch {}
        },
        { once: true }
      );
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBuf.length < MAX_OUTPUT_BYTES) {
        stdoutBuf += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stdoutBuf.length);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBuf.length < MAX_OUTPUT_BYTES) {
        stderrBuf += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stderrBuf.length);
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode: 1,
        stdout: redactDeviceOutput(stdoutBuf),
        stderr: redactDeviceOutput(err.message || String(err)),
        timedOut
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        stdout: redactDeviceOutput(stdoutBuf),
        stderr: redactDeviceOutput(stderrBuf),
        timedOut
      });
    });
  });
}

export async function inspectLocalAdbDevices(): Promise<{
  adbStatus: 'CONNECTED' | 'OFFLINE' | 'UNAUTHORIZED' | 'NONE';
  adbDevices: AdbDeviceEntry[];
}> {
  try {
    const res = await runStructuredProcess('adb', ['devices', '-l'], { timeoutMs: 6_000 });
    if (res.exitCode !== 0 && !res.stdout) {
      return { adbStatus: 'NONE', adbDevices: [] };
    }
    const inventory=parseAdbDevicesOutput(res.stdout);
    for(const phone of inventory.adbDevices)if(phone.state==='device'){try{const health=await bridgeCall(runStructuredProcess,phone.serial,['--es','operation','health']);phone.canSendSms=health.sendPermission===true;}catch{phone.canSendSms=false;}}
    return inventory;
  } catch {
    return { adbStatus: 'NONE', adbDevices: [] };
  }
}

export async function executeDeviceJob(
  state: DeviceState,
  job: {
    id: string;
    kind: string;
    idempotencyKey?: string | null;
    requiresApproval?: boolean;
    approvedBy?: string | null;
    approvedAt?: string | null;
    payloadJson?: string;
    args?:Record<string,any>;
    timeoutMs?: number;
  },
  options: {
    statePath?: string;
    processRunner?: typeof runStructuredProcess;
    signal?: AbortSignal;
  } = {}
): Promise<ExecutedJobRecord> {
  // 1. Check local deduplication store by jobId or idempotencyKey
  const dedupKey = job.idempotencyKey || job.id;
  if (state.executedJobs[job.id]) {
    return state.executedJobs[job.id];
  }
  if (job.idempotencyKey && state.executedJobs[job.idempotencyKey]) {
    return state.executedJobs[job.idempotencyKey];
  }

  const runner = options.processRunner || runStructuredProcess;
  let payload: Record<string, any> = {};
  try {
    payload = job.args||JSON.parse(job.payloadJson || '{}');
    if(job.kind==='device.fs.read'||job.kind==='device.fs.write')payload={...payload,tool:'filesystem',action:job.kind.endsWith('read')?'read':'write',targetPath:payload.path};
    if(job.kind==='device.adb.inventory')payload={tool:'adb',args:['devices','-l']};
    if(job.kind==='device.sms.send')payload={...payload,tool:'adb_sms',recipient:payload.to};
  } catch {
    payload = {};
  }

  const recordResult = (result: Omit<ExecutedJobRecord, 'jobId' | 'idempotencyKey' | 'executedAt'>): ExecutedJobRecord => {
    const entry: ExecutedJobRecord = {
      jobId: job.id,
      idempotencyKey: job.idempotencyKey || undefined,
      status: result.status,
      output: redactDeviceOutput(result.output),
      error: result.error ? redactDeviceOutput(result.error) : undefined,
      exitCode: result.exitCode,
      executedAt: new Date().toISOString()
    };
    state.executedJobs[job.id] = entry;
    if (dedupKey) state.executedJobs[dedupKey] = entry;
    if (options.statePath) {
      saveDeviceState(state, options.statePath);
    }
    return entry;
  };

  try {
    // Handle Privileged Single-Execution PowerShell separately
    if (job.kind === 'device.powershell') {
      if (!job.approvedBy || !job.approvedAt) {
        return recordResult({
          status: 'FAILED',
          output: '',
          error: 'Execuția PowerShell privilegiată a fost respinsă local: lipsește aprobarea explicită a operatorului.',
          exitCode: 403
        });
      }
      const command = String(payload.command || '').trim();
      if (!command) {
        return recordResult({
          status: 'FAILED',
          output: '',
          error: 'Comanda PowerShell este goală.',
          exitCode: 400
        });
      }
      const res = await runner(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { timeoutMs: job.timeoutMs || DEFAULT_TIMEOUT_MS, signal: options.signal }
      );
      return recordResult({
        status: res.timedOut ? 'TIMED_OUT' : res.exitCode === 0 ? 'SUCCEEDED' : 'FAILED',
        output: res.stdout,
        error: res.stderr || (res.timedOut ? 'Timeout depășit.' : undefined),
        exitCode: res.exitCode
      });
    }

    // Handle Structured Device Tasks
    const tool = String(payload.tool || '');
    const action = String(payload.action || '');
    const cwd = payload.cwd ? String(payload.cwd) : state.allowedRoots[0] || process.cwd();
    const targetPath = payload.targetPath ? String(payload.targetPath) : undefined;
    const args: string[] = Array.isArray(payload.args) ? payload.args.map(String) : [];

    if (!isDevicePathAllowed(cwd, state.allowedRoots)) {
      return recordResult({
        status: 'FAILED',
        output: '',
        error: `Calea de lucru "${cwd}" se află în afara directoarelor permise pe dispozitiv.`,
        exitCode: 403
      });
    }
    if (targetPath && !isDevicePathAllowed(targetPath, state.allowedRoots)) {
      return recordResult({
        status: 'FAILED',
        output: '',
        error: `Calea țintă "${targetPath}" se află în afara directoarelor permise pe dispozitiv.`,
        exitCode: 403
      });
    }

    validateStructuredArgs(args);

    if (tool === 'filesystem') {
      const resolvedTarget = resolve(targetPath || cwd);
      if (!isDevicePathAllowed(resolvedTarget, state.allowedRoots)) {
        return recordResult({
          status: 'FAILED',
          output: '',
          error: 'Acces interzis în afara directoarelor permise.',
          exitCode: 403
        });
      }
      if (action === 'list') {
        const entries = readdirSync(resolvedTarget).slice(0, 200).map((name) => {
          const full = join(resolvedTarget, name);
          const st = statSync(full);
          return { name, isDirectory: st.isDirectory(), size: st.size };
        });
        return recordResult({
          status: 'SUCCEEDED',
          output: JSON.stringify(entries, null, 2),
          exitCode: 0
        });
      }
      if (action === 'read') {
        const content = readFileSync(resolvedTarget, 'utf8').slice(0, MAX_OUTPUT_BYTES);
        return recordResult({
          status: 'SUCCEEDED',
          output: content,
          exitCode: 0
        });
      }
      if (action === 'write') {
        const content = String(payload.content ?? args[0] ?? '');
        mkdirSync(dirname(resolvedTarget), { recursive: true });
        writeFileSync(resolvedTarget, content, 'utf8');
        return recordResult({
          status: 'SUCCEEDED',
          output: `Scris ${Buffer.byteLength(content, 'utf8')} octeți în ${resolvedTarget}`,
          exitCode: 0
        });
      }
      return recordResult({
        status: 'FAILED',
        output: '',
        error: `Acțiune filesystem necunoscută: ${action}`,
        exitCode: 400
      });
    }

    if (tool === 'adb_sms') {
      // Structured ADB SMS preparation/dispatch without equating ADB command completion to carrier delivery
      const recipient = String(payload.recipient || '');
      const body = String(payload.body || '');
      if (!/^\+[1-9]\d{7,14}$/.test(recipient) || !body) {
        return recordResult({
          status: 'FAILED',
          output: '',
          error: 'Destinatar sau conținut SMS invalid pentru ADB.',
          exitCode: 400
        });
      }
      const adbInfo = await inspectLocalAdbDevices();
      if (adbInfo.adbStatus !== 'CONNECTED') {
        return recordResult({
          status: 'FAILED',
          output: JSON.stringify({smsReceipt:{state:'FAILED_BEFORE_SEND',error:'ADB '+adbInfo.adbStatus}}),
          error: `Telefonul Android nu este conectat și autorizat prin ADB (stare=${adbInfo.adbStatus}).`,
          exitCode: 1
        });
      }
      const phone=adbInfo.adbDevices.find(d=>d.state==='device'&&(!payload.serial||d.serial===payload.serial));
      if(!phone?.canSendSms)return recordResult({status:'FAILED',output:JSON.stringify({smsReceipt:{state:'FAILED_BEFORE_SEND',error:'SMS Bridge indisponibil sau fără SEND_SMS'}}),error:'Starli SMS Bridge nu este disponibil sau nu are permisiunea SEND_SMS.',exitCode:403});
      const receipt=await sendSmsThroughBridge(runner,{serial:phone.serial,requestId:String(payload.messageId||job.id),to:recipient,body},options.signal);
      return recordResult({status:['SENT','DELIVERED'].includes(receipt.state)?'SUCCEEDED':receipt.state==='FAILED_BEFORE_SEND'?'FAILED':'INCERT',output:JSON.stringify({smsReceipt:receipt,carrierDeliveryConfirmed:receipt.state==='DELIVERED'}),error:['SENT','DELIVERED'].includes(receipt.state)?undefined:String(receipt.error||'Android nu a confirmat expedierea.'),exitCode:['SENT','DELIVERED'].includes(receipt.state)?0:1});

    }

    const allowedBinaries: Record<string, string> = {
      git: 'git',
      node: 'node',
      npm: osPlatform() === 'win32' ? 'npm.cmd' : 'npm',
      adb: 'adb',
      tsc: osPlatform() === 'win32' ? 'npx.cmd' : 'npx'
    };
    const binary = allowedBinaries[tool];
    if (!binary) {
      return recordResult({
        status: 'FAILED',
        output: '',
        error: `Instrumentul "${tool}" nu se află în lista aprobată (git, node, npm, adb, tsc, filesystem).`,
        exitCode: 403
      });
    }

    const finalArgs = tool === 'tsc' ? ['tsc', ...args] : [action, ...args].filter(Boolean);
    const res = await runner(binary, finalArgs, {
      cwd,
      timeoutMs: job.timeoutMs || DEFAULT_TIMEOUT_MS,
      signal: options.signal
    });
    return recordResult({
      status: res.timedOut ? 'TIMED_OUT' : res.exitCode === 0 ? 'SUCCEEDED' : 'FAILED',
      output: res.stdout,
      error: res.stderr || (res.timedOut ? 'Timeout depășit.' : undefined),
      exitCode: res.exitCode
    });
  } catch (err: any) {
    return recordResult({
      status: 'FAILED',
      output: '',
      error: err?.message || String(err),
      exitCode: 1
    });
  }
}

export async function pairDeviceWithBackend(options: {
  pairingCode: string;
  apiUrl: string;
  deviceName?: string;
  statePath?: string;
  fetchImpl?: typeof fetch;
}): Promise<DeviceState> {
  const fetchImpl = options.fetchImpl || fetch;
  const apiUrl = options.apiUrl.replace(/\/$/, '');
  const statePath = options.statePath || defaultDeviceStatePath();
  const state = loadDeviceState(statePath);
  const adb = await inspectLocalAdbDevices();
  const capabilities = ['filesystem', 'git', 'node', 'npm', 'adb', 'adb_sms'];
  const response = await fetchImpl(`${apiUrl}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation($pairingCode:String!,$name:String!,$platform:String!,$version:String!,$capabilities:[String!]!){
        completeDevicePairing(pairingCode:$pairingCode,name:$name,platform:$platform,version:$version,capabilities:$capabilities){
          deviceToken
          device{id name allowedRoots status}
        }
      }`,
      variables: {
        pairingCode: options.pairingCode.trim().toUpperCase(),
        name: options.deviceName || `${hostname()}-windows`,
        platform: `${osPlatform()}-${process.arch}`,
        version: DEVICE_VERSION,
        capabilities: adb.adbStatus === 'CONNECTED' ? [...capabilities, 'android_connected'] : capabilities
      }
    })
  });
  const payload = (await response.json()) as any;
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || `Eroare HTTP ${response.status} la asocierea dispozitivului.`);
  }
  const result = payload.data.completeDevicePairing;
  state.apiUrl = apiUrl;
  state.deviceId = result.device.id;
  state.deviceName = result.device.name;
  state.deviceToken = result.deviceToken;
  state.allowedRoots = Array.isArray(result.device.allowedRoots) && result.device.allowedRoots.length
    ? result.device.allowedRoots
    : [process.cwd()];
  saveDeviceState(state, statePath);
  return state;
}

export function startDeviceConnectorLoop(options: {
  statePath?: string;
  heartbeatIntervalMs?: number;
  maxReconnectDelayMs?: number;
  onStatus?: (msg: string) => void;
  inspectAdb?:typeof inspectLocalAdbDevices;
} = {}): { stop: () => void } {
  const statePath = options.statePath || defaultDeviceStatePath();
  const heartbeatIntervalMs = options.heartbeatIntervalMs || 15_000;
  const maxReconnectDelayMs = options.maxReconnectDelayMs || 30_000;
  const log = options.onStatus || ((msg: string) => process.stdout.write(`[starli-device] ${msg}\n`));

  let stopped = false;
  let ws: WebSocket | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let attempt = 0;
  const activeTaskControllers = new Map<string, AbortController>();
  const claims=new Map<string,{resolve:(lease:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const acceptJob=async(job:any)=>{
    if(!job?.id||activeTaskControllers.has(job.id))return;
    const socket=ws;if(!socket||socket.readyState!==WebSocket.OPEN)return;
    const controller=new AbortController();activeTaskControllers.set(job.id,controller);
    try{
      const lease=await new Promise<string>((resolveClaim,reject)=>{const timer=setTimeout(()=>{claims.delete(job.id);reject(Error('Serverul nu a confirmat preluarea lucrării; execuția nu a început.'));},12000);claims.set(job.id,{resolve:resolveClaim,reject,timer});socket.send(JSON.stringify({type:'JOB_REPORT',jobId:job.id,status:'RUNNING'}));});
      const currentState=loadDeviceState(statePath);const result=await executeDeviceJob(currentState,job,{statePath,signal:controller.signal});
      if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'JOB_REPORT',jobId:job.id,leaseToken:lease,status:result.status==='TIMED_OUT'?'INCERT':result.status,output:result.output,error:result.error,exitCode:result.exitCode}));
    }catch(error){log('Lucrare '+job.id+': '+(error instanceof Error?error.message:String(error)));}
    finally{activeTaskControllers.delete(job.id);}
  };

  const connect = () => {
    if (stopped) return;
    const state = loadDeviceState(statePath);
    if (!state.deviceToken) {
      log('Nu există token de dispozitiv salvat. Rulează mai întâi: starli-device pair --code PAIR-XXXX-XXXX');
      return;
    }
    const wsUrl = `${state.apiUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/ws/device?token=${encodeURIComponent(state.deviceToken)}`;
    log(`Conectare WSS către ${state.apiUrl}/ws/device...`);
    ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${state.deviceToken}`
      }
    });

    const sendHeartbeat = async () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const adb = await (options.inspectAdb||inspectLocalAdbDevices)();
      ws.send(
        JSON.stringify({
          type: 'HEARTBEAT',
          version: DEVICE_VERSION,
          capabilities: ['filesystem', 'git', 'node', 'npm', 'adb', 'adb_sms'],
          adbStatus: adb.adbStatus,
          adbDevices: adb.adbDevices
        })
      );
    };

    ws.on('open', async () => {
      attempt = 0;
      log(`Conectat cu succes ca dispozitiv ${state.deviceName || state.deviceId}.`);
      await sendHeartbeat();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        void sendHeartbeat();
      }, heartbeatIntervalMs);
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        const type=String(msg.type||'').toUpperCase();
        if(type==='JOB_REPORT_ACK'&&claims.has(String(msg.jobId))){const claim=claims.get(String(msg.jobId))!;claims.delete(String(msg.jobId));clearTimeout(claim.timer);if(msg.status==='RUNNING'&&msg.leaseToken)claim.resolve(String(msg.leaseToken));else claim.reject(Error('Preluarea lucrării a fost refuzată.'));return;}
        if(type==='ERROR'){log('Server: '+String(msg.message||'Eroare protocol'));return;}
        if(type==='JOB_DISPATCH'&&msg.job){void acceptJob(msg.job);return;}
        if(type==='HEARTBEAT_ACK'&&Array.isArray(msg.pendingJobs)){for(const job of msg.pendingJobs)void acceptJob(job);return;}
        if (type === 'CANCEL_JOB' && msg.jobId) {
          const controller = activeTaskControllers.get(String(msg.jobId));
          if (controller) controller.abort();
          return;
        }
      } catch (err: any) {
        log(`Eroare procesare mesaj WSS: ${err?.message || String(err)}`);
      }
    });

    ws.on('close', (code, reason) => {
      for(const claim of claims.values()){clearTimeout(claim.timer);claim.reject(Error('Conexiunea a fost întreruptă înainte de confirmarea preluării.'));}claims.clear();
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (stopped) return;
      if (code === 4001) {
        log(`Conexiune respinsă (4001: ${reason.toString() || 'Dispozitiv revocat sau neautorizat'}). Reconectarea automată a fost oprită.`);
        return;
      }
      attempt += 1;
      const delay = Math.min(1000 * Math.pow(2, Math.min(attempt, 5)), maxReconnectDelayMs);
      log(`Conexiune închisă (cod ${code}). Reconectare cu backoff în ${Math.round(delay / 1000)}s...`);
      reconnectTimer = setTimeout(connect, delay);
    });

    ws.on('error', (err) => {
      log(`Eroare socket: ${err.message}`);
    });
  };

  connect();

  return {
    stop: () => {
      stopped = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const c of activeTaskControllers.values()) c.abort();
      for(const claim of claims.values()){clearTimeout(claim.timer);claim.reject(Error('Conector oprit.'));}claims.clear();
      try {
        ws?.close();
      } catch {}
    }
  };
}

export async function runDeviceCli(argv: string[]): Promise<void> {
  const [command = 'connect', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
      flags[key] = val;
    }
  }

  if (command === 'help' || command === '--help' || flags.help) {
    process.stdout.write(
      [
        'STARLI DEVICE — Conector securizat Windows pentru Starli Operator',
        'Comenzi disponibile:',
        '  starli-device pair --code PAIR-XXXX-XXXX [--api https://api.starlidigital.ro] [--name Windows-Office]',
        '  starli-device status [--json]',
        '  starli-device adb [--json]',
        '  starli-device connect'
      ].join('\n') + '\n'
    );
    return;
  }

  if (command === 'pair') {
    const code = flags.code || rest[0] || '';
    if (!code) {
      throw new Error('Specifică codul unic de asociere: starli-device pair --code PAIR-XXXX-XXXX');
    }
    const apiUrl = flags.api || process.env.STARLI_API_URL || 'https://api.starlidigital.ro';
    const state = await pairDeviceWithBackend({
      pairingCode: code,
      apiUrl,
      deviceName: flags.name
    });
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify({ paired: true, deviceId: state.deviceId, deviceName: state.deviceName, allowedRoots: state.allowedRoots }, null, 2)}\n`
      );
    } else {
      process.stdout.write(`Dispozitiv asociat cu succes: ${state.deviceName} (${state.deviceId})\nDirectoare permise: ${state.allowedRoots.join(', ')}\n`);
    }
    return;
  }

  if (command === 'adb') {
    const adb = await inspectLocalAdbDevices();
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(adb, null, 2)}\n`);
    } else {
      process.stdout.write(`Stare ADB: ${adb.adbStatus} | Dispozitive detectate: ${adb.adbDevices.length}\n`);
      for (const dev of adb.adbDevices) {
        process.stdout.write(`  • ${dev.serial} [${dev.state}] ${dev.model || ''}\n`);
      }
    }
    return;
  }

  if (command === 'status') {
    const state = loadDeviceState();
    const adb = await inspectLocalAdbDevices();
    const statusPayload = {
      deviceId: state.deviceId || null,
      deviceName: state.deviceName || null,
      apiUrl: state.apiUrl,
      hasToken: Boolean(state.deviceToken),
      allowedRoots: state.allowedRoots,
      deduplicatedJobsCount: Object.keys(state.executedJobs).length,
      adb
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(statusPayload, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Dispozitiv: ${statusPayload.deviceName || 'neasociat'} (${statusPayload.deviceId || '-'}) | API: ${statusPayload.apiUrl} | ADB: ${adb.adbStatus} | Lucrări deduplicate local: ${statusPayload.deduplicatedJobsCount}\n`
      );
    }
    return;
  }

  if (command === 'connect' || command === 'run') {
    startDeviceConnectorLoop();
    return;
  }

  throw new Error(`Comandă necunoscută: ${command}`);
}
