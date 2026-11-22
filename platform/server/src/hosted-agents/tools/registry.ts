import { PermissionLevelEnum, ToolCategoryEnum } from './types.js';
import type {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  JSONSchema,
  ToolCategory,
  PermissionLevel
} from './types.js';

export function validateAgainstSchema(schema: JSONSchema, input: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: ['Input must be a valid JSON object'] };
  }

  const obj = input as Record<string, any>;

  // Check required properties
  if (Array.isArray(schema.required)) {
    for (const req of schema.required) {
      if (obj[req] === undefined || obj[req] === null || obj[req] === '') {
        errors.push(`Missing required field: "${req}"`);
      }
    }
  }

  if (schema.additionalProperties === false) for (const key of Object.keys(obj)) if (!Object.prototype.hasOwnProperty.call(schema.properties || {},key)) errors.push('Unexpected input field');
  // Check property types and enums
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const val = obj[key];
      if (val === undefined || val === null) continue;

      switch (prop.type) {
        case 'string':
          if (typeof val !== 'string') {
            errors.push(`Field "${key}" must be a string, got ${typeof val}`);
          } else if (prop.enum && !prop.enum.includes(val)) {
            errors.push(`Field "${key}" must be one of: ${prop.enum.join(', ')}`);
          }
          break;
        case 'number':
          if (typeof val !== 'number' || !Number.isFinite(val)) {
            errors.push(`Field "${key}" must be a valid number`);
          } else {
            if (prop.minimum !== undefined && val < prop.minimum) {
              errors.push(`Field "${key}" must be at least ${prop.minimum}`);
            }
            if (prop.maximum !== undefined && val > prop.maximum) {
              errors.push(`Field "${key}" must be at most ${prop.maximum}`);
            }
          }
          break;
        case 'integer':
          if (typeof val !== 'number' || !Number.isSafeInteger(val)) {
            errors.push(`Field "${key}" must be a valid integer`);
          } else {
            if (prop.minimum !== undefined && val < prop.minimum) {
              errors.push(`Field "${key}" must be at least ${prop.minimum}`);
            }
            if (prop.maximum !== undefined && val > prop.maximum) {
              errors.push(`Field "${key}" must be at most ${prop.maximum}`);
            }
          }
          break;
        case 'boolean':
          if (typeof val !== 'boolean') {
            errors.push(`Field "${key}" must be a boolean`);
          }
          break;
        case 'array':
          if (!Array.isArray(val)) {
            errors.push(`Field "${key}" must be an array`);
          }
          break;
        case 'object':
          if (typeof val !== 'object' || Array.isArray(val)) {
            errors.push(`Field "${key}" must be an object`);
          }
          break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (!tool || typeof tool.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.id)) {
      throw new Error(`Invalid tool ID: ${tool?.id}. Tool ID must be 1-64 alphanumeric characters, underscores or hyphens.`);
    }
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered with ID: "${tool.id}"`);
    }
    if (!tool.name || typeof tool.name !== 'string') {
      throw new Error(`Tool "${tool.id}" must have a valid name`);
    }
    if (!tool.description || typeof tool.description !== 'string') {
      throw new Error(`Tool "${tool.id}" missing description`);
    }
    if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
      throw new Error(`Tool "${tool.id}" must have a valid object inputSchema`);
    }
    if (typeof tool.execute !== 'function') {
      throw new Error(`Tool "${tool.id}" must have an execute function`);
    }
    PermissionLevelEnum.parse(tool.permissionLevel);
    ToolCategoryEnum.parse(tool.category);
    this.tools.set(tool.id, tool);
  }

  unregister(id: string): boolean {
    return this.tools.delete(id);
  }

  get(id: string): AgentTool | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  list(filter?: { category?: ToolCategory; permissionLevel?: PermissionLevel }): AgentTool[] {
    let result = Array.from(this.tools.values());
    if (filter?.category) {
      result = result.filter(t => t.category === filter.category);
    }
    if (filter?.permissionLevel) {
      result = result.filter(t => t.permissionLevel === filter.permissionLevel);
    }
    return result;
  }

  validate(toolId: string, input: unknown): { valid: boolean; errors: string[] } {
    const tool = this.get(toolId);
    if (!tool) {
      return { valid: false, errors: [`Tool "${toolId}" is not registered`] };
    }
    return validateAgainstSchema(tool.inputSchema, input ?? {});
  }

  async execute(toolId: string, input: unknown, context: AgentToolContext): Promise<AgentToolResult> {
    const tool = this.get(toolId);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${toolId}" is not registered or not available.`
      };
    }

    if (context.signal?.aborted || !['READ_ONLY','AUTO_EXECUTE'].includes(tool.permissionLevel)) return {success:false,error:'Tool execution is not authorized'};
    if (JSON.stringify(input ?? {}).length > 8192) return {success:false,error:'Tool input exceeds maximum size'};
    const validation = validateAgainstSchema(tool.inputSchema, input ?? {});
    if (!validation.valid) {
      return {
        success: false,
        error: `Validation error for tool "${toolId}": ${validation.errors.join('; ')}`
      };
    }

    try {
      const result = await tool.execute(input ?? {}, context);
      return result;
    } catch (err: any) {
      return {
        success: false,
        error: 'Tool execution failed'
      };
    }
  }

  clear(): void {
    this.tools.clear();
  }
}

export const defaultToolRegistry = new ToolRegistry();
