'use client';

import Link from 'next/link';
import type { EcosystemAlertState } from '@/types';

/**
 * Ecosystem + Pending + Budget strip that sits at the top of the dashboard.
 * Pulls data from the extended /api/dashboard/{id} payload (top_ecosystem_alerts,
 * pending_decisions, pending_summary, budget). All three cards are
 * independent — each has its own link to the full-detail page.
 */

interface EcosystemAlertPreview {
  id: string;
  alert_type: string;
  headline: string;
  body: string | null;
  source_url: string | null;
  relevance_score: number;
  confidence: number;
  reviewed_state: EcosystemAlertState;
  created_at: string;
}

interface PendingDecisionPreview {
  id: string;
  action_type: string;
  title: string;
  rationale: string | null;
  estimated_impact: string | null;
  status: string;
  created_at: string;
}

interface PendingSummary {
  pending: number;
  edited: number;
  applied: number;
  sent_7d: number;
}

interface Budget {
  current_llm_usd: number;
  warn_llm_usd: number;
  cap_llm_usd: number;
  status: string;
}

export interface DashboardOverviewData {
  top_ecosystem_alerts: EcosystemAlertPreview[];
  pending_decisions: PendingDecisionPreview[];
  pending_summary: PendingSummary;
  budget: Budget;
  period_month: string;
}

export default function DashboardOverviewStrip({
  projectId,
  data,
  onApply,
}: {
  projectId: string;
  data: DashboardOverviewData;
  onApply?: (actionId: string) => void;
}) {
  const { top_ecosystem_alerts, pending_decisions, pending_summary, budget } = data;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_1fr] gap-4 mb-6">
      {/* Ecosystem feed preview */}
      <EcosystemCard alerts={top_ecosystem_alerts} projectId={projectId} />

      {/* Pending decisions */}
      <PendingDecisionsCard
        decisions={pending_decisions}
        summary={pending_summary}
        projectId={projectId}
        onApply={onApply}
      />

      {/* Budget meter */}
      <BudgetCard budget={budget} periodMonth={data.period_month} />
    </div>
  );
}

// =============================================================================
// Ecosystem card
// =============================================================================

const ALERT_STATE_BADGE: Record<EcosystemAlertState, { label: string; classes: string } | null> = {
  pending: null,
  acknowledged: { label: 'Seen', classes: 'bg-ink-6/30 text-ink-4' },
  dismissed: null,
  promoted_to_action: { label: 'Promoted', classes: 'bg-moss/20 text-emerald-400' },
};

function EcosystemCard({
  alerts,
  projectId,
}: {
  alerts: EcosystemAlertPreview[];
  projectId: string;
}) {
  return (
    <div className="rounded-xl border border-sky/20 bg-sky/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-sky" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            Ecosystem — si è mosso
          </h3>
        </div>
        <Link
          href={`/project/${projectId}/brief`}
          className="text-xs text-sky hover:text-sky/80"
        >
          Brief completo →
        </Link>
      </div>

      {alerts.length === 0 ? (
        <div className="text-xs text-ink-5 py-6 text-center">
          Nessun segnale sopra la soglia di rilevanza nelle ultime 2 settimane.
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.slice(0, 3).map(a => (
            <div key={a.id} className="rounded-lg bg-paper/60 border border-line p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-ink-5 uppercase tracking-wider">
                  {humanizeAlertType(a.alert_type)}
                </span>
                <span className="text-[10px] font-mono text-sky">
                  {a.relevance_score.toFixed(2)}
                </span>
                {ALERT_STATE_BADGE[a.reviewed_state] && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ALERT_STATE_BADGE[a.reviewed_state]!.classes}`}>
                    {ALERT_STATE_BADGE[a.reviewed_state]!.label}
                  </span>
                )}
              </div>
              <div className="text-sm text-ink line-clamp-2">{a.headline}</div>
              {a.source_url && (
                <a
                  href={a.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-ink-5 hover:text-ink-3 mt-1 inline-block"
                  onClick={e => e.stopPropagation()}
                >
                  {safeHostname(a.source_url)} ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Pending decisions card
// =============================================================================

function PendingDecisionsCard({
  decisions,
  summary,
  projectId,
  onApply,
}: {
  decisions: PendingDecisionPreview[];
  summary: PendingSummary;
  projectId: string;
  onApply?: (actionId: string) => void;
}) {
  const totalOpen = summary.pending + summary.edited;
  return (
    <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            Decisioni in attesa
          </h3>
          {totalOpen > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-accent/20 text-amber-300 text-[10px] font-semibold">
              {totalOpen}
            </span>
          )}
        </div>
        <Link
          href={`/project/${projectId}/actions`}
          className="text-xs text-amber-400 hover:text-amber-300"
        >
          Inbox →
        </Link>
      </div>

      {decisions.length === 0 ? (
        <div className="text-xs text-ink-5 py-6 text-center">
          Nessuna decisione in attesa. Il co-founder ha fatto un buon lavoro a restare silente.
        </div>
      ) : (
        <div className="space-y-2">
          {decisions.slice(0, 3).map(d => (
            <div key={d.id} className="rounded-lg bg-paper/60 border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-ink-5 uppercase tracking-wider">
                      {humanizeActionType(d.action_type)}
                    </span>
                    {d.estimated_impact && (
                      <span className="text-[10px] text-amber-400">· {d.estimated_impact}</span>
                    )}
                  </div>
                  <div className="text-sm text-ink line-clamp-2">{d.title}</div>
                </div>
                {onApply && (
                  <button
                    onClick={() => onApply(d.id)}
                    className="shrink-0 px-2 py-1 text-[10px] rounded-md bg-moss hover:bg-moss/80 text-white"
                    aria-label={`Applica ${d.title}`}
                  >
                    Applica
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {summary.sent_7d > 0 && (
        <div className="mt-3 pt-3 border-t border-line text-[10px] text-ink-5">
          {summary.sent_7d} azion{summary.sent_7d === 1 ? 'e eseguita' : 'i eseguite'} negli ultimi 7 giorni
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Budget card
// =============================================================================

function BudgetCard({ budget, periodMonth }: { budget: Budget; periodMonth: string }) {
  const pct = budget.cap_llm_usd > 0 ? (budget.current_llm_usd / budget.cap_llm_usd) * 100 : 0;
  const isWarn = budget.current_llm_usd >= budget.warn_llm_usd;
  const isCapped = budget.current_llm_usd >= budget.cap_llm_usd;

  const fillColor = isCapped ? 'bg-clay' : isWarn ? 'bg-accent' : 'bg-moss';
  const trackColor = isCapped ? 'border-clay/30 bg-clay/5' : isWarn ? 'border-accent/30 bg-accent/5' : 'border-line bg-paper/60';

  return (
    <div className={`rounded-xl border ${trackColor} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-moss" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          Budget LLM — {periodMonth}
        </h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-mono text-ink">
            ${budget.current_llm_usd.toFixed(3)}
          </span>
          <span className="text-xs text-ink-5">/ ${budget.cap_llm_usd.toFixed(2)}</span>
        </div>
        <div className="h-2 rounded-full bg-paper-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${fillColor}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="text-[10px] text-ink-5">
          {isCapped
            ? '⚠ Cap raggiunto — observe-only in Phase 0'
            : isWarn
              ? `⚠ Soglia 80% superata (${pct.toFixed(0)}%)`
              : `${pct.toFixed(0)}% del cap mensile`}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function humanizeAlertType(type: string): string {
  const map: Record<string, string> = {
    competitor_activity: 'competitor',
    ip_filing: 'brevetto',
    trend_signal: 'trend',
    partnership_opportunity: 'partnership',
    regulatory_change: 'regolatorio',
    funding_event: 'funding',
  };
  return map[type] || type;
}

function humanizeActionType(type: string): string {
  const map: Record<string, string> = {
    draft_email: 'email',
    draft_linkedin_post: 'post LinkedIn',
    draft_linkedin_dm: 'DM LinkedIn',
    proposed_hypothesis: 'ipotesi',
    proposed_interview_question: 'domanda intervista',
    proposed_landing_copy: 'copy landing',
    proposed_investor_followup: 'follow-up investor',
    proposed_graph_update: 'graph update',
  };
  return map[type] || type;
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}
