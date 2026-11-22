/**
 * Neutralizes spreadsheet formula injection (CSV Injection / Formula Injection).
 * Any cell value starting with =, +, -, @, tab, or carriage return is prefixed with a single quote.
 */
export function sanitizeCsvField(value: any): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return str;
}

/**
 * Encodes an array of rows to a CSV string, with proper quoting and formula injection prevention.
 */
export function toCsvString(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const sanitizeCell = (cell: any): string => {
    const sanitized = sanitizeCsvField(cell);
    const escaped = sanitized.replace(/"/g, '""');
    if (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"') || escaped.includes(';')) {
      return `"${escaped}"`;
    }
    return escaped;
  };

  const lines = [
    headers.map(sanitizeCell).join(','),
    ...rows.map(row => row.map(sanitizeCell).join(','))
  ];
  return lines.join('\r\n');
}

/**
 * Parses a CSV string into headers and array of records.
 * Handles quoted cells with escaped quotes and commas.
 */
export function parseCsvString(csvContent: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[] = [];
  let currentLine = '';
  let insideQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentLine += '"';
        i++; // skip next quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if ((char === '\r' && nextChar === '\n') && !insideQuotes) {
      lines.push(currentLine);
      currentLine = '';
      i++; // skip \n
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      lines.push(currentLine);
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(cell.trim());
        cell = '';
      } else {
        cell += char;
      }
    }
    cells.push(cell.trim());
    return cells;
  };

  const rawHeaders = lines.length > 0 ? parseLine(lines[0]) : [];
  const headers = rawHeaders.map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase());

  const records: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;
    const cells = parseLine(lines[i]);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      let val = cells[idx] || '';
      // Sanitize potential formula injections in imported data
      val = sanitizeCsvField(val);
      record[h] = val;
    });
    records.push(record);
  }

  return { headers, rows: records };
}

export function normalizeDomain(domainOrUrl?: string | null): string | null {
  if (!domainOrUrl) return null;
  let str = domainOrUrl.trim().toLowerCase();
  str = str.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '');
  str = str.split('/')[0];
  str = str.split(':')[0];
  return str.length > 0 ? str : null;
}

export function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const str = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str) ? str : null;
}
