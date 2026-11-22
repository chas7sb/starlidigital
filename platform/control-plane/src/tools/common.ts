import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {HostedAgentService} from '../../../server/src/hosted-agents/service.js';
import type { AuthPrincipal, AuditSink, UpstreamHealthProbe, ControlPlaneConfig } from '../types.js';
import type { Store } from '../../../server/src/store.js';
import type { Events } from '../../../server/src/events.js';
import type { CrmServices } from '../../../server/src/crm/services.js';
import type { MailboxServices } from '../../../server/src/mailbox/service.js';
import type { AssetServices } from '../../../server/src/assets/service.js';
import type { VideoServices } from '../../../server/src/video/service.js';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from './security.js';

export interface ToolContext {
  server: McpServer;
  principal: AuthPrincipal;
  auditSink: AuditSink;
  store?: Store;
  events?: Events;
  hostedAgentService?:HostedAgentService;
  crmServices?: CrmServices;
  mailboxServices?: MailboxServices;
  assetServices?: AssetServices;
  videoServices?: VideoServices;
  workspaceRoot: string;
  healthProbe?: UpstreamHealthProbe;
  config?: ControlPlaneConfig;
  auditCall: (
    toolName: string,
    target: string | undefined,
    start: number,
    status: 'SUCCESS' | 'DENIED' | 'FAILED',
    args?: Record<string, unknown>,
    result?: Record<string, unknown>,
    error?: string
  ) => void;
}

export function createAuditCaller(auditSink: AuditSink, principal: AuthPrincipal) {
  return (
    toolName: string,
    target: string | undefined,
    start: number,
    status: 'SUCCESS' | 'DENIED' | 'FAILED',
    args?: Record<string, unknown>,
    result?: Record<string, unknown>,
    error?: string
  ) => {
    auditSink.record({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      principalId: principal.id,
      tool: toolName,
      target,
      durationMs: Date.now() - start,
      status,
      sanitizedArgs: redactSecrets(args) as Record<string, unknown>,
      sanitizedResult: redactSecrets(result) as Record<string, unknown>,
      error,
    });
  };
}

export function jsonResponse(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(redactSecrets(data), null, 2),
      },
    ],
  };
}

export function errorResponse(message: string, code = 'ERROR') {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: { code, message } }, null, 2),
      },
    ],
  };
}
