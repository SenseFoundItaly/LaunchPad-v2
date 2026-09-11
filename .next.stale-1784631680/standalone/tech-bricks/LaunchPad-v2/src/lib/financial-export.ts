/**
 * Financial-model export (changelog 17/06 item 13): turn the stored
 * workflow.financial_model JSON into an editable download — CSV when it has a
 * recognizable projections/scenarios grid (opens in Excel/Sheets), JSON
 * otherwise. Defensive: the skill output shape varies (flat `projections[]` vs
 * per-scenario `monthly_projections[]`), so we handle both and fall back to JSON.
 */

export interface FinancialExport {
  filename: string;
  mime: string;
  text: string;
}

// CSV cell. Neutralize spreadsheet formula injection (CWE-1236): a leading
// =,+,-,@,TAB,CR makes Excel/Sheets execute the cell, and financial models can
// carry agent-sourced label text. Genuine numbers (incl. negative figures) are
// left intact. Then RFC-4180-quote on comma/quote/newline.
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  const isNumeric = /^-?\d+(\.\d+)?$/.test(s.trim());
  if (!isNumeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

type Row = Record<string, unknown>;
const isRowArray = (v: unknown): v is Row[] => Array.isArray(v) && v.every((x) => x && typeof x === 'object');

/** Build a downloadable financial export, or null if the model is empty. */
export function buildFinancialExport(model: unknown): FinancialExport | null {
  if (!model || typeof model !== 'object') return null;
  const m = model as Row;

  // Shape A — flat projections[] ({period, revenue, costs, profit}).
  if (isRowArray(m.projections) && m.projections.length > 0) {
    const cols = Object.keys(m.projections[0]);
    const rows: unknown[][] = [cols, ...m.projections.map((p) => cols.map((c) => p[c]))];
    return { filename: 'financial-model.csv', mime: 'text/csv', text: toCsv(rows) };
  }

  // Shape B — scenarios[] each with monthly_projections[] (or projections[]).
  if (isRowArray(m.scenarios) && m.scenarios.length > 0) {
    const out: unknown[][] = [];
    for (const sc of m.scenarios) {
      const name = (sc.name as string) || 'scenario';
      const months = (isRowArray(sc.monthly_projections) ? sc.monthly_projections
        : isRowArray(sc.projections) ? sc.projections : []) as Row[];
      if (months.length === 0) continue;
      const cols = Object.keys(months[0]);
      out.push([`# ${name}`]);
      out.push(cols);
      for (const mo of months) out.push(cols.map((c) => mo[c]));
      out.push([]); // blank separator between scenarios
    }
    if (out.length > 0) return { filename: 'financial-model.csv', mime: 'text/csv', text: toCsv(out) };
  }

  // Fallback — the full model as editable JSON.
  return { filename: 'financial-model.json', mime: 'application/json', text: JSON.stringify(model, null, 2) };
}
