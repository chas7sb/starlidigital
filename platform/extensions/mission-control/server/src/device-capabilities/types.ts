import type { OperatorJobStatus } from '../operator-jobs.js';

export type DeviceCapabilityId =
  | 'device.fs.read'
  | 'device.fs.write'
  | 'device.dev.git'
  | 'device.dev.node'
  | 'device.dev.npm'
  | 'device.adb.inventory'
  | 'device.sms.send'
  | 'device.gui.capture'
  | 'device.gui.windows.list'
  | 'device.gui.window.focus'
  | 'device.gui.mouse.move'
  | 'device.gui.mouse.click'
  | 'device.gui.keyboard.text'
  | 'device.gui.keyboard.key'
  | 'device.gui.foreground'
  | 'device.gui.screen.info';

export type DeviceCapabilitySideEffect = 'READ' | 'WRITE' | 'HIGH_IMPACT';
export type DeviceCapabilityAuthority = 'DEVICE_JOB' | 'MESSAGING';

export interface DeviceCapabilityDefinition {
  id: DeviceCapabilityId;
  displayName: string;
  description: string;
  sideEffectLevel: DeviceCapabilitySideEffect;
  approvalRequired: boolean;
  authority: DeviceCapabilityAuthority;
  jobKind: 'device.fs.read' | 'device.fs.write' | 'device.tool.exec' | 'device.adb.inventory' | 'device.sms.send'
    | 'device.gui.capture' | 'device.gui.windows.list' | 'device.gui.window.focus'
    | 'device.gui.mouse.move' | 'device.gui.mouse.click' | 'device.gui.keyboard.text'
    | 'device.gui.keyboard.key' | 'device.gui.foreground' | 'device.gui.screen.info' | null;
  inputSchema: Readonly<Record<string, unknown>>;
}

export interface DeviceCapabilityActor {
  tenantId: string;
  operatorId: string;
}

export interface DeviceCapabilityDescriptor extends DeviceCapabilityDefinition {
  deviceId: string;
  deviceName: string;
  deviceStatus: 'ONLINE' | 'OFFLINE' | 'REVOKED';
  advertised: true;
}

export interface DeviceJobReceipt {
  jobId: string;
  deviceId: string;
  capabilityId: DeviceCapabilityId;
  status: OperatorJobStatus;
  sideEffectLevel: DeviceCapabilitySideEffect;
  approval: {
    required: boolean;
    state: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED';
    approvedAt: string | null;
  };
  leaseState: 'UNCLAIMED' | 'ACTIVE' | 'RELEASED';
  dispatched: boolean | null;
  output: string | null;
  error: string | null;
  exitCode: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}
