import type { AgentTool } from './types.js';

export interface OpenAIFunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface OpenAIToolDefinition {
  type: 'function';
  function: OpenAIFunctionDefinition;
}

export function toOpenAIFunction(tool: AgentTool): OpenAIFunctionDefinition {
  return {
    name: tool.id,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: tool.inputSchema.properties || {},
      ...(tool.inputSchema.required && tool.inputSchema.required.length > 0
        ? { required: [...tool.inputSchema.required] }
        : {}),
      ...(tool.inputSchema.additionalProperties !== undefined
        ? { additionalProperties: tool.inputSchema.additionalProperties }
        : {})
    }
  };
}

export function toOpenAITool(tool: AgentTool): OpenAIToolDefinition {
  return {
    type: 'function',
    function: toOpenAIFunction(tool)
  };
}

export function toOpenAITools(tools: AgentTool[]): OpenAIToolDefinition[] {
  return tools.map(toOpenAITool);
}
