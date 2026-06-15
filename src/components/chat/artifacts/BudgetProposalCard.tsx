'use client';

/**
 * BudgetProposalCard — in-chat apply UX for a propose_budget_change call.
 *
 * Mirrors MonitorProposalCard. States:
 *   - collapsed: current -> proposed cap + reason + [Apply][Edit][Dismiss]
 *   - editing: editable proposed_cap_usd input + [Save & apply][Cancel]
 *   - resolved-applied: faded card with checkmark
 *   - resolved-dismissed: faded card with X
 *   - resolved-error: red banner with the server error
 *
 * Action callback protocol:
 *   - 'budget:apply' { pending_action_id, overrides? }
 *   - 'budget:dismiss' { pending_action_id }
 */

import { useState } from 'react';
import type { BudgetProposalArtifact } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import SourcesFooter from './SourcesFooter';
import ArtifactCardShell from './ArtifactCardShell';
import UnifiedReviewControls from './UnifiedReviewControls';

interface BudgetProposalCardProps {
  artifact: BudgetProposalArtifact;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

type CardState =
  | 'collapsed'
  | 'editing'
  | 'applying'
  | 'dismissing'
  | 'applied'
  | 'dismissed'
  | 'error';

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function BudgetProposalCard({ artifact, onAction }: BudgetProposalCardProps) {
  const t = useT();
  const [state, setState] = useState<CardState>('collapsed');
  const [serverError, setServerError] = useState<string | null>(null);
  const [editCap, setEditCap] = useState<string>(artifact.proposed_cap_usd.toFixed(2));
  const [capError, setCapError] = useState<string | null>(null);

  const delta = artifact.proposed_cap_usd - artifact.current_cap_usd;
  const direction = delta > 0
    ? t('art.budget.increase')
    : delta < 0
    ? t('art.budget.decrease')
    : t('art.budget.no-change');
  const arrow = delta > 0 ? '\u2191' : delta < 0 ? '\u2193' : '\u00B7';

  async function handleApply(withOverrides: boolean) {
    setState('applying');
    setServerError(null);
    let overrides: Record<string, unknown> | undefined;
    if (withOverrides) {
      const parsed = parseFloat(editCap);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setServerError(t('art.budget.cap-positive'));
        setState('error');
        return;
      }
      overrides = { proposed_cap_usd: parsed };
    }
    try {
      await onAction('budget:apply', { pending_action_id: artifact.pending_action_id, overrides });
      setState('applied');
    } catch (err) {
      setServerError((err as Error).message);
      setState('error');
    }
  }

  async function handleDismiss() {
    setState('dismissing');
    setServerError(null);
    try {
      await onAction('budget:dismiss', { pending_action_id: artifact.pending_action_id });
      setState('dismissed');
    } catch (err) {
      setServerError((err as Error).message);
      setState('error');
    }
  }

  // Resolved states bypass the shell — render minimal single-line UI.
  if (state === 'applied') {
    return (
      <div className="my-3 bg-paper-2/30 border border-moss/20 rounded-lg p-3 opacity-75">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-moss font-mono">{'\u2713'}</span>
          <span className="text-ink-3">{t('art.budget.cap-updated')}</span>
          <span className="text-ink font-medium">
            {fmtUsd(artifact.current_cap_usd)} {'\u2192'} {fmtUsd(artifact.proposed_cap_usd)}
          </span>
          <span className="text-ink-5 text-xs ml-auto">{t('art.budget.effective-immediately')}</span>
        </div>
        <SourcesFooter sources={artifact.sources} compact />
      </div>
    );
  }
  if (state === 'dismissed') {
    return (
      <div className="my-3 bg-paper-2/20 border border-line-2 rounded-lg p-3 opacity-60">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-5 font-mono">{'\u2717'}</span>
          <span className="text-ink-4">{t('art.budget.dismissed')}</span>
          <span className="text-ink-5 ml-auto">{t('art.budget.cap-stays-at', { value: fmtUsd(artifact.current_cap_usd) })}</span>
        </div>
      </div>
    );
  }

  return (
    <ArtifactCardShell
      typeLabel={t('art.budget.type-label')}
      title={t('art.budget.title', { from: fmtUsd(artifact.current_cap_usd), arrow, to: fmtUsd(artifact.proposed_cap_usd) })}
      sources={artifact.sources}
      collapsible={false}
      aiGenerated
      headerRight={<>
        <span className="text-[10px] px-2 py-0.5 rounded-full border bg-cat-gold-wash text-cat-gold border-line-2">
          {direction}
        </span>
        {artifact.estimated_monthly_cost_usd != null && (
          <span className="text-[10px] text-ink-5">
            {t('art.budget.est-monthly', { value: fmtUsd(artifact.estimated_monthly_cost_usd) })}
          </span>
        )}
      </>}
    >
      <div className="text-[11px] text-ink-4 mb-3">
        <span className="text-ink-5">{t('art.budget.reason')} </span>
        <span className="text-ink-3">{artifact.reason}</span>
      </div>

      {state === 'editing' ? (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-[10px] text-ink-5 uppercase tracking-wider block mb-1">
              {t('art.budget.proposed-cap-label')}
            </label>
            <input
              type="number"
              step="0.50"
              min="0.10"
              value={editCap}
              onChange={(e) => {
                const v = e.target.value;
                setEditCap(v);
                if (v === '' || v === '.' || v.endsWith('.')) {
                  setCapError(null);
                } else {
                  const n = parseFloat(v);
                  if (!Number.isFinite(n) || n <= 0) {
                    setCapError(t('art.budget.must-be-positive'));
                  } else if (n > 10_000) {
                    setCapError(t('art.budget.max-cap'));
                  } else {
                    setCapError(null);
                  }
                }
              }}
              className="w-full bg-paper border border-line-2 rounded px-2 py-1 text-sm text-ink font-mono"
            />
            {capError && <p className="text-[10px] text-clay mt-0.5">{capError}</p>}
          </div>
        </div>
      ) : null}

      {state === 'editing' ? (
        <div className="flex items-center gap-2 pt-2 border-t border-line-2">
          <button
            type="button"
            disabled={!!capError}
            onClick={() => handleApply(true)}
            className="text-xs px-3 py-1.5 bg-moss hover:bg-moss/80 disabled:opacity-50 disabled:cursor-not-allowed text-paper rounded-md transition-colors"
          >
            {t('art.common.save-apply')}
          </button>
          <button
            type="button"
            onClick={() => { setCapError(null); setState('collapsed'); }}
            className="text-xs px-3 py-1.5 bg-paper-3 hover:bg-paper-3/80 text-ink-2 rounded-md transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <UnifiedReviewControls
          lane="approval"
          state={
            state === 'applying' || state === 'dismissing' ? 'busy' :
            state === 'error' ? 'error' : 'pending'
          }
          onApply={() => handleApply(false)}
          onReject={handleDismiss}
          onEdit={() => setState('editing')}
          errorMessage={serverError ?? undefined}
          variant="footer"
          destination={t('art.budget.destination')}
          impactHint={t('art.budget.impact-hint')}
        />
      )}
    </ArtifactCardShell>
  );
}
