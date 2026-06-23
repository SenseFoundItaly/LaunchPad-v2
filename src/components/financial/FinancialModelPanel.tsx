'use client';

/**
 * FinancialModelPanel — editable + downloadable financial projections.
 *
 * The founder edits a small set of ASSUMPTIONS; the full 36-month × 3-scenario
 * projection recomputes LIVE in the browser via the pure engine
 * (computeFinancialModel) — instant, no LLM, no cost. "Save" persists the
 * recomputed model (POST /financial-model → workflow.financial_model).
 * "Download CSV" exports it (buildFinancialExport). This closes changelog item
 * 13 ("financial projections should be downloadable + editable").
 */

import { useEffect, useMemo, useState } from 'react';
import api from '@/api';
import {
  computeFinancialModel,
  coerceAssumptions,
  defaultAssumptions,
  type FinancialAssumptions,
} from '@/lib/financial-projection';
import { buildFinancialExport } from '@/lib/financial-export';
import type { ApiResponse } from '@/types';

type FieldDef = { key: keyof FinancialAssumptions; label: string; suffix?: string; step?: number };
const FIELDS: FieldDef[] = [
  { key: 'starting_cash', label: 'Starting cash', suffix: '€' },
  { key: 'monthly_opex', label: 'Monthly opex', suffix: '€/mo' },
  { key: 'arpu_monthly', label: 'ARPU', suffix: '€/mo' },
  { key: 'gross_margin_pct', label: 'Gross margin', suffix: '%' },
  { key: 'initial_customers', label: 'Starting customers' },
  { key: 'new_customers_m1', label: 'New customers / mo (month 1)' },
  { key: 'monthly_growth_rate_pct', label: 'Acquisition growth', suffix: '%/mo' },
  { key: 'monthly_churn_rate_pct', label: 'Monthly churn', suffix: '%' },
  { key: 'horizon_months', label: 'Horizon', suffix: 'months' },
];

function money(n: number, cur = 'EUR'): string {
  const sym = cur === 'USD' ? '$' : '€';
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
    : abs >= 1_000 ? `${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`
    : `${Math.round(abs)}`;
  return `${n < 0 ? '−' : ''}${sym}${s}`;
}

export default function FinancialModelPanel({ projectId }: { projectId: string }) {
  const [assumptions, setAssumptions] = useState<FinancialAssumptions>(defaultAssumptions());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load the stored model's assumptions (or defaults) on mount.
  useEffect(() => {
    (async () => {
      try {
        const { data: resp } = await api.get<ApiResponse<{ financial_model: unknown }>>(
          `/api/projects/${projectId}/financial-model`,
        );
        const model = resp?.data?.financial_model as { assumptions?: unknown; generated_at?: string } | null;
        if (model && model.assumptions) {
          setAssumptions(coerceAssumptions(model.assumptions));
          setSavedAt(model.generated_at ?? null);
        }
      } catch { /* no model yet — defaults */ }
      setLoading(false);
    })();
  }, [projectId]);

  // LIVE recompute — pure, instant, runs on every edit.
  const model = useMemo(() => computeFinancialModel(assumptions), [assumptions]);
  const cur = assumptions.currency;

  function setField(key: keyof FinancialAssumptions, raw: string) {
    const v = key === 'currency' ? raw : Number(raw);
    setAssumptions((a) => ({ ...a, [key]: v as never }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await api.post(`/api/projects/${projectId}/financial-model`, { assumptions });
      setSavedAt(new Date().toISOString());
      setDirty(false);
    } catch { /* keep dirty so the founder can retry */ }
    setSaving(false);
  }

  function download() {
    const payload = buildFinancialExport(model);
    if (!payload) return;
    const blob = new Blob([payload.text], { type: payload.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financial-projections.${payload.mime.includes('csv') ? 'csv' : 'json'}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="flex items-center justify-center flex-1 text-ink-5 text-sm">Loading financial model…</div>;
  }

  const baseMonths = model.scenarios.find((s) => s.key === 'base')!.monthly_projections;

  return (
    <div className="lp-rise flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-lg font-semibold text-ink">Financial projections</h3>
          <span className="text-[11px] text-ink-5">36-month · 3-scenario · recomputes live as you edit</span>
        </div>
        <p className="text-xs text-ink-4 mb-6">
          Edit the assumptions — projections update instantly. <b>Save</b> persists them; <b>Download</b> opens in Excel/Sheets.
        </p>

        {/* Editable assumptions */}
        <div className="bg-paper border border-line rounded-xl p-4 mb-6">
          <div className="text-xs text-ink-4 uppercase tracking-wider mb-3">Assumptions</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-4">{f.label}{f.suffix ? ` (${f.suffix})` : ''}</span>
                <input
                  type="number"
                  value={String(assumptions[f.key] as number)}
                  onChange={(e) => setField(f.key, e.target.value)}
                  className="bg-surface border border-line-2 rounded px-2 py-1.5 text-sm text-ink outline-none focus:border-ink-4"
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="text-xs px-3 py-1.5 bg-ink text-paper rounded-md disabled:opacity-50"
            >
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
            <button
              type="button"
              onClick={download}
              className="text-xs px-3 py-1.5 bg-paper-3 hover:bg-paper-2 text-ink-2 rounded-md"
            >
              Download CSV
            </button>
            {savedAt && !dirty && <span className="text-[11px] text-ink-5">saved</span>}
          </div>
        </div>

        {/* Scenario summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {model.scenarios.map((s) => {
            const y3 = s.year_summaries[s.year_summaries.length - 1];
            return (
              <div key={s.key} className="bg-paper border border-line rounded-xl p-4">
                <div className="text-xs text-ink-4 uppercase tracking-wider mb-2">{s.label}</div>
                <div className="text-2xl font-bold text-ink">{money(y3?.arr ?? 0, cur)}<span className="text-sm font-medium text-ink-4"> ARR (Y{y3?.year ?? 3})</span></div>
                <div className="mt-2 space-y-1 text-[12px] text-ink-3">
                  <div>Breakeven: <span className="text-ink">{s.breakeven_month ? `month ${s.breakeven_month}` : 'beyond horizon'}</span></div>
                  <div>Peak cash need: <span className="text-ink">{money(s.peak_cash_need, cur)}</span></div>
                  <div>Ending cash: <span className="text-ink">{money(s.ending_cash, cur)}</span></div>
                  <div>End customers: <span className="text-ink">{(y3?.ending_customers ?? 0).toLocaleString()}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Base monthly table */}
        <div className="bg-paper border border-line rounded-xl overflow-hidden">
          <div className="text-xs text-ink-4 uppercase tracking-wider px-4 py-3 border-b border-line">Base scenario — monthly</div>
          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-surface-sunk text-ink-4">
                <tr>
                  {['Mo', 'New', 'Churn', 'Customers', 'MRR', 'Revenue', 'COGS', 'Opex', 'Net burn', 'Cash', 'Runway'].map((h) => (
                    <th key={h} className="text-right font-medium px-3 py-2 whitespace-nowrap first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {baseMonths.map((r) => (
                  <tr key={r.month} className="border-t border-line/60">
                    <td className="text-left px-3 py-1.5 text-ink-3">{r.month}</td>
                    <td className="text-right px-3 py-1.5">{r.new_customers}</td>
                    <td className="text-right px-3 py-1.5 text-ink-5">{r.churned_customers}</td>
                    <td className="text-right px-3 py-1.5 text-ink">{r.total_customers.toLocaleString()}</td>
                    <td className="text-right px-3 py-1.5">{money(r.mrr, cur)}</td>
                    <td className="text-right px-3 py-1.5">{money(r.revenue, cur)}</td>
                    <td className="text-right px-3 py-1.5 text-ink-5">{money(r.cogs, cur)}</td>
                    <td className="text-right px-3 py-1.5 text-ink-5">{money(r.opex, cur)}</td>
                    <td className={`text-right px-3 py-1.5 ${r.net_burn > 0 ? 'text-clay' : 'text-moss'}`}>{money(r.net_burn, cur)}</td>
                    <td className={`text-right px-3 py-1.5 ${r.cash_remaining < 0 ? 'text-clay' : 'text-ink'}`}>{money(r.cash_remaining, cur)}</td>
                    <td className="text-right px-3 py-1.5 text-ink-4">{r.runway_months === null ? '∞' : `${r.runway_months}mo`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
