import { dateTimeTool } from './datetime.js';
import { calculatorTool } from './calculator.js';
import { contactValidatorTool } from './contact-validator.js';
import { referenceIdTool } from './reference-id.js';
import type { ToolRegistry } from '../registry.js';

export {
  dateTimeTool,
  calculatorTool,
  contactValidatorTool,
  referenceIdTool
};

export const UNIVERSAL_TOOLS = [
  dateTimeTool,
  calculatorTool,
  contactValidatorTool,
  referenceIdTool
] as const;

export const DEFAULT_UNIVERSAL_TOOL_IDS = [
  dateTimeTool.id,
  calculatorTool.id,
  contactValidatorTool.id,
  referenceIdTool.id
] as const;

export function registerUniversalTools(registry: ToolRegistry): void {
  for (const tool of UNIVERSAL_TOOLS) {
    if (!registry.has(tool.id)) {
      registry.register(tool);
    }
  }
}
