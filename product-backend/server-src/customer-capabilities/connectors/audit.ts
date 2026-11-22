import { randomUUID } from 'node:crypto';
import type { Store } from '../../store.js';
import type { ConnectorAuditReceipt, ConnectorAuditRepository } from './types.js';

const COLLECTION = 'customer-connector-audits';

export class InMemoryConnectorAuditRepository implements ConnectorAuditRepository {
  readonly receipts: ConnectorAuditReceipt[] = [];
  async appendConnectorAudit(receipt: ConnectorAuditReceipt): Promise<void> { this.receipts.push(structuredClone(receipt)); }
  listConnectorAudits(tenantId: string, limit = 50): readonly ConnectorAuditReceipt[] {
    return this.receipts.filter(row => row.tenantId === tenantId).slice(-Math.max(1, Math.min(100, limit))).reverse().map(row => structuredClone(row));
  }
}

export class StoreConnectorAuditRepository implements ConnectorAuditRepository {
  constructor(private readonly store: Store) {}
  async appendConnectorAudit(receipt: ConnectorAuditReceipt): Promise<void> {
    this.store.put(COLLECTION, structuredClone(receipt) as any, receipt.tenantId);
  }
  listConnectorAudits(tenantId: string, limit = 50): readonly ConnectorAuditReceipt[] {
    return (this.store.list(COLLECTION, tenantId) as ConnectorAuditReceipt[])
      .filter(row => row.tenantId === tenantId)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map(row => structuredClone(row));
  }
}

export function connectorAudit(input: Omit<ConnectorAuditReceipt, 'id'>): ConnectorAuditReceipt {
  return { id: `conrec_${randomUUID()}`, ...input };
}
