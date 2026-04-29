/**
 * Structural Diff — clean-room utility for comparing JSON-serializable values.
 *
 * Produces typed change records (`added`, `removed`, `changed`) with dot-path
 * notation, giving the LLM precise field-level diffs instead of raw text.
 *
 * Usage:
 *   structuralDiff(oldObj, newObj)                      // positional array diff
 *   structuralDiff(oldArr, newArr, { keyBy: 'id' })     // keyed array diff
 */

export interface DiffEntry {
  path: string;
  type: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
}

export interface DiffOptions {
  /** Key field name for matching array elements (avoids order-sensitivity). */
  keyBy?: string;
  /** Maximum depth to recurse (default 10). */
  maxDepth?: number;
}

export function structuralDiff(
  oldVal: unknown,
  newVal: unknown,
  options: DiffOptions = {},
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const maxDepth = options.maxDepth ?? 10;

  function walk(a: unknown, b: unknown, path: string, depth: number): void {
    if (depth > maxDepth) return;

    // Same value (or both null/undefined)
    if (a === b) return;
    if (a == null && b == null) return;

    // One side missing
    if (a == null) {
      entries.push({ path: path || '$', type: 'added', newValue: b });
      return;
    }
    if (b == null) {
      entries.push({ path: path || '$', type: 'removed', oldValue: a });
      return;
    }

    // Different types → treat as changed primitive
    if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
      entries.push({ path: path || '$', type: 'changed', oldValue: a, newValue: b });
      return;
    }

    // Arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      diffArrays(a, b, path, depth);
      return;
    }

    // Objects
    if (typeof a === 'object' && typeof b === 'object') {
      const aObj = a as Record<string, unknown>;
      const bObj = b as Record<string, unknown>;
      const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
      for (const key of allKeys) {
        const childPath = path ? `${path}.${key}` : key;
        if (!(key in aObj)) {
          entries.push({ path: childPath, type: 'added', newValue: bObj[key] });
        } else if (!(key in bObj)) {
          entries.push({ path: childPath, type: 'removed', oldValue: aObj[key] });
        } else {
          walk(aObj[key], bObj[key], childPath, depth + 1);
        }
      }
      return;
    }

    // Primitives that differ
    if (a !== b) {
      entries.push({ path: path || '$', type: 'changed', oldValue: a, newValue: b });
    }
  }

  function diffArrays(a: unknown[], b: unknown[], path: string, depth: number): void {
    const keyField = options.keyBy;

    // If keyBy is set and elements are objects, match by key
    if (keyField && a.length > 0 && typeof a[0] === 'object' && a[0] !== null) {
      const aMap = new Map<string, unknown>();
      const bMap = new Map<string, unknown>();
      for (const item of a) {
        const key = String((item as Record<string, unknown>)[keyField] ?? '');
        if (key) aMap.set(key, item);
      }
      for (const item of b) {
        const key = String((item as Record<string, unknown>)[keyField] ?? '');
        if (key) bMap.set(key, item);
      }
      for (const [key, val] of aMap) {
        const childPath = `${path}[${key}]`;
        if (!bMap.has(key)) {
          entries.push({ path: childPath, type: 'removed', oldValue: val });
        } else {
          walk(val, bMap.get(key), childPath, depth + 1);
        }
      }
      for (const [key, val] of bMap) {
        if (!aMap.has(key)) {
          entries.push({ path: `${path}[${key}]`, type: 'added', newValue: val });
        }
      }
      return;
    }

    // Positional comparison
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const childPath = `${path}[${i}]`;
      if (i >= a.length) {
        entries.push({ path: childPath, type: 'added', newValue: b[i] });
      } else if (i >= b.length) {
        entries.push({ path: childPath, type: 'removed', oldValue: a[i] });
      } else {
        walk(a[i], b[i], childPath, depth + 1);
      }
    }
  }

  walk(oldVal, newVal, '', 0);
  return entries;
}

/**
 * Format diff entries as a concise human-readable summary for LLM context.
 * Truncates values to keep the output compact.
 */
export function formatDiffForLLM(entries: DiffEntry[], maxEntries = 30): string {
  if (entries.length === 0) return '';

  const lines: string[] = [];
  const shown = entries.slice(0, maxEntries);

  for (const e of shown) {
    const trunc = (v: unknown): string => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.length > 80 ? s.slice(0, 77) + '...' : s;
    };

    switch (e.type) {
      case 'added':
        lines.push(`+ ${e.path}: ${trunc(e.newValue)}`);
        break;
      case 'removed':
        lines.push(`- ${e.path}: ${trunc(e.oldValue)}`);
        break;
      case 'changed':
        lines.push(`~ ${e.path}: ${trunc(e.oldValue)} → ${trunc(e.newValue)}`);
        break;
    }
  }

  if (entries.length > maxEntries) {
    lines.push(`... and ${entries.length - maxEntries} more changes`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown table → array-of-objects parser
// ---------------------------------------------------------------------------

/**
 * Extract the first markdown table from content and parse it into an array
 * of objects keyed by header names. Returns null if no valid table is found.
 */
export function parseMarkdownTable(markdown: string): Record<string, string>[] | null {
  // Match table: header row, separator row, then data rows
  const tableRegex = /^\|(.+)\|\s*\n\|[-\s|:]+\|\s*\n((?:\|.+\|\s*\n?)+)/m;
  const match = markdown.match(tableRegex);
  if (!match) return null;

  const headerLine = match[1];
  const bodyBlock = match[2];

  const headers = headerLine.split('|').map((h) => h.trim()).filter(Boolean);
  if (headers.length === 0) return null;

  const rows: Record<string, string>[] = [];
  const dataLines = bodyBlock.trim().split('\n');

  for (const line of dataLines) {
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cells[i] ?? '';
    }
    rows.push(row);
  }

  return rows.length > 0 ? rows : null;
}

/**
 * Extract JSON-LD blocks from markdown/HTML content.
 * Returns the first valid parsed JSON-LD object, or null.
 */
export function extractJsonLd(content: string): unknown | null {
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    try {
      return JSON.parse(match[1]);
    } catch {
      // try next block
    }
  }
  return null;
}
