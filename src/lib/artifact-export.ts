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


// ═════════════════════════════════════════════════════════════════════════════
// Text-document export (#390, changelog 4/08): "il download di ogni singolo
// artifact avviene in formato json. Possiamo proporlo anche in pdf/documento
// di testo?" JSON is for machines; the founder forwards these to co-founders
// and advisors. Markdown IS the "documento di testo" (opens everywhere, pastes
// clean into Notion/Docs/mail), and the PDF path renders the same markdown
// into a print window — the browser's "save as PDF" does the rest, zero deps.
// ═════════════════════════════════════════════════════════════════════════════

function mdEscapePipes(v: unknown): string {
  return String(v ?? '').replace(/\|/g, '\\|');
}

function titleCase(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Keys that are machinery, not content — never rendered into the document. */
const MD_SKIP_KEYS = new Set(['type', 'id', 'artifactId', 'maxScore']);

/**
 * Generic value → markdown lines. Deliberately TOTAL: any artifact shape
 * renders as a readable document rather than raw JSON, so a new artifact type
 * gets a usable export on day one and a curated one only when it earns it.
 */
function mdValue(value: unknown, depth: number): string[] {
  if (value == null || value === '') return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      if (item == null) continue;
      if (typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        // Sources get their canonical one-line form; other objects a dash block.
        if (typeof obj.url === 'string' || typeof obj.title === 'string') {
          const t = String(obj.title ?? obj.url ?? '');
          out.push(typeof obj.url === 'string' ? `- ${t} — ${obj.url}` : `- ${t}`);
        } else {
          const inner = Object.entries(obj)
            .filter(([k, v]) => !MD_SKIP_KEYS.has(k) && v != null && v !== '')
            .map(([k, v]) => `${titleCase(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
          if (inner.length) out.push(`- ${inner.join(' · ')}`);
        }
      } else {
        out.push(`- ${String(item)}`);
      }
    }
    return out;
  }
  // Nested object → sub-sections.
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (MD_SKIP_KEYS.has(k) || v == null || v === '') continue;
    const lines = mdValue(v, depth + 1);
    if (lines.length === 0) continue;
    if (lines.length === 1 && !lines[0].startsWith('-')) {
      out.push(`**${titleCase(k)}:** ${lines[0]}`);
    } else {
      out.push(`${'#'.repeat(Math.min(6, depth + 3))} ${titleCase(k)}`, '', ...lines, '');
    }
  }
  return out;
}

/** A readable text document for any exportable artifact — null for the same
 *  interactive cards buildArtifactExport skips. */
export function buildArtifactMarkdown(artifact: Artifact): ArtifactExport | null {
  if (buildArtifactExport(artifact) == null) return null;
  const a = artifact as Artifact & { title?: string; description?: string; sources?: unknown[] };
  const base = slug(a.title || artifact.type);
  const lines: string[] = [`# ${a.title || titleCase(artifact.type)}`, ''];

  switch (artifact.type) {
    case 'comparison-table': {
      lines.push(`| | ${artifact.columns.map(mdEscapePipes).join(' | ')} |`);
      lines.push(`|---${'|---'.repeat(artifact.columns.length)}|`);
      for (const r of artifact.rows) lines.push(`| ${mdEscapePipes(r.label)} | ${r.values.map(mdEscapePipes).join(' | ')} |`);
      lines.push('');
      break;
    }
    case 'metric-grid': {
      lines.push('| Metric | Value | Change |', '|---|---|---|');
      for (const m of artifact.metrics) lines.push(`| ${mdEscapePipes(m.label)} | ${mdEscapePipes(m.value)} | ${mdEscapePipes(m.change ?? '')} |`);
      lines.push('');
      break;
    }
    case 'score-card': {
      lines.push(`**${artifact.score}${artifact.maxScore ? ` / ${artifact.maxScore}` : ' / 100'}**`, '');
      if (artifact.description) lines.push(artifact.description, '');
      break;
    }
    default: {
      const rest: Record<string, unknown> = { ...(artifact as unknown as Record<string, unknown>) };
      for (const k of ['type', 'id', 'title', 'sources']) delete rest[k];
      lines.push(...mdValue(rest, 0));
    }
  }

  if (Array.isArray(a.sources) && a.sources.length > 0) {
    lines.push('', '## Sources', '', ...mdValue(a.sources, 0));
  }
  return { filename: `${base}.md`, mime: 'text/markdown', text: lines.join('\n').replace(/\n{3,}/g, '\n\n') };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Minimal markdown → print HTML. Escapes FIRST (artifact text is agent/web
 * sourced, i.e. untrusted), then converts only the constructs the builder
 * above emits: #/##/### headings, **bold**, dash bullets, pipe tables,
 * paragraphs. Not a general renderer, and deliberately so — every construct
 * added here is attack surface in a window we then ask the browser to print.
 */
export function markdownToPrintHtml(md: string, docTitle: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false, inTable = false;
  const closeAll = () => {
    if (inList) { out.push('</ul>'); inList = false; }
    if (inTable) { out.push('</table>'); inTable = false; }
  };
  const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeAll(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^\|/.test(line)) {
      if (/^\|[-| ]+\|$/.test(line)) continue; // separator row
      if (!inTable) { closeAll(); out.push('<table>'); inTable = true; }
      const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|');
      out.push(`<tr>${cells.map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr>`);
      continue;
    }
    if (/^- /.test(line)) {
      if (inTable) { out.push('</table>'); inTable = false; }
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeAll();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  closeAll();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(docTitle)}</title><style>
body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 24px;color:#1a1a1a;line-height:1.55}
h1{font-size:24px;border-bottom:1px solid #ddd;padding-bottom:8px}h2{font-size:17px;margin-top:28px}h3{font-size:14px}
table{border-collapse:collapse;margin:12px 0;font-size:13px}td{border:1px solid #ccc;padding:5px 10px}
ul{padding-left:20px}li,p{font-size:13.5px}
</style></head><body>${out.join('\n')}</body></html>`;
}
