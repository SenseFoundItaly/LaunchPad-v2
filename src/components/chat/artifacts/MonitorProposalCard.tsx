'use client';

/**
 * MonitorProposalCard — the in-chat approval UX for a propose_monitor call.
 *
 * States:
 *   - collapsed (default): name + kind chip + schedule + cost + linked-risk
 *     badge + [Approve] [Edit] [Dismiss] row
 *   - expanded-edit: same card + editable fields for schedule / URLs /
 *     alert_threshold with [Save & Approve] [Cancel] row
 *   - resolved-approved: faded card with checkmark + "Monitor active"
 *   - resolved-dismissed: faded card with X + "Dismissed"
 *   - resolved-error: red banner with the server error message
 *
 * Action callback protocol (matches the pattern of OptionSetCard /
 * ActionSuggestionCard — routed through ChatMessage.onArtifactAction → page
 * handler):
 *   - 'monitor:approve' { pending_action_id, overrides? }
 *   - 'monitor:dismiss' { pending_action_id, reason? }
 *
 * The page-level handler POSTs to /api/projects/{id}/actions/{actionId}
 * with {transition: 'approve', edited_payload: overrides} or
 * {transition: 'reject', reason}. Card optimistically transitions to
 * resolved state; if the server returns an error, card shows the red
 * banner and re-enables the buttons.
 */

import { useState } from 'react';
import type { MonitorProposalArtifact } from '@/types/artifacts';
import SourcesFooter from './SourcesFooter';

interface MonitorProposalCardProps {
  artifact: MonitorProposalArtifact;
  onAction: (action: string, payload: Record<string, unknown>) => void;
}

const KIND_COLORS: Record<string, string> = {
  competitor: 'bg-red-500/20 text-red-300 border-red-500/30',
  regulation: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  market: 'bg-green-500/20 text-green-300 border-green-500/30',
  partner: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  technology: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  funding: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  custom: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
};

const SCHEDULE_LABELS: Record<'hourly' | 'daily' | 'weekly', string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
};

type CardState = 'collapsed' | 'editing' | 'approving' | 'dismissing' | 'approved' | 'dismissed' | 'error';

export default function MonitorProposalCard({ artifact, onAction }: MonitorProposalCardProps) {
  const [state, setState] = useState<CardState>('collapsed');
  const [serverError, setServerError] = useState<string | null>(null);

  // Local edit state — initialized from artifact; only committed on Save.
  const [editSchedule, setEditSchedule] = useState<'hourly' | 'daily' | 'weekly'>(artifact.schedule);
  const [editThreshold, setEditThreshold] = useState<string>(artifact.alert_threshold);
  const [editUrlsRaw, setEditUrlsRaw] = useState<string>(
    (artifact.urls_to_track ?? []).join('\n'),
  );

  const kindColor = KIND_COLORS[artifact.kind] ?? KIND_COLORS.custom;

  async function handleApprove(withOverrides: boolean) {
    setState('approving');
    setServerError(null);
    let overrides: Record<string, unknown> | undefined;
    if (withOverrides) {
      const urls = editUrlsRaw
        .split('\n')
        .map((u) => u.trim())
        .filter(Boolean);
      overrides = {
        schedule: editSchedule,
        alert_threshold: editThreshold,
        urls_to_track: urls,
      };
    }
    try {
      // Caller is expected to return a Promise that resolves on server success
      // or throws on error. OptionSetCard / ActionSuggestionCard fire-and-
      // forget today; for monitor approval we need the outcome so we can
      // show approved/error state. The handler contract allows this — the
      // page-level wrapper returns a Promise.
      const result = (onAction as unknown as (a: string, p: Record<string, unknown>) => Promise<unknown> | void)(
        'monitor:approve',
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
        'monitor:dismiss',
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

  // Resolved states — faded card with a compact status line. SourcesFooter
  // still renders so the founder can click through to see what motivated
  // the proposal even after resolution.
  if (state === 'approved') {
    return (
      <div className="my-3 bg-zinc-800/30 border border-green-500/20 rounded-lg p-3 opacity-75">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-green-400 font-mono">✓</span>
          <span className="text-zinc-300">Monitor approved:</span>
          <span className="text-zinc-100 font-medium">{artifact.name}</span>
          <span className="text-zinc-500 text-xs ml-auto">will run next cron tick</span>
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
          <span className="text-zinc-400">Dismissed:</span>
          <span className="text-zinc-500">{artifact.name}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
      {/* Header: name + kind chip + schedule badge */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-mono">Monitor proposal</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${kindColor}`}>
          {artifact.kind}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-300">
          {SCHEDULE_LABELS[artifact.schedule]}
        </span>
        <span className="text-[10px] text-zinc-500 ml-auto">
          ~€{artifact.estimated_monthly_cost_eur.toFixed(2)}/mo
        </span>
      </div>

      <h4 className="text-sm font-semibold text-zinc-100 mb-1">{artifact.name}</h4>

      {/* Derisking breadcrumb — always visible so the founder knows WHY */}
      <div className="text-[11px] text-zinc-400 mb-2">
        <span className="text-zinc-500">Derisking: </span>
        <span className="font-mono text-zinc-300">{artifact.linked_risk_id}</span>
        {artifact.linked_quote && (
          <span className="text-zinc-500"> — &ldquo;{artifact.linked_quote}&rdquo;</span>
        )}
      </div>

      {/* Overlap warning — prominent red banner when agent bypassed L2 dedup */}
      {artifact.overlap_warning && (
        <div className="mb-2 p-2 bg-red-950/40 border border-red-500/40 rounded text-[11px]">
          <div className="font-semibold text-red-400 mb-0.5">
            Dedup warning — agent bypassed semantic overlap check
          </div>
          <div className="text-red-300/80">
            Matches existing monitor <span className="font-mono">{artifact.overlap_warning.existing_name}</span>
            {' '}(score {artifact.overlap_warning.overlap_score.toFixed(2)})
          </div>
          <div className="text-red-300/70 mt-1">Reason: {artifact.overlap_warning.reason}</div>
        </div>
      )}

      {/* Threshold — the actual "when does this fire" line. Shown editable
          in edit mode, read-only in collapsed mode. */}
      {state === 'editing' ? (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Schedule</label>
            <select
              value={editSchedule}
              onChange={(e) => setEditSchedule(e.target.value as 'hourly' | 'daily' | 'weekly')}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Alert threshold</label>
            <textarea
              value={editThreshold}
              onChange={(e) => setEditThreshold(e.target.value)}
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 resize-y"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">
              URLs to track (one per line, ≤5)
            </label>
            <textarea
              value={editUrlsRaw}
              onChange={(e) => setEditUrlsRaw(e.target.value)}
              rows={Math.min(5, Math.max(2, editUrlsRaw.split('\n').length))}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 font-mono resize-y"
              placeholder="https://example.com/pricing"
            />
          </div>
        </div>
      ) : (
        <>
          <div className="text-xs text-zinc-300 mb-2">
            <span className="text-zinc-500">Alerts when:</span> {artifact.alert_threshold}
          </div>
          {artifact.urls_to_track && artifact.urls_to_track.length > 0 && (
            <div className="text-[11px] text-zinc-500 mb-2">
              {artifact.urls_to_track.length === 1 ? 'URL:' : `${artifact.urls_to_track.length} URLs:`}{' '}
              <span className="font-mono text-zinc-400 break-all">
                {artifact.urls_to_track.slice(0, 2).join(', ')}
                {artifact.urls_to_track.length > 2 && ` (+${artifact.urls_to_track.length - 2} more)`}
              </span>
            </div>
          )}
        </>
      )}

      {/* Server error — red banner with message + re-enabled buttons */}
      {state === 'error' && serverError && (
        <div className="mb-2 p-2 bg-red-950/40 border border-red-500/40 rounded text-[11px] text-red-300">
          Approval failed: {serverError}
        </div>
      )}

      {/* Action buttons — differ per state */}
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
