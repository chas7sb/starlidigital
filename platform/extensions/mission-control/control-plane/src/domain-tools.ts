import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {HostedAgentService} from '../../server/src/hosted-agents/service.js';
import type { AuthPrincipal, AuditSink, UpstreamHealthProbe, ControlPlaneConfig } from './types.js';
import type { CrmServices } from '../../server/src/crm/services.js';
import type { MailboxServices } from '../../server/src/mailbox/service.js';
import type { AssetServices } from '../../server/src/assets/service.js';
import type { VideoServices } from '../../server/src/video/service.js';
import type { Store } from '../../server/src/store.js';
import type { Events } from '../../server/src/events.js';
import { resolve } from 'node:path';
import { registerAllControlPlaneTools, createAuditCaller, type ToolContext } from './tools/index.js';

export interface RegisterScopedDomainToolsOptions {
  server: McpServer;
  principal: AuthPrincipal;
  auditSink: AuditSink;
  crmServices?: CrmServices;
  mailboxServices?: MailboxServices;
  store?: Store;
  events?: Events;
  assetServices?: AssetServices;
  videoServices?: VideoServices;
  workspaceRoot?: string;
  healthProbe?: UpstreamHealthProbe;
  config?: ControlPlaneConfig;
  hostedAgentService?:HostedAgentService;
}

export function registerScopedDomainTools(options: RegisterScopedDomainToolsOptions) {
  const {
    server,
    principal,
    auditSink,
    crmServices,
    mailboxServices,
    store,
    events,
    assetServices,
    videoServices,
    workspaceRoot = process.env.STARLI_WORKSPACE_ROOT
      ? resolve(process.env.STARLI_WORKSPACE_ROOT)
      : (resolve(process.cwd()).endsWith('control-plane') || resolve(process.cwd()).endsWith('control-plane/') || resolve(process.cwd()).endsWith('control-plane\\')
          ? resolve(process.cwd(), '..')
          : resolve(process.cwd())),
    healthProbe,
    config,
    hostedAgentService,
  } = options;

  const auditCall = createAuditCaller(auditSink, principal);

  const ctx: ToolContext = {
    server,
    principal,
    auditSink,
    crmServices,
    mailboxServices,
    store,
    events,
    assetServices,
    videoServices,
    workspaceRoot,
    healthProbe,
    config,
    hostedAgentService,
    auditCall,
  };

  registerAllControlPlaneTools(ctx);
}
