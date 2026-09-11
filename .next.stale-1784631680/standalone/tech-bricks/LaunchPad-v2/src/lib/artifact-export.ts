/**
 * Per-artifact export (changelog 17/06 item 11): let the founder download each
 * individual output in an editable format — CSV for tabular artifacts
 * (comparison-table, metric-grid) so they open in Excel/Sheets, JSON otherwise.
 * Pure (no React/DOM) so it's testable + importable anywhere; the button
 * component handles the actual Blob download.
 */

import type { Artifact } from '@/types/artifacts';

export interface ArtifactExport {
  filename: string;
  mime: string;
  text: string;
}

/**
 * CSV cell. Two concerns:
 *  - Formula injection (CWE-1236): a leading =,+,-,@,TAB,CR makes Excel/Sheets
 *    EXECUTE the cell. These artifacts carry agent/web-sourced text (competitor
 *    names, research snippets) which is untrusted, so prefix such free-text
 *    cells with an apostrophe. Genuine numbers (incl. negatives/decimals) are
 *    left intact so they stay numeric.
 *  - RFC-4180 quoting: wrap when the value contains a comma, quote, or newline.
 */
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  const isNumeric = /^-?\d+(\.\d+)?$/.test(s.trim());
  if (!isNumeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function slug(s: string): string {
  return (s || 'artifact').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase().slice(0, 60) || 'artifact';
}

/**
 * Build a downloadable export for an artifact, or null if it isn't a meaningful
 * "output" to export (interactive cards like option-set / proposals).
 */
export function buildArtifactExport(artifact: Artifact): ArtifactExport | null {
  const a = artifact as Artifact & { title?: string };
  const base = slug(a.title || artifact.type);

  switch (artifact.type) {
    case 'comparison-table': {
      const rows: unknown[][] = [['', ...artifact.columns]];
      for (const r of artifact.rows) rows.push([r.label, ...r.values]);
      return { filename: `${base}.csv`, mime: 'text/csv', text: toCsv(rows) };
    }
    case 'metric-grid': {
      const rows: unknown[][] = [['Metric', 'Value', 'Change']];
      for (const m of artifact.metrics) rows.push([m.label, m.value, m.change ?? '']);
      return { filename: `${base}.csv`, mime: 'text/csv', text: toCsv(rows) };
    }
    // Interactive / non-data cards — nothing useful to export.
    case 'option-set':
    case 'action-suggestion':
    case 'monitor-proposal':
    case 'budget-proposal':
    case 'validation-proposal':
    case 'solve-progress':
      return null;
    // Everything else (charts, score, persona, tam-sam-som, …): editable JSON.
    default:
      return { filename: `${base}.json`, mime: 'application/json', text: JSON.stringify(artifact, null, 2) };
  }
}
