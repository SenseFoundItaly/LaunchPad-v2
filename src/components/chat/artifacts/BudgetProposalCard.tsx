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
      <div className="my-3 bg-zinc-800/30 border border-green-500/20 rounded-lg p-3 opacity-75">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-green-400 font-mono">{'\u2713'}</span>
          <span className="text-zinc-300">Budget cap updated:</span>
          <span className="text-zinc-100 font-medium">
            {fmtUsd(artifact.current_cap_usd)} {'\u2192'} {fmtUsd(artifact.proposed_cap_usd)}
          </span>
          <span className="text-zinc-500 text-xs ml-auto">effective immediately</span>
        </div>
        <SourcesFooter sources={artifact.sources} compact />
      </div>
    );
  }
  if (state === 'dismissed') {
    return (
      <div className="my-3 bg-zinc-800/20 border border-zinc-700/40 rounded-lg p-3 opacity-60">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500 font-mono">{'\u2717'}</span>
          <span className="text-zinc-400">Dismissed budget proposal</span>
          <span className="text-zinc-500 ml-auto">cap stays at {fmtUsd(artifact.current_cap_usd)}</span>
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
          <span className="text-[10px] text-zinc-500">
            est. {fmtUsd(artifact.estimated_monthly_cost_usd)}/mo
          </span>
        )}
      </>}
    >
      <div className="text-[11px] text-zinc-400 mb-3">
        <span className="text-zinc-500">Reason: </span>
        <span className="text-zinc-300">{artifact.reason}</span>
      </div>

      {state === 'editing' ? (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">
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
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 font-mono"
            />
            {capError && <p className="text-[10px] text-red-400 mt-0.5">{capError}</p>}
          </div>
        </div>
      ) : null}

      {state === 'error' && serverError && (
        <div className="mb-2 p-2 bg-red-950/40 border border-red-500/40 rounded text-[11px] text-red-300">
          {serverError}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-zinc-700/50">
        {state === 'editing' ? (
          <>
            <button
              type="button"
              disabled={!!capError}
              onClick={() => handleApply(true)}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors"
            >
              Save &amp; apply
            </button>
            <button
              type="button"
              onClick={() => { setCapError(null); setState('collapsed'); }}
              className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-md transition-colors"
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
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md transition-colors"
            >
              {state === 'applying' ? 'Applying...' : 'Apply'}
            </button>
            <button
              type="button"
              disabled={state === 'applying' || state === 'dismissing'}
              onClick={() => setState('editing')}
              className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-md transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={state === 'applying' || state === 'dismissing'}
              onClick={handleDismiss}
              className="text-xs px-3 py-1.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors ml-auto"
            >
              {state === 'dismissing' ? 'Dismissing...' : 'Dismiss'}
            </button>
          </>
        )}
      </div>
    </ArtifactCardShell>
  );
}
