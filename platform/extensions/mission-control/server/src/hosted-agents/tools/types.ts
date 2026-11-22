import { z } from 'zod';

export const ToolCategoryEnum = z.enum([
  'UTILITY',
  'CRM',
  'CALENDAR',
  'COMMUNICATION',
  'BOOKING',
  'ECOMMERCE',
  'PAYMENTS',
  'KNOWLEDGE',
  'ANALYTICS',
  'INTERNAL',
  'CUSTOM'
]);
export type ToolCategory = z.infer<typeof ToolCategoryEnum>;

export const PermissionLevelEnum = z.enum([
  'READ_ONLY',
  'AUTO_EXECUTE',
  'REQUIRES_USER_CONFIRMATION',
  'REQUIRES_OWNER_APPROVAL'
]);
export type PermissionLevel = z.infer<typeof PermissionLevelEnum>;

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: readonly (string | number | boolean)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: readonly string[];
  default?: any;
  minimum?: number;
  maximum?: number;
}

export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: readonly string[];
  description?: string;
  additionalProperties?: boolean;
}

export interface AgentToolContext {
  agentId: string;
  conversationId: string;
  visitorId?: string;
  visitorToken?: string;
  requestId?: string;
  tenantId?: string;
  agentConfig?: Record<string, any>;
  metadata?: Record<string, any>;
  store?: any;
  signal?: AbortSignal;
}

export interface AgentToolResult {
  success: boolean;
  data?: any;
  error?: string;
  summary?: string;
  metadata?: Record<string, any>;
}

export interface AgentTool {
  id: string;
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  category: ToolCategory;
  permissionLevel: PermissionLevel;
  execute(input: any, context: AgentToolContext): Promise<AgentToolResult>;
}

export interface ToolExecutionRecord {
  id: string;
  agentId: string;
  conversationId: string;
  toolName: string;
  toolCategory: ToolCategory;
  input: Record<string, any>;
  output?: Record<string, any>;
  success: boolean;
  error?: string;
  durationMs: number;
  permissionLevel: PermissionLevel;
  createdAt: string;
}

export interface ToolMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageDurationMs: number | null;
  byTool: Record<string, { total: number; success: number; failure: number; averageDurationMs: number | null }>;
}
