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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/api';
import {
  computeFinancialModel,
  coerceAssumptions,
  defaultAssumptions,
  type FinancialAssumptions,
} from '@/lib/financial-projection';
import { buildFinancialExport } from '@/lib/financial-export';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import type { ApiResponse } from '@/types';

// Labels/suffixes are i18n keys, resolved via useT() at render — the whole
// Financials page shipped hardcoded EN on Italian projects (alpha feedback
// 21/07). Literal suffixes ('€', '%') are locale-neutral and stay inline.
type FieldDef = { key: keyof FinancialAssumptions; label: MessageKey; suffix?: MessageKey | '€' | '%'; step?: number };
const FIELDS: FieldDef[] = [
  { key: 'starting_cash', label: 'fin.f-starting-cash', suffix: '€' },
  { key: 'monthly_opex', label: 'fin.f-monthly-opex', suffix: 'fin.sfx-eur-month' },
  { key: 'arpu_monthly', label: 'fin.f-arpu', suffix: 'fin.sfx-eur-month' },
  { key: 'gross_margin_pct', label: 'fin.f-gross-margin', suffix: '%' },
  { key: 'initial_customers', label: 'fin.f-starting-customers' },
  { key: 'new_customers_m1', label: 'fin.f-new-customers' },
  { key: 'monthly_growth_rate_pct', label: 'fin.f-growth', suffix: 'fin.sfx-pct-month' },
  { key: 'monthly_churn_rate_pct', label: 'fin.f-churn', suffix: '%' },
  { key: 'horizon_months', label: 'fin.f-horizon', suffix: 'fin.sfx-months' },
];

// Scenario display names by engine key — the engine's own `label` stays EN.
const SCENARIO_KEY: Record<string, MessageKey> = {
  base: 'fin.scenario-base',
  optimistic: 'fin.scenario-optimistic',
  pessimistic: 'fin.scenario-pessimistic',
};

const TABLE_HEADERS: MessageKey[] = [
  'fin.th-mo', 'fin.th-new', 'fin.th-churn', 'fin.th-customers', 'fin.th-mrr', 'fin.th-revenue',
  'fin.th-cogs', 'fin.th-opex', 'fin.th-burn', 'fin.th-cash', 'fin.th-runway',
];

function money(n: number, cur = 'EUR'): string {
  const sym = cur === 'USD' ? '$' : '€';
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
    : abs >= 1_000 ? `${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`
    : `${Math.round(abs)}`;
  return `${n < 0 ? '−' : ''}${sym}${s}`;
}

interface FinancialModelResponse {
  financial_model: { assumptions?: unknown; generated_at?: string } | null;
  derived?: { assumptions: Partial<FinancialAssumptions>; provenance: Record<string, string> } | null;
}

export default function FinancialModelPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const t = useT();
  const [assumptions, setAssumptions] = useState<FinancialAssumptions>(defaultAssumptions());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Per-field source labels when assumptions were SEEDED from project evidence
  // (e.g. ARPU from the Idea Canvas) rather than typed by the founder.
  const [provenance, setProvenance] = useState<Record<string, string>>({});

  // Cached via TanStack under the 'financial' topic so revisiting the tab is
  // instant. Editable state below is SEEDED from this query (guarded on !dirty),
  // never bound to it — so an in-progress edit survives a tab switch.
  const { data: stored, isLoading: loading } = useQuery<FinancialModelResponse | null>({
    queryKey: ['financial', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      try {
        const { data: resp } = await api.get<ApiResponse<FinancialModelResponse>>(
          `/api/projects/${projectId}/financial-model`,
        );
        return resp?.data ?? null;
      } catch {
        return null; // no model yet — defaults
      }
    },
  });

  // Seed the editable assumptions from the stored model (or project-derived
  // evidence) once loaded. The !dirty guard is the whole point: if the founder
  // has unsaved edits, a re-seed (e.g. after navigating back) must not clobber
  // them. save() updates the cache before clearing dirty, so this re-run lands
  // on the just-saved values rather than reverting.
  useEffect(() => {
    if (loading || dirty) return;
    const model = stored?.financial_model;
    const derived = stored?.derived;
    if (model && model.assumptions) {
      setAssumptions(coerceAssumptions(model.assumptions));
      setSavedAt(model.generated_at ?? null);
    } else if (derived?.assumptions && Object.keys(derived.assumptions).length > 0) {
      setAssumptions(coerceAssumptions({ ...defaultAssumptions(), ...derived.assumptions }));
      setProvenance(derived.provenance || {});
    }
  }, [stored, loading, dirty]);

  // LIVE recompute — pure, instant, runs on every edit.
  const model = useMemo(() => computeFinancialModel(assumptions), [assumptions]);
  const cur = assumptions.currency;

  function setField(key: keyof FinancialAssumptions, raw: string) {
    const v = key === 'currency' ? raw : Number(raw);
    setAssumptions((a) => ({ ...a, [key]: v as never }));
    setDirty(true);
    // The founder just typed this value — it's no longer "from the canvas".
    setProvenance((p) => {
      if (!p[key as string]) return p;
      const next = { ...p }; delete next[key as string]; return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      await api.post(`/api/projects/${projectId}/financial-model`, { assumptions });
      const generatedAt = new Date().toISOString();
      // Write the saved model into the cache BEFORE clearing dirty so the
      // seed effect re-runs against fresh data (no revert flash), and so other
      // mounts of this query see the new values without a network round-trip.
      qc.setQueryData<FinancialModelResponse | null>(['financial', projectId], (prev) => ({
        ...(prev ?? { derived: null }),
        financial_model: { assumptions, generated_at: generatedAt },
      }));
      setSavedAt(generatedAt);
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
    return <div className="flex items-center justify-center flex-1 text-ink-5 text-sm">{t('fin.loading')}</div>;
  }

  const baseMonths = model.scenarios.find((s) => s.key === 'base')!.monthly_projections;

  return (
    <div className="lp-rise flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto" data-tour="financial-model">
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-lg font-semibold text-ink">{t('fin.title')}</h3>
          <span className="text-[11px] text-ink-5">{t('fin.subtitle')}</span>
        </div>
        <p className="text-xs text-ink-4 mb-2">{t('fin.hint')}</p>
        {Object.keys(provenance).length > 0 && !savedAt && (
          <p className="text-[11px] text-accent mb-6">{t('fin.seeded')}</p>
        )}

        {/* Editable assumptions */}
        <div className="bg-paper border border-line rounded-xl p-4 mb-6">
          <div className="text-xs text-ink-4 uppercase tracking-wider mb-3">{t('fin.assumptions')}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {FIELDS.map((f) => {
              const suffix = f.suffix === '€' || f.suffix === '%' ? f.suffix : f.suffix ? t(f.suffix) : '';
              return (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-4">{t(f.label)}{suffix ? ` (${suffix})` : ''}</span>
                <input
                  type="number"
                  value={String(assumptions[f.key] as number)}
                  onChange={(e) => setField(f.key, e.target.value)}
                  className="bg-surface border border-line-2 rounded px-2 py-1.5 text-sm text-ink outline-none focus:border-ink-4"
                />
                {provenance[f.key as string] && (
                  <span className="text-[10px] text-accent truncate" title={provenance[f.key as string]}>
                    ↳ {provenance[f.key as string]}
                  </span>
                )}
              </label>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="text-xs px-3 py-1.5 bg-ink text-paper rounded-md disabled:opacity-50"
            >
              {saving ? t('fin.saving') : dirty ? t('fin.save') : t('fin.saved')}
            </button>
            <button
              type="button"
              onClick={download}
              className="text-xs px-3 py-1.5 bg-paper-3 hover:bg-paper-2 text-ink-2 rounded-md"
            >
              {t('fin.download')}
            </button>
            {savedAt && !dirty && <span className="text-[11px] text-ink-5">{t('fin.saved-tag')}</span>}
          </div>
        </div>

        {/* Scenario summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {model.scenarios.map((s) => {
            const y3 = s.year_summaries[s.year_summaries.length - 1];
            return (
              <div key={s.key} className="bg-paper border border-line rounded-xl p-4">
                <div className="text-xs text-ink-4 uppercase tracking-wider mb-2">{SCENARIO_KEY[s.key] ? t(SCENARIO_KEY[s.key]) : s.label}</div>
                <div className="text-2xl font-bold text-ink">{money(y3?.arr ?? 0, cur)}<span className="text-sm font-medium text-ink-4"> {t('fin.arr-y', { y: y3?.year ?? 3 })}</span></div>
                <div className="mt-2 space-y-1 text-[12px] text-ink-3">
                  <div>{t('fin.breakeven')} <span className="text-ink">{s.breakeven_month ? t('fin.month-n', { n: s.breakeven_month }) : t('fin.beyond-horizon')}</span></div>
                  <div>{t('fin.peak-cash')} <span className="text-ink">{money(s.peak_cash_need, cur)}</span></div>
                  <div>{t('fin.ending-cash')} <span className="text-ink">{money(s.ending_cash, cur)}</span></div>
                  <div>{t('fin.end-customers')} <span className="text-ink">{(y3?.ending_customers ?? 0).toLocaleString()}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Base monthly table */}
        <div className="bg-paper border border-line rounded-xl overflow-hidden">
          <div className="text-xs text-ink-4 uppercase tracking-wider px-4 py-3 border-b border-line">{t('fin.base-monthly')}</div>
          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-surface-sunk text-ink-4">
                <tr>
                  {TABLE_HEADERS.map((h) => (
                    <th key={h} className="text-right font-medium px-3 py-2 whitespace-nowrap first:text-left">{t(h)}</th>
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
                    <td className="text-right px-3 py-1.5 text-ink-4">{r.runway_months === null ? '∞' : `${r.runway_months}${t('fin.mo-suffix')}`}</td>
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
