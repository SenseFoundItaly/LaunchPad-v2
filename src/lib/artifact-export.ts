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

/** RFC-4180-ish CSV cell: quote when it contains a comma, quote, or newline. */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
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
