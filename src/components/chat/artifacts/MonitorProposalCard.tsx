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
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import SourcesFooter from './SourcesFooter';
import ArtifactCardShell from './ArtifactCardShell';
import UnifiedReviewControls from './UnifiedReviewControls';
import { monitorPalette } from '@/lib/brand-palette';
import { watcherWeeklyLabel, watcherRunsPerWeek } from '@/lib/watcher-cost';

interface MonitorProposalCardProps {
  artifact: MonitorProposalArtifact;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

const SCHEDULE_LABEL_KEYS: Record<'daily' | 'weekly', MessageKey> = {
  daily: 'art.monitor.schedule-daily',
  weekly: 'art.monitor.schedule-weekly',
};

type CardState = 'collapsed' | 'editing' | 'applying' | 'dismissing' | 'applied' | 'dismissed' | 'error';

export default function MonitorProposalCard({ artifact, onAction }: MonitorProposalCardProps) {
  const t = useT();
  const [state, setState] = useState<CardState>('collapsed');
  const [serverError, setServerError] = useState<string | null>(null);

  // Local edit state — initialized from artifact; only committed on Save.
  const [editSchedule, setEditSchedule] = useState<'daily' | 'weekly'>(artifact.schedule);
  const [editThreshold, setEditThreshold] = useState<string>(artifact.alert_threshold);
  const [editUrlsRaw, setEditUrlsRaw] = useState<string>(
    (artifact.urls_to_track ?? []).join('\n'),
  );

  const mp = monitorPalette(artifact.kind);
  const kindColor = `${mp.chip} border-line-2`;

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
          <span className="text-ink-3">{t('art.monitor.applied')}</span>
          <span className="text-ink font-medium">{artifact.name}</span>
          <span className="text-ink-5 text-xs ml-auto">{t('art.monitor.will-run-next-tick')}</span>
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
          <span className="text-ink-4">{t('art.monitor.dismissed')}</span>
          <span className="text-ink-5">{artifact.name}</span>
        </div>
      </div>
    );
  }

  return (
    <ArtifactCardShell
      typeLabel={t('art.monitor.type-label')}
      title={artifact.name}
      sources={artifact.sources}
      collapsible={false}
      aiGenerated
      headerRight={<>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${kindColor}`}>
          {artifact.kind}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-paper-3/50 text-ink-3">
          {t(SCHEDULE_LABEL_KEYS[artifact.schedule])}
        </span>
      </>}
    >
      {/* Derisking breadcrumb */}
      <div className="text-[11px] text-ink-4 mb-2">
        <span className="text-ink-5">{t('art.monitor.derisking')} </span>
        <span className="font-mono text-ink-3">{artifact.linked_risk_id}</span>
        {artifact.linked_quote && (
          <span className="text-ink-5"> — &ldquo;{artifact.linked_quote}&rdquo;</span>
        )}
      </div>

      {/* Overlap warning */}
      {artifact.overlap_warning && (
        <div className="mb-2 p-2 bg-clay/10 border border-clay/40 rounded text-[11px]">
          <div className="font-semibold text-clay mb-0.5">
            {t('art.monitor.dedup-warning')}
          </div>
          <div className="text-clay/80">
            {t('art.monitor.matches-existing')} <span className="font-mono">{artifact.overlap_warning.existing_name}</span>
            {' '}{t('art.monitor.score', { score: artifact.overlap_warning.overlap_score.toFixed(2) })}
          </div>
          <div className="text-clay/70 mt-1">{t('art.monitor.reason')} {artifact.overlap_warning.reason}</div>
        </div>
      )}

      {/* Threshold — editable in edit mode, read-only otherwise */}
      {state === 'editing' ? (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-[10px] text-ink-5 uppercase tracking-wider block mb-1">{t('art.monitor.schedule-label')}</label>
            <select
              value={editSchedule}
              onChange={(e) => setEditSchedule(e.target.value as 'daily' | 'weekly')}
              className="w-full bg-paper border border-line-2 rounded px-2 py-1 text-sm text-ink"
            >
              <option value="daily">{t('art.monitor.schedule-daily')}</option>
              <option value="weekly">{t('art.monitor.schedule-weekly')}</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-ink-5 uppercase tracking-wider block mb-1">{t('art.monitor.alert-threshold-label')}</label>
            <textarea
              value={editThreshold}
              onChange={(e) => setEditThreshold(e.target.value)}
              rows={2}
              className="w-full bg-paper border border-line-2 rounded px-2 py-1 text-sm text-ink resize-y"
            />
          </div>
          <div>
            <label className="text-[10px] text-ink-5 uppercase tracking-wider block mb-1">
              {t('art.monitor.urls-label')}
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
            <span className="text-ink-5">{t('art.monitor.alerts-when')}</span> {artifact.alert_threshold}
          </div>
          {artifact.urls_to_track && artifact.urls_to_track.length > 0 && (
            <div className="text-[11px] text-ink-5 mb-2">
              {artifact.urls_to_track.length === 1 ? t('art.monitor.url-single') : t('art.monitor.url-plural', { count: artifact.urls_to_track.length })}{' '}
              <span className="font-mono text-ink-4 break-all">
                {artifact.urls_to_track.slice(0, 2).join(', ')}
                {artifact.urls_to_track.length > 2 && ` ${t('art.monitor.url-more', { count: artifact.urls_to_track.length - 2 })}`}
              </span>
            </div>
          )}
        </>
      )}

      {/* Cost callout — credits are the only founder-facing money unit.
          Older artifacts without credit fields get a non-numeric metering
          line instead of a currency estimate. */}
      <CostCallout artifact={artifact} />

      {/* Action buttons */}
      {state === 'editing' ? (
        <div className="flex items-center gap-2 pt-2 border-t border-line-2">
          <button
            type="button"
            onClick={() => handleApply(true)}
            className="text-xs px-3 py-1.5 bg-moss hover:bg-moss/80 text-paper rounded-md transition-colors"
          >
            {t('art.common.save-apply')}
          </button>
          <button
            type="button"
            onClick={() => setState('collapsed')}
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
          destination={t('art.monitor.destination')}
          impactHint={t('art.monitor.impact-hint')}
        />
      )}
    </ArtifactCardShell>
  );
}

/**
 * Cost callout — the founder-facing "what does this cost?" line.
 *
 * Credits are the only founder-facing money unit. Credit fields are optional
 * on the artifact (added 2026-06-04); older proposals carry only a EUR
 * estimate, and there is no honest client-side conversion — the real
 * credits-per-dollar ratio is per-project and DB-driven (lib/credits.ts,
 * server-only), and the artifact's number is EUR besides. So instead of
 * inventing a figure (or leaking €), the fallback states how the cost is
 * metered; the real spend shows up on the credits balance once it runs.
 *
 * The wording deliberately frames the cost as "if applied" — the founder
 * hasn't committed yet, and saying "consumes X credits/day" present-tense
 * on a not-yet-active monitor would be misleading.
 */
function CostCallout({ artifact }: { artifact: MonitorProposalArtifact }) {
  const t = useT();
  // WEEKLY estimate is the founder-facing unit (founder directive 2026-06-11:
  // "estimate usage per week of what watcher if set"). Deterministic from the
  // cadence × per-run cost, so it ALWAYS shows — even on older proposals that
  // never carried estimated_* fields. Prefers the artifact's per-project
  // per-run estimate when present; otherwise the shared default.
  const weeklyLabel = watcherWeeklyLabel(artifact.schedule, artifact.estimated_per_run_credits);
  const runsPerWeek = watcherRunsPerWeek(artifact.schedule);

  return (
    <div className="text-xs mb-3 px-2.5 py-2 rounded bg-paper-2/60 border border-line-2 flex items-baseline gap-2 flex-wrap">
      <span className="text-ink-5 text-[10.5px] uppercase tracking-wider">
        {t('art.monitor.cost-if-applied')}
      </span>
      <span className="text-ink font-medium">{weeklyLabel}</span>
      <span className="text-ink-5 text-[11px]">
        {t('art.monitor.runs-per-week', { runs: runsPerWeek === 1 ? t('art.monitor.run-single') : t('art.monitor.run-plural', { count: runsPerWeek }) })}
      </span>
    </div>
  );
}
