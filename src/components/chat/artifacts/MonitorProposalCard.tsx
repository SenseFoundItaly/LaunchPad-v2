'use client';

/**
 * MonitorProposalCard — the in-chat apply UX for a propose_monitor call.
 *
 * States:
 *   - collapsed (default): name + kind chip + schedule + cost + linked-risk
 *     badge + [Apply] [Edit] [Dismiss] row
 *   - expanded-edit: same card + editable fields for schedule / URLs /
 *     alert_threshold with [Save & Apply] [Cancel] row
 *   - resolved-applied: faded card with checkmark + "Monitor active"
 *   - resolved-dismissed: faded card with X + "Dismissed"
 *   - resolved-error: red banner with the server error message
 *
 * Action callback protocol (matches the pattern of OptionSetCard /
 * ActionSuggestionCard — routed through ChatMessage.onArtifactAction → page
 * handler):
 *   - 'monitor:apply' { pending_action_id, overrides? }
 *   - 'monitor:dismiss' { pending_action_id, reason? }
 *
 * The page-level handler POSTs to /api/projects/{id}/actions/{actionId}
 * with {transition: 'apply', edited_payload: overrides} or
 * {transition: 'reject', reason}. Card optimistically transitions to
 * resolved state; if the server returns an error, card shows the red
 * banner and re-enables the buttons.
 */

import { useState } from 'react';
import type { MonitorProposalArtifact } from '@/types/artifacts';
import SourcesFooter from './SourcesFooter';
import ArtifactCardShell from './ArtifactCardShell';

interface MonitorProposalCardProps {
  artifact: MonitorProposalArtifact;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

const KIND_COLORS: Record<string, string> = {
  competitor: 'bg-red-500/20 text-clay border-red-500/30',
  regulation: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  market: 'bg-green-500/20 text-green-300 border-green-500/30',
  partner: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  technology: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  funding: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  custom: 'bg-ink-5/20 text-ink-3 border-ink-5/30',
};

const SCHEDULE_LABELS: Record<'hourly' | 'daily' | 'weekly', string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
};

type CardState = 'collapsed' | 'editing' | 'applying' | 'dismissing' | 'applied' | 'dismissed' | 'error';

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

  async function handleApply(withOverrides: boolean) {
    setState('applying');
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
      await onAction('monitor:apply', { pending_action_id: artifact.pending_action_id, overrides });
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
      await onAction('monitor:dismiss', { pending_action_id: artifact.pending_action_id });
      setState('dismissed');
    } catch (err) {
      setServerError((err as Error).message);
      setState('error');
    }
  }

  // Resolved states — faded card with a compact status line. These bypass
  // the shell and render directly as minimal single-line UI.
  if (state === 'applied') {
    return (
      <div className="my-3 bg-paper-2/30 border border-moss/20 rounded-lg p-3 opacity-75">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-moss font-mono">{'\u2713'}</span>
          <span className="text-ink-3">Monitor applied:</span>
          <span className="text-ink font-medium">{artifact.name}</span>
          <span className="text-ink-5 text-xs ml-auto">will run next cron tick</span>
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
          <span className="text-ink-4">Dismissed:</span>
          <span className="text-ink-5">{artifact.name}</span>
        </div>
      </div>
    );
  }

  return (
    <ArtifactCardShell
      typeLabel="Monitor proposal"
      title={artifact.name}
      sources={artifact.sources}
      collapsible={false}
      headerRight={<>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${kindColor}`}>
          {artifact.kind}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-paper-3/50 text-ink-3">
          {SCHEDULE_LABELS[artifact.schedule]}
        </span>
        <span className="text-[10px] text-ink-5">
          ~{'\u20AC'}{artifact.estimated_monthly_cost_eur.toFixed(2)}/mo
        </span>
      </>}
    >
      {/* Derisking breadcrumb */}
      <div className="text-[11px] text-ink-4 mb-2">
        <span className="text-ink-5">Derisking: </span>
        <span className="font-mono text-ink-3">{artifact.linked_risk_id}</span>
        {artifact.linked_quote && (
          <span className="text-ink-5"> — &ldquo;{artifact.linked_quote}&rdquo;</span>
        )}
      </div>

      {/* Overlap warning */}
      {artifact.overlap_warning && (
        <div className="mb-2 p-2 bg-clay/10 border border-clay/40 rounded text-[11px]">
          <div className="font-semibold text-clay mb-0.5">
            Dedup warning — agent bypassed semantic overlap check
          </div>
          <div className="text-clay/80">
            Matches existing monitor <span className="font-mono">{artifact.overlap_warning.existing_name}</span>
            {' '}(score {artifact.overlap_warning.overlap_score.toFixed(2)})
          </div>
          <div className="text-clay/70 mt-1">Reason: {artifact.overlap_warning.reason}</div>
        </div>
      )}

      {/* Threshold — editable in edit mode, read-only otherwise */}
      {state === 'editing' ? (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-[10px] text-ink-5 uppercase tracking-wider block mb-1">Schedule</label>
            <select
              value={editSchedule}
              onChange={(e) => setEditSchedule(e.target.value as 'hourly' | 'daily' | 'weekly')}
              className="w-full bg-paper border border-line-2 rounded px-2 py-1 text-sm text-ink"
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-ink-5 uppercase tracking-wider block mb-1">Alert threshold</label>
            <textarea
              value={editThreshold}
              onChange={(e) => setEditThreshold(e.target.value)}
              rows={2}
              className="w-full bg-paper border border-line-2 rounded px-2 py-1 text-sm text-ink resize-y"
            />
          </div>
          <div>
            <label className="text-[10px] text-ink-5 uppercase tracking-wider block mb-1">
              URLs to track (one per line, 5 max)
            </label>
            <textarea
              value={editUrlsRaw}
              onChange={(e) => setEditUrlsRaw(e.target.value)}
              rows={Math.min(5, Math.max(2, editUrlsRaw.split('\n').length))}
              className="w-full bg-paper border border-line-2 rounded px-2 py-1 text-xs text-ink font-mono resize-y"
              placeholder="https://example.com/pricing"
            />
          </div>
        </div>
      ) : (
        <>
          <div className="text-xs text-ink-3 mb-2">
            <span className="text-ink-5">Alerts when:</span> {artifact.alert_threshold}
          </div>
          {artifact.urls_to_track && artifact.urls_to_track.length > 0 && (
            <div className="text-[11px] text-ink-5 mb-2">
              {artifact.urls_to_track.length === 1 ? 'URL:' : `${artifact.urls_to_track.length} URLs:`}{' '}
              <span className="font-mono text-ink-4 break-all">
                {artifact.urls_to_track.slice(0, 2).join(', ')}
                {artifact.urls_to_track.length > 2 && ` (+${artifact.urls_to_track.length - 2} more)`}
              </span>
            </div>
          )}
        </>
      )}

      {/* Server error */}
      {state === 'error' && serverError && (
        <div className="mb-2 p-2 bg-clay/10 border border-clay/40 rounded text-[11px] text-clay">
          Apply failed: {serverError}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-2 border-t border-line-2">
        {state === 'editing' ? (
          <>
            <button
              type="button"
              onClick={() => handleApply(true)}
              className="text-xs px-3 py-1.5 bg-moss hover:bg-moss/80 text-white rounded-md transition-colors"
            >
              Save &amp; apply
            </button>
            <button
              type="button"
              onClick={() => setState('collapsed')}
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
