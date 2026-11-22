import { randomBytes } from 'node:crypto';
import type { AgentTool, AgentToolContext, AgentToolResult } from '../types.js';

export interface ReferenceIdInput {
  prefix?: string;
  type?: 'alphanumeric' | 'numeric' | 'hex';
  length?: number;
}

const CHARSETS = {
  alphanumeric: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', // Exclude visually ambiguous characters 0, 1, I, O
  numeric: '0123456789',
  hex: '0123456789ABCDEF'
};

function generateRandomString(charset: string, length: number): string {
  const bytes = randomBytes(length * 2);
  let result = '';
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const idx = bytes[i] % charset.length;
    result += charset[idx];
  }
  return result;
}

export const referenceIdTool: AgentTool = {
  id: 'generate_reference_id',
  name: 'Generate Reference ID',
  description: 'Generates a unique, cryptographically secure reference, ticket, or confirmation ID (e.g., REF-7X8K2P, TCK-982134) for quotes, inquiries, orders, or support requests.',
  category: 'UTILITY',
  permissionLevel: 'AUTO_EXECUTE',
  inputSchema: {
    type: 'object',
    properties: {
      prefix: {
        type: 'string',
        description: "Prefix code for the reference ID (e.g. 'REF', 'TICK', 'ORD', 'STARLI'). Max 12 characters. Defaults to 'REF'."
      },
      type: {
        type: 'string',
        enum: ['alphanumeric', 'numeric', 'hex'],
        description: "Character set style: 'alphanumeric' (uppercase letters & numbers), 'numeric' (digits only), 'hex' (hexadecimal). Defaults to 'alphanumeric'."
      },
      length: {
        type: 'number',
        description: 'Length of the random suffix (between 4 and 20). Defaults to 6.'
      }
    }
  },
  async execute(input: ReferenceIdInput, _context: AgentToolContext): Promise<AgentToolResult> {
    const rawPrefix = (input.prefix && input.prefix.trim()) || 'REF';
    const sanitizedPrefix = rawPrefix.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
    const type = input.type || 'alphanumeric';
    const length = Math.min(20, Math.max(4, input.length || 6));

    const charset = CHARSETS[type] || CHARSETS.alphanumeric;
    const randomSuffix = generateRandomString(charset, length);
    const referenceId = sanitizedPrefix ? `${sanitizedPrefix}-${randomSuffix}` : randomSuffix;

    return {
      success: true,
      data: {
        referenceId,
        prefix: sanitizedPrefix,
        type,
        length,
        createdAt: new Date().toISOString()
      },
      summary: `Generated reference ID: ${referenceId}`
    };
  }
};
