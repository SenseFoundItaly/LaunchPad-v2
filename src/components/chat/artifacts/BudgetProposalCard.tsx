'use client';

/**
 * BudgetProposalCard — in-chat approval UX for a propose_budget_change call.
 *
 * Mirrors MonitorProposalCard. States:
 *   - collapsed: current → proposed cap + reason + [Approve][Edit][Dismiss]
 *   - editing: editable proposed_cap_usd input + [Save & approve][Cancel]
 *   - resolved-approved: faded card with checkmark
 *   - resolved-dismissed: faded card with X
 *   - resolved-error: red banner with the server error
 *
 * Action callback protocol:
 *   - 'budget:approve' { pending_action_id, overrides? }
 *   - 'budget:dismiss' { pending_action_id }
 */

import { useState } from 'react';
import type { BudgetProposalArtifact } from '@/types/artifacts';
import SourcesFooter from './SourcesFooter';

interface BudgetProposalCardProps {
  artifact: BudgetProposalArtifact;
  onAction: (action: string, payload: Record<string, unknown>) => void;
}

type CardState =
  | 'collapsed'
  | 'editing'
  | 'approving'
  | 'dismissing'
  | 'approved'
  | 'dismissed'
  | 'error';

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function BudgetProposalCard({ artifact, onAction }: BudgetProposalCardProps) {
  const [state, setState] = useState<CardState>('collapsed');
  const [serverError, setServerError] = useState<string | null>(null);
  const [editCap, setEditCap] = useState<string>(artifact.proposed_cap_usd.toFixed(2));

  const delta = artifact.proposed_cap_usd - artifact.current_cap_usd;
  const direction = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'no change';
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '·';

  async function handleApprove(withOverrides: boolean) {
    setState('approving');
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
      const result = (onAction as unknown as (a: string, p: Record<string, unknown>) => Promise<unknown> | void)(
        'budget:approve',
        { pending_action_id: artifact.pending_action_id, overrides },
      );
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        await result;
      }
      setState('approved');
    } catch (err) {
      setServerError((err as Error).message);
      setState('error');
    }
  }

  async function handleDismiss() {
    setState('dismissing');
    setServerError(null);
    try {
      const result = (onAction as unknown as (a: string, p: Record<string, unknown>) => Promise<unknown> | void)(
        'budget:dismiss',
        { pending_action_id: artifact.pending_action_id },
      );
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        await result;
      }
      setState('dismissed');
    } catch (err) {
      setServerError((err as Error).message);
      setState('error');
    }
  }

  if (state === 'approved') {
    return (
      <div className="my-3 bg-zinc-800/30 border border-green-500/20 rounded-lg p-3 opacity-75">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-green-400 font-mono">✓</span>
          <span className="text-zinc-300">Budget cap updated:</span>
          <span className="text-zinc-100 font-medium">
            {fmtUsd(artifact.current_cap_usd)} → {fmtUsd(artifact.proposed_cap_usd)}
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
          <span className="text-zinc-500 font-mono">✗</span>
          <span className="text-zinc-400">Dismissed budget proposal</span>
          <span className="text-zinc-500 ml-auto">cap stays at {fmtUsd(artifact.current_cap_usd)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-mono">Budget proposal</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-500/20 text-amber-300 border-amber-500/30">
          {direction}
        </span>
        {artifact.estimated_monthly_cost_usd != null && (
          <span className="text-[10px] text-zinc-500 ml-auto">
            est. {fmtUsd(artifact.estimated_monthly_cost_usd)}/mo
          </span>
        )}
      </div>

      <h4 className="text-sm font-semibold text-zinc-100 mb-2">
        Monthly LLM cap: {fmtUsd(artifact.current_cap_usd)} {arrow} {fmtUsd(artifact.proposed_cap_usd)}
      </h4>

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
              onChange={(e) => setEditCap(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 font-mono"
            />
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
              onClick={() => handleApprove(true)}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
            >
              Save &amp; approve
            </button>
            <button
              type="button"
              onClick={() => setState('collapsed')}
              className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-md transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={state === 'approving'}
              onClick={() => handleApprove(false)}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md transition-colors"
            >
              {state === 'approving' ? 'Approving…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={state === 'approving' || state === 'dismissing'}
              onClick={() => setState('editing')}
              className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-md transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={state === 'approving' || state === 'dismissing'}
              onClick={handleDismiss}
              className="text-xs px-3 py-1.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors ml-auto"
            >
              {state === 'dismissing' ? 'Dismissing…' : 'Dismiss'}
            </button>
          </>
        )}
      </div>

      <SourcesFooter sources={artifact.sources} />
    </div>
  );
}
