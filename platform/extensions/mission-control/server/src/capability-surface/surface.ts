import type {CanonicalCapabilityAuthority} from './canonical.js';
import {validateInput} from '../customer-capabilities/security.js';
import type {
  UnifiedToolDefinition,
  CapabilityCallerContext,
  UnifiedExecutionResult,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  DiscoveredToolDescriptor
} from './types.js';
import { STARLI_UNIFIED_30_TOOLS } from './catalog.js';
import { discoverCapabilitiesForSurface, isInternalCapabilityForbidden } from './discovery.js';
import { createCryptographicReceipt } from './receipts.js';

export interface SurfaceAdapters {
  canonical?: CanonicalCapabilityAuthority;
  /** @deprecated Not an execution authority; retained for source compatibility only. */
  executeTool?: (toolId: string, input: Record<string, unknown>, context: CapabilityCallerContext) => Promise<{ data: unknown; trust?: 'TRUSTED_PLATFORM' | 'TRUSTED_TENANT_DATA' | 'UNTRUSTED_EXTERNAL_DATA' }>;
  verifyApproval?: (approvalReferenceId: string, planHash: string, tenantId: string) => Promise<boolean>;
}

export class UnifiedCapabilitySurface {
  private tools: Map<string, UnifiedToolDefinition> = new Map();

  constructor(
    customTools: readonly UnifiedToolDefinition[] = STARLI_UNIFIED_30_TOOLS,
    private adapters: SurfaceAdapters = {}
  ) {
    for (const tool of customTools) {
      if (!isInternalCapabilityForbidden(tool.id)) {
        this.tools.set(tool.id, tool);
      }
    }
  }

  setTenantPause(tenantId:string,paused:boolean){if(!this.adapters.canonical)throw new Error('CANONICAL_AUTHORITY_UNAVAILABLE');this.adapters.canonical.pause(tenantId,paused);}
  isTenantPaused(tenantId:string){return this.adapters.canonical?.paused(tenantId)??false;}
  discover(callerContext:CapabilityCallerContext):DiscoveredToolDescriptor[]{
    return discoverCapabilitiesForSurface({tools:[...this.tools.values()],callerContext,isTenantPaused:this.isTenantPaused(callerContext.tenantId)}).map(tool=>{
      if(tool.metadata.availabilityState==='AVAILABLE'&&!this.adapters.canonical?.available(tool.id))return {...tool,metadata:{...tool.metadata,availabilityState:'UNAVAILABLE' as const}};
      return tool;
    });
  }

  async invoke(
    callerContext: CapabilityCallerContext,
    toolId: string,
    inputArgs: Record<string, unknown> = {}
  ): Promise<UnifiedExecutionResult> {
    const startedAt = new Date();

    const createDenial = (code: string, message: string, sideEffectLevel: any = 'NONE'): UnifiedExecutionResult => {
      const completedAt = new Date();
      const receipt = createCryptographicReceipt({
        tenantId: callerContext.tenantId,
        subjectId: callerContext.subjectId,
        projectId: callerContext.activeProjectId,
        toolId,
        sideEffectLevel,
        status: code === 'TENANT_PAUSED' ? 'PAUSED' : code === 'APPROVAL_REQUIRED' ? 'REQUIRES_APPROVAL' : 'DENIED',
        startedAt,
        completedAt,
        inputPayload: inputArgs,
        outputPayload: { error: code, message }
      });
      return {
        ok: false,
        toolId,
        data: null,
        trust: 'TRUSTED_PLATFORM',
        instructionsAllowed: false,
        receipt,
        error: { code, message }
      };
    };

    if(!inputArgs||typeof inputArgs!=='object'||Array.isArray(inputArgs))return createDenial('INVALID_INPUT','Input must be an object');

    // 1. Strict identity protection: forbid caller from injecting tenant/workspace overrides
    const identityOverrides = ['tenantId', 'workspaceId', 'ownerId', 'grantId', 'credentialReference'];
    for (const key of identityOverrides) {
      if (key in inputArgs) {
        return createDenial('IDENTITY_OVERRIDE_FORBIDDEN', `Caller is forbidden from supplying "${key}" in tool input.`);
      }
    }

    // 2. Reject forbidden internal tools
    if (isInternalCapabilityForbidden(toolId)) {
      return createDenial('CAPABILITY_FORBIDDEN', `Capability "${toolId}" is forbidden on customer capability surface.`);
    }

    const def = this.tools.get(toolId);
    if (!def) {
      return createDenial('CAPABILITY_NOT_FOUND', `Capability "${toolId}" was not found in capability surface.`);
    }

    // 3. Surface permission check
    if (!def.allowedSurfaces.includes(callerContext.surface)) {
      return createDenial('SURFACE_DENIED', `Surface "${callerContext.surface}" is not permitted to access "${toolId}".`);
    }

    // 4. Scope check
    const callerScopes = new Set(callerContext.scopes);
    const hasScopes = def.requiredScopes.every(scope => callerScopes.has(scope));
    if (!hasScopes) {
      return createDenial('SCOPE_DENIED', `Caller lacks required scopes: ${def.requiredScopes.join(', ')}.`);
    }

    // 5. Autonomy check
    if (callerContext.isAutonomous && !def.autonomousAllowed) {
      return createDenial('AUTONOMY_DENIED', `Capability "${toolId}" cannot be invoked autonomously.`);
    }

    // 6. Tenant Emergency Pause check
    if (toolId!=='starli.governance.pause' && this.isTenantPaused(callerContext.tenantId) && def.sideEffectLevel !== 'READ' && def.sideEffectLevel !== 'NONE') {
      return createDenial('TENANT_PAUSED', `Tenant execution is paused. Mutating operations are halted.`, def.sideEffectLevel);
    }

    if(def.projectScoped&&!callerContext.activeProjectId)return createDenial('PROJECT_REQUIRED','Project context is required');
    const canonical=this.adapters.canonical;
    if(!canonical)return createDenial('CANONICAL_AUTHORITY_UNAVAILABLE','Canonical services are not connected');
    if((toolId==='starli.governance.approve'||toolId==='starli.governance.reject')&&(!inputArgs.approvalReferenceId||!inputArgs.planHash))return createDenial('APPROVAL_REQUIRED','Exact approval and payload hash required');
    let input:Record<string,unknown>;
    try{input=validateInput(def.inputSchema as any,inputArgs);}catch{return createDenial('INVALID_INPUT','Input does not match the capability contract');}
    try{
      canonical.throttle(callerContext.tenantId,toolId,def.rateLimit.maxPerMinute,def.rateLimit.maxPerHour??1000);
      let data:unknown;let trust:'TRUSTED_PLATFORM'|'TRUSTED_TENANT_DATA'|'UNTRUSTED_EXTERNAL_DATA'='TRUSTED_PLATFORM';let canonicalReceiptId:string|undefined;
      if(toolId==='starli.governance.pause'){
        canonical.pause(callerContext.tenantId,true);data={paused:true,cancellation:'Use the owning runtime to inspect/stop in-flight work.'};
      }else if(toolId==='starli.governance.approve'||toolId==='starli.governance.reject'){
        if(!input.approvalReferenceId||!input.planHash)return createDenial('APPROVAL_REQUIRED','Exact approval and payload hash required');
        const result=canonical.resolve(callerContext,String(input.approvalReferenceId),String(input.planHash),toolId.endsWith('approve')?'APPROVE':'REJECT');data={id:result.id,status:result.status};
      }else if(toolId==='starli.governance.receipt_get'){
        data=canonical.receipt(callerContext.tenantId,String(input.receiptId));if(!data)return createDenial('RECEIPT_NOT_FOUND','Receipt unavailable');
      }else{
        if(def.sideEffectLevel!=='NONE'&&def.sideEffectLevel!=='READ')return createDenial('GOVERNED_EXECUTION_REQUIRED','Use Starli Execution with an exact action plan');
        const result=await canonical.invoke(callerContext,def,input);
        if(!result.ok)return createDenial(result.error?.code||'CAPABILITY_FAILED',result.error?.message||'Capability denied');
        data=result.data;trust=result.trust;canonicalReceiptId=result.receipt.id;
      }
      let dataFences:UnifiedExecutionResult['dataFences'];
      if(trust==='UNTRUSTED_EXTERNAL_DATA'||def.promptBoundaryPolicy.outputFencingRequired){dataFences={untrustedContentDetected:true,fencedBoundaryCount:1,sources:['external_customer_data']};if(typeof data==='string')data='[UNTRUSTED_EXTERNAL_DATA]\n'+data+'\n[/UNTRUSTED_EXTERNAL_DATA]';}
      if(!canonicalReceiptId)canonicalReceiptId=await canonical.recordGovernance(callerContext,toolId,data);
      const receipt=createCryptographicReceipt({tenantId:callerContext.tenantId,subjectId:callerContext.subjectId,projectId:callerContext.activeProjectId,toolId,sideEffectLevel:def.sideEffectLevel,status:'SUCCEEDED',startedAt,completedAt:new Date(),inputPayload:input,outputPayload:data});
      if(canonicalReceiptId)receipt.receiptId=canonicalReceiptId;
      return {ok:true,toolId,data,trust,instructionsAllowed:false,receipt,dataFences};
    }catch(error){const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CANONICAL_OPERATION_FAILED';return createDenial(code,'Canonical operation did not complete');}
  }

  async handleMcpJsonRpc(callerContext: CapabilityCallerContext, request: McpJsonRpcRequest): Promise<McpJsonRpcResponse> {
    if (!request || request.jsonrpc !== '2.0' || !request.method) {
      return {
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: { code: -32600, message: 'Invalid Request: missing jsonrpc 2.0 or method' }
      };
    }

    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'starli-os-capability-surface',
              version: '2.0.0'
            },
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false }
            }
          }
        };

      case 'tools/list': {
        const tools = this.discover(callerContext);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            tools: tools.map(t => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
              metadata: t.metadata
            }))
          }
        };
      }

      case 'tools/call': {
        const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
        const toolName = params?.name;
        const inputArgs = params?.arguments || {};

        if (!toolName || typeof toolName !== 'string') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32602, message: 'Missing tool name' }
          };
        }

        const result = await this.invoke(callerContext, toolName, inputArgs);

        if (!result.ok) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              isError: true,
              content: [{
                type: 'text',
                text: JSON.stringify({
                  ok: false,
                  toolId: result.toolId,
                  error: result.error,
                  receipt: result.receipt,
                  instructionsAllowed: false
                })
              }]
            }
          };
        }

        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ok: true,
                toolId: result.toolId,
                data: result.data,
                trust: result.trust,
                receipt: result.receipt,
                dataFences: result.dataFences,
                instructionsAllowed: false
              })
            }]
          }
        };
      }

      case 'resources/list': {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            resources: [
              {
                uri: `resource://tenant/${callerContext.tenantId}/status`,
                name: 'Business Health Snapshot',
                description: 'Realtime health and metrics for active tenant',
                mimeType: 'application/json'
              },
              {
                uri: `resource://tenant/${callerContext.tenantId}/graph`,
                name: 'Business Engine Graph',
                description: 'Connected system graph nodes and dependencies',
                mimeType: 'application/json'
              }
            ]
          }
        };
      }

      case 'resources/read': {
        const uri = (request.params as { uri?: string })?.uri;
        if (!uri || !uri.startsWith('resource://')) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32602, message: 'Invalid or missing resource URI' }
          };
        }

        // Cross-tenant protection
        if (uri.startsWith('resource://tenant/') && !uri.startsWith(`resource://tenant/${callerContext.tenantId}/`)) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32603, message: 'Access denied: cross-tenant resource read attempt' }
          };
        }

        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                uri,
                tenantId: callerContext.tenantId,
                instructionsAllowed: false,
                data: { state: 'UNAVAILABLE', reason: 'Use an authenticated canonical aggregate query.' }
              })
            }]
          }
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: `Method "${request.method}" not found` }
        };
    }
  }
}
