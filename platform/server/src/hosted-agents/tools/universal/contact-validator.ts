import type { AgentTool, AgentToolContext, AgentToolResult } from '../types.js';

export interface ContactValidatorInput {
  email?: string;
  phone?: string;
  countryCode?: string;
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function validateEmail(raw: string): { valid: boolean; normalized?: string; error?: string } {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'Email must be a non-empty string' };
  }

  const trimmed = raw.trim();
  if (trimmed.length > 254) {
    return { valid: false, error: 'Email address exceeds maximum length of 254 characters' };
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: 'Invalid email address syntax' };
  }

  // Reject consecutive dots or invalid domain labels
  const parts = trimmed.split('@');
  if (parts.length !== 2) {
    return { valid: false, error: 'Email must contain exactly one "@" symbol' };
  }

  const [local, domain] = parts;
  if (local.length > 64) {
    return { valid: false, error: 'Email local part exceeds 64 characters' };
  }

  if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
    return { valid: false, error: 'Email domain has invalid dot placement' };
  }

  return {
    valid: true,
    normalized: trimmed.toLowerCase()
  };
}

export function validateAndNormalizePhone(
  raw: string,
  countryHint = 'RO'
): {
  valid: boolean;
  e164?: string;
  formatted?: string;
  country?: string;
  error?: string;
} {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'Phone must be a non-empty string' };
  }

  const trimmed = raw.trim();
  // Strip spaces, dashes, periods, parentheses
  const cleaned = trimmed.replace(/[\s\-_().]/g, '');

  if (!cleaned) {
    return { valid: false, error: 'Phone contains no digits' };
  }

  const country = (countryHint || 'RO').toUpperCase();

  // Romania (+40) handling
  if (country === 'RO' || cleaned.startsWith('+40') || cleaned.startsWith('0040')) {
    let digits = cleaned;
    if (digits.startsWith('+40')) {
      digits = digits.slice(3);
    } else if (digits.startsWith('0040')) {
      digits = digits.slice(4);
    } else if (digits.startsWith('40') && digits.length === 11) {
      digits = digits.slice(2);
    } else if (digits.startsWith('0')) {
      digits = digits.slice(1);
    }

    // Romanian mobile (7xx xxx xxx) or landline (2xx / 3xx)
    if (/^[237]\d{8}$/.test(digits)) {
      const e164 = `+40${digits}`;
      const formatted = `+40 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
      return {
        valid: true,
        e164,
        formatted,
        country: 'RO'
      };
    }

    if (country === 'RO') {
      return {
        valid: false,
        error: `Invalid Romanian phone number format. Expected 10 digits (e.g. 07xx xxx xxx) or international (+40 7xx xxx xxx).`
      };
    }
  }

  // General E.164 international check (starts with + followed by 7 to 15 digits)
  if (cleaned.startsWith('+')) {
    const digitsOnly = cleaned.slice(1);
    if (/^\d{7,15}$/.test(digitsOnly)) {
      return {
        valid: true,
        e164: cleaned,
        formatted: cleaned,
        country: country !== 'RO' ? country : 'INTERNATIONAL'
      };
    }
    return {
      valid: false,
      error: 'International phone numbers in E.164 format must have between 7 and 15 digits after "+"'
    };
  }

  // US/Canada default check if hinted
  if (country === 'US' || country === 'CA') {
    let digits = cleaned.replace(/^\+?1/, '');
    if (/^\d{10}$/.test(digits)) {
      return {
        valid: true,
        e164: `+1${digits}`,
        formatted: `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
        country
      };
    }
    return {
      valid: false,
      error: `Invalid North American phone number. Expected 10 digits (e.g. 555-123-4567).`
    };
  }

  // Generic 7-15 digits fallback if raw digits
  if (/^\d{7,15}$/.test(cleaned)) {
    return {
      valid: true,
      e164: `+${cleaned}`,
      formatted: `+${cleaned}`,
      country: 'INTERNATIONAL'
    };
  }

  return {
    valid: false,
    error: `Unrecognized phone number format: "${raw}". Please provide digits or standard international format with country code.`
  };
}

export const contactValidatorTool: AgentTool = {
  id: 'validate_contact_information',
  name: 'Validate Contact Information',
  description: 'Validates and normalizes email addresses and phone numbers. Supports international numbers and Romanian local numbers (+40 / 07xx). Checks syntax and returns normalized canonical values.',
  category: 'COMMUNICATION',
  permissionLevel: 'READ_ONLY',
  inputSchema: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: 'Email address to validate (e.g. "contact@company.ro")'
      },
      phone: {
        type: 'string',
        description: 'Phone number to validate and normalize (e.g. "0721234567", "+40 721 234 567")'
      },
      countryCode: {
        type: 'string',
        description: 'Country code hint for local phone parsing (e.g. "RO", "US", "GB"). Defaults to "RO".'
      }
    }
  },
  async execute(input: ContactValidatorInput, _context: AgentToolContext): Promise<AgentToolResult> {
    if (!input.email && !input.phone) {
      return {
        success: false,
        error: 'At least one of "email" or "phone" must be provided for validation.'
      };
    }

    const errors: string[] = [];
    let emailResult: ReturnType<typeof validateEmail> | undefined;
    let phoneResult: ReturnType<typeof validateAndNormalizePhone> | undefined;

    if (input.email !== undefined && input.email !== null) {
      emailResult = validateEmail(input.email);
      if (!emailResult.valid && emailResult.error) {
        errors.push(`Email error: ${emailResult.error}`);
      }
    }

    if (input.phone !== undefined && input.phone !== null) {
      phoneResult = validateAndNormalizePhone(input.phone, input.countryCode);
      if (!phoneResult.valid && phoneResult.error) {
        errors.push(`Phone error: ${phoneResult.error}`);
      }
    }

    const allValid = (!emailResult || emailResult.valid) && (!phoneResult || phoneResult.valid);

    return {
      success: true,
      data: {
        valid: allValid,
        email: emailResult
          ? {
              provided: input.email,
              valid: emailResult.valid,
              normalized: emailResult.normalized,
              error: emailResult.error
            }
          : undefined,
        phone: phoneResult
          ? {
              provided: input.phone,
              valid: phoneResult.valid,
              e164: phoneResult.e164,
              formatted: phoneResult.formatted,
              country: phoneResult.country,
              error: phoneResult.error
            }
          : undefined,
        errors
      },
      summary: allValid
        ? 'Contact information is valid and normalized.'
        : `Contact information validation issues: ${errors.join(', ')}`
    };
  }
};
