import type { DeviceCapabilityDefinition, DeviceCapabilityId } from './types.js';

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => Object.freeze({
  type: 'object',
  properties: Object.freeze(properties),
  required: Object.freeze(required),
  additionalProperties: false
});

export const DEVICE_CAPABILITY_CATALOG: readonly DeviceCapabilityDefinition[] = Object.freeze([
  Object.freeze({
    id: 'device.fs.read', displayName: 'Read workspace file',
    description: 'Reads one UTF-8 file inside a device allowed root.', sideEffectLevel: 'READ', approvalRequired: false,
    authority: 'DEVICE_JOB', jobKind: 'device.fs.read',
    inputSchema: objectSchema({ path: { type: 'string', maxLength: 500 } }, ['path'])
  }),
  Object.freeze({
    id: 'device.fs.write', displayName: 'Write workspace file',
    description: 'Writes bounded UTF-8 content inside a device allowed root after explicit approval.', sideEffectLevel: 'WRITE', approvalRequired: true,
    authority: 'DEVICE_JOB', jobKind: 'device.fs.write',
    inputSchema: objectSchema({ path: { type: 'string', maxLength: 500 }, content: { type: 'string', maxLength: 250000 } }, ['path', 'content'])
  }),
  Object.freeze({
    id: 'device.dev.git', displayName: 'Git diagnostics',
    description: 'Runs one of the explicitly allowlisted read-only Git diagnostics.', sideEffectLevel: 'READ', approvalRequired: false,
    authority: 'DEVICE_JOB', jobKind: 'device.tool.exec',
    inputSchema: objectSchema({ operation: { type: 'string', enum: ['version', 'status', 'diff_stat'] }, cwd: { type: 'string', maxLength: 500 } }, ['operation', 'cwd'])
  }),
  Object.freeze({
    id: 'device.dev.node', displayName: 'Node runtime diagnostics',
    description: 'Reads the Node.js runtime version on the paired device.', sideEffectLevel: 'READ', approvalRequired: false,
    authority: 'DEVICE_JOB', jobKind: 'device.tool.exec',
    inputSchema: objectSchema({ operation: { type: 'string', enum: ['version'] }, cwd: { type: 'string', maxLength: 500 } }, ['operation', 'cwd'])
  }),
  Object.freeze({
    id: 'device.dev.npm', displayName: 'npm runtime diagnostics',
    description: 'Reads the npm runtime version on the paired device.', sideEffectLevel: 'READ', approvalRequired: false,
    authority: 'DEVICE_JOB', jobKind: 'device.tool.exec',
    inputSchema: objectSchema({ operation: { type: 'string', enum: ['version'] }, cwd: { type: 'string', maxLength: 500 } }, ['operation', 'cwd'])
  }),
  Object.freeze({
    id: 'device.adb.inventory', displayName: 'Android device inventory',
    description: 'Reads bounded ADB device inventory through the paired connector.', sideEffectLevel: 'READ', approvalRequired: false,
    authority: 'DEVICE_JOB', jobKind: 'device.adb.inventory', inputSchema: objectSchema({})
  }),

  Object.freeze({ id: 'device.gui.capture', displayName: 'Capture Windows screen', description: 'Captures a bounded desktop or window preview from the interactive Windows session.', sideEffectLevel: 'READ', approvalRequired: false, authority: 'DEVICE_JOB', jobKind: 'device.gui.capture', inputSchema: objectSchema({ scope: { type: 'string', enum: ['desktop','window'] }, windowId: { type: 'string', maxLength: 20 }, maxWidth: { type: 'integer', minimum: 160, maximum: 1280 }, maxHeight: { type: 'integer', minimum: 120, maximum: 720 }, quality: { type: 'integer', minimum: 25, maximum: 70 }, maxEncodedBytes: { type: 'integer', minimum: 4096, maximum: 24000 } }) }),
  Object.freeze({ id: 'device.gui.windows.list', displayName: 'List Windows windows', description: 'Lists bounded visible-window metadata from the interactive Windows session.', sideEffectLevel: 'READ', approvalRequired: false, authority: 'DEVICE_JOB', jobKind: 'device.gui.windows.list', inputSchema: objectSchema({ limit: { type: 'integer', minimum: 1, maximum: 50 } }) }),
  Object.freeze({ id: 'device.gui.window.focus', displayName: 'Focus Windows window', description: 'Focuses one approved visible window after explicit approval.', sideEffectLevel: 'WRITE', approvalRequired: true, authority: 'DEVICE_JOB', jobKind: 'device.gui.window.focus', inputSchema: objectSchema({ windowId: { type: 'string', maxLength: 20 } }, ['windowId']) }),
  Object.freeze({ id: 'device.gui.mouse.move', displayName: 'Move Windows pointer', description: 'Moves the pointer inside an approved foreground window after explicit approval.', sideEffectLevel: 'WRITE', approvalRequired: true, authority: 'DEVICE_JOB', jobKind: 'device.gui.mouse.move', inputSchema: objectSchema({ windowId: { type: 'string', maxLength: 20 }, x: { type: 'integer', minimum: -32768, maximum: 32767 }, y: { type: 'integer', minimum: -32768, maximum: 32767 } }, ['windowId','x','y']) }),
  Object.freeze({ id: 'device.gui.mouse.click', displayName: 'Click Windows pointer', description: 'Clicks inside an approved foreground window after explicit approval.', sideEffectLevel: 'WRITE', approvalRequired: true, authority: 'DEVICE_JOB', jobKind: 'device.gui.mouse.click', inputSchema: objectSchema({ windowId: { type: 'string', maxLength: 20 }, x: { type: 'integer', minimum: -32768, maximum: 32767 }, y: { type: 'integer', minimum: -32768, maximum: 32767 }, button: { type: 'string', enum: ['left','right','middle'] }, count: { type: 'integer', minimum: 1, maximum: 2 } }, ['windowId','x','y']) }),
  Object.freeze({ id: 'device.gui.keyboard.text', displayName: 'Type into Windows window', description: 'Types bounded printable text into an approved foreground window after explicit approval.', sideEffectLevel: 'WRITE', approvalRequired: true, authority: 'DEVICE_JOB', jobKind: 'device.gui.keyboard.text', inputSchema: objectSchema({ windowId: { type: 'string', maxLength: 20 }, text: { type: 'string', maxLength: 2000 } }, ['windowId','text']) }),
  Object.freeze({ id: 'device.gui.keyboard.key', displayName: 'Send Windows keys', description: 'Sends a bounded allowlisted key sequence to an approved foreground window after explicit approval.', sideEffectLevel: 'WRITE', approvalRequired: true, authority: 'DEVICE_JOB', jobKind: 'device.gui.keyboard.key', inputSchema: objectSchema({ windowId: { type: 'string', maxLength: 20 }, keys: { type: 'array', maxItems: 12 } }, ['windowId','keys']) }),
  Object.freeze({ id: 'device.gui.foreground', displayName: 'Read foreground window', description: 'Reads bounded metadata for the current foreground Windows window.', sideEffectLevel: 'READ', approvalRequired: false, authority: 'DEVICE_JOB', jobKind: 'device.gui.foreground', inputSchema: objectSchema({}) }),
  Object.freeze({ id: 'device.gui.screen.info', displayName: 'Read Windows screen info', description: 'Reads bounded screen geometry and DPI metadata from the interactive Windows session.', sideEffectLevel: 'READ', approvalRequired: false, authority: 'DEVICE_JOB', jobKind: 'device.gui.screen.info', inputSchema: objectSchema({}) }),
  Object.freeze({
    id: 'device.sms.send', displayName: 'Send governed SMS',
    description: 'Represents SMS delivery capability. Submission remains owned by the canonical messaging/consent workflow.', sideEffectLevel: 'HIGH_IMPACT', approvalRequired: true,
    authority: 'MESSAGING', jobKind: 'device.sms.send',
    inputSchema: objectSchema({ messageId: { type: 'string', maxLength: 180 }, serial: { type: 'string', maxLength: 80 } }, ['messageId'])
  })
] satisfies DeviceCapabilityDefinition[]);

const BY_ID = new Map<DeviceCapabilityId, DeviceCapabilityDefinition>(DEVICE_CAPABILITY_CATALOG.map(item => [item.id, item]));
const LEGACY_ADVERTISEMENT_MAP: Readonly<Record<string, readonly DeviceCapabilityId[]>> = Object.freeze({
  filesystem: ['device.fs.read', 'device.fs.write'],
  git: ['device.dev.git'],
  node: ['device.dev.node'],
  npm: ['device.dev.npm'],
  adb: ['device.adb.inventory'],
  adb_sms: ['device.sms.send']
});

export function deviceCapabilityDefinition(id: string): DeviceCapabilityDefinition | undefined {
  return BY_ID.get(id as DeviceCapabilityId);
}

export function normalizeAdvertisedDeviceCapabilities(values: readonly unknown[]): DeviceCapabilityId[] {
  const out = new Set<DeviceCapabilityId>();
  for (const value of values.slice(0, 50)) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) continue;
    if (BY_ID.has(raw as DeviceCapabilityId)) out.add(raw as DeviceCapabilityId);
    for (const mapped of LEGACY_ADVERTISEMENT_MAP[raw] ?? []) out.add(mapped);
  }
  return [...out].sort();
}
