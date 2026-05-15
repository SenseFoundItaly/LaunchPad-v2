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
import SourcesFooter from './SourcesFooter';
import ArtifactCardShell from './ArtifactCardShell';

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
  const [state, setState] = useState<CardState>('collapsed');
  const [serverError, setServerError] = useState<string | null>(null);
  const [editCap, setEditCap] = useState<string>(artifact.proposed_cap_usd.toFixed(2));
  const [capError, setCapError] = useState<string | null>(null);

  const delta = artifact.proposed_cap_usd - artifact.current_cap_usd;
  const direction = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'no change';
  const arrow = delta > 0 ? '\u2191' : delta < 0 ? '\u2193' : '\u00B7';

  async function handleApply(withOverrides: boolean) {
    setState('applying');
    setServerError(null);
    let overrides: Record<string, unknown> | undefined;
    if (withOverrides) {
      const parsed = parseFloat(editCap);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setServerError('Proposed cap must be a positive number');
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
          <span className="text-ink-3">Budget cap updated:</span>
          <span className="text-ink font-medium">
            {fmtUsd(artifact.current_cap_usd)} {'\u2192'} {fmtUsd(artifact.proposed_cap_usd)}
          </span>
          <span className="text-ink-5 text-xs ml-auto">effective immediately</span>
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
          <span className="text-ink-4">Dismissed budget proposal</span>
          <span className="text-ink-5 ml-auto">cap stays at {fmtUsd(artifact.current_cap_usd)}</span>
        </div>
      </div>
    );
  }

  return (
    <ArtifactCardShell
      typeLabel="Budget proposal"
      title={`Monthly LLM cap: ${fmtUsd(artifact.current_cap_usd)} ${arrow} ${fmtUsd(artifact.proposed_cap_usd)}`}
      sources={artifact.sources}
      collapsible={false}
      headerRight={<>
        <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-500/20 text-amber-300 border-amber-500/30">
          {direction}
        </span>
        {artifact.estimated_monthly_cost_usd != null && (
          <span className="text-[10px] text-ink-5">
            est. {fmtUsd(artifact.estimated_monthly_cost_usd)}/mo
          </span>
        )}
      </>}
    >
      <div className="text-[11px] text-ink-4 mb-3">
        <span className="text-ink-5">Reason: </span>
        <span className="text-ink-3">{artifact.reason}</span>
      </div>

      {state === 'editing' ? (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-[10px] text-ink-5 uppercase tracking-wider block mb-1">
              Proposed cap (USD/month)
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
                    setCapError('Must be a positive number');
                  } else if (n > 10_000) {
                    setCapError('Max $10,000/month');
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

      {state === 'error' && serverError && (
        <div className="mb-2 p-2 bg-clay/10 border border-clay/40 rounded text-[11px] text-clay">
          {serverError}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-line-2">
        {state === 'editing' ? (
          <>
            <button
              type="button"
              disabled={!!capError}
              onClick={() => handleApply(true)}
              className="text-xs px-3 py-1.5 bg-moss hover:bg-moss/80 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors"
            >
              Save &amp; apply
            </button>
            <button
              type="button"
              onClick={() => { setCapError(null); setState('collapsed'); }}
              className="text-xs px-3 py-1.5 bg-paper-3 hover:bg-paper-3/80 text-ink-2 rounded-md transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={state === 'applying'}
              onClick={() => handleApply(false)}
              className="text-xs px-3 py-1.5 bg-moss hover:bg-moss/80 disabled:opacity-50 text-white rounded-md transition-colors"
            >
              {state === 'applying' ? 'Applying...' : 'Apply'}
            </button>
            <button
              type="button"
              disabled={state === 'applying' || state === 'dismissing'}
              onClick={() => setState('editing')}
              className="text-xs px-3 py-1.5 bg-paper-3 hover:bg-paper-3/80 disabled:opacity-50 text-ink-2 rounded-md transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={state === 'applying' || state === 'dismissing'}
              onClick={handleDismiss}
              className="text-xs px-3 py-1.5 text-ink-4 hover:text-ink-2 disabled:opacity-50 transition-colors ml-auto"
            >
              {state === 'dismissing' ? 'Dismissing...' : 'Dismiss'}
            </button>
          </>
        )}
      </div>
    </ArtifactCardShell>
  );
}
