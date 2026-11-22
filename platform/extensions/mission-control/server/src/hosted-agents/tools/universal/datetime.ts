import type { AgentTool, AgentToolContext, AgentToolResult } from '../types.js';

export interface DateTimeInput {
  timezone?: string;
  format?: 'human' | 'iso' | 'date' | 'time';
}

function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const dateTimeTool: AgentTool = {
  id: 'get_current_datetime',
  name: 'Get Current Date & Time',
  description: 'Retrieves the current date and time in a specified IANA timezone (defaults to Europe/Bucharest). Useful for checking business hours, current day of week, scheduling, or real-time timestamps.',
  category: 'UTILITY',
  permissionLevel: 'READ_ONLY',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: "Valid IANA timezone name (e.g. 'Europe/Bucharest', 'America/New_York', 'UTC'). Defaults to 'Europe/Bucharest'."
      },
      format: {
        type: 'string',
        enum: ['human', 'iso', 'date', 'time'],
        description: "Desired output format: 'human' (e.g. Monday, 2 November 2026, 14:30), 'iso' (ISO-8601 string), 'date' (YYYY-MM-DD), or 'time' (HH:mm:ss). Defaults to 'human'."
      }
    }
  },
  async execute(input: DateTimeInput, context: AgentToolContext): Promise<AgentToolResult> {
    const tz = (input.timezone && input.timezone.trim()) || 'Europe/Bucharest';

    if (!isValidTimeZone(tz)) {
      return {
        success: false,
        error: `Invalid IANA timezone identifier: "${tz}". Examples of valid timezones: 'Europe/Bucharest', 'UTC', 'America/New_York', 'Europe/London'.`
      };
    }

    const format = input.format || 'human';
    // Use context clock or current Date
    const now = context.metadata?.timestamp ? new Date(context.metadata.timestamp) : new Date();

    try {
      const partsFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });

      const parts = partsFormatter.formatToParts(now);
      const partMap: Record<string, string> = {};
      for (const p of parts) {
        partMap[p.type] = p.value;
      }

      const isoDate = `${partMap.year}-${partMap.month}-${partMap.day}`;
      const timeStr = `${partMap.hour}:${partMap.minute}:${partMap.second}`;
      const weekday = partMap.weekday;

      let formattedOutput: string;
      switch (format) {
        case 'iso':
          formattedOutput = `${isoDate}T${timeStr} (${tz})`;
          break;
        case 'date':
          formattedOutput = isoDate;
          break;
        case 'time':
          formattedOutput = timeStr;
          break;
        case 'human':
        default:
          formattedOutput = `${weekday}, ${partMap.day}/${partMap.month}/${partMap.year} at ${timeStr} [${tz}]`;
          break;
      }

      return {
        success: true,
        data: {
          formatted: formattedOutput,
          timezone: tz,
          isoDate,
          time: timeStr,
          weekday,
          timestamp: now.getTime()
        },
        summary: `Current date and time in ${tz} is ${formattedOutput}`
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to format date for timezone "${tz}": ${err?.message || 'Unknown error'}`
      };
    }
  }
};
