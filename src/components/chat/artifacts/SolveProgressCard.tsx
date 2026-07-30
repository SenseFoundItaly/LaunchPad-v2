'use client';

import type { SolveProgressArtifact, SolveStageStatus } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import { TaskRows, type TaskRow, type TaskStatus } from '@/components/ui/TaskRows';
import ArtifactCardShell from './ArtifactCardShell';

/**
 * `solve-progress` — the multi-stage solve timeline.
 *
 * Now rendered with TaskRows inside the standard ArtifactCardShell. Two audit
 * findings closed at once: this card previously had NO shell (so no collapse,
 * no inspector, no export, and its sources were dropped even though it is an
 * artifact like any other), and it hand-rolled a timeline in inline styles
 * including its own injected <style> tag for a pulse keyframe.
 *
 * Stage status maps directly onto TaskRows' status, which is why TaskRows and
 * not Thinking: a solve stage carries completed/active/pending/skipped state,
 * and Thinking's rows are narrative with no status to show.
 */

/** Model output has been observed outside the typed set (e.g. 'in-progress'),
 *  which once crashed the whole chat page — anything unknown reads as pending. */
const STATUS_MAP: Record<SolveStageStatus, TaskStatus> = {
  completed: 'done',
  active: 'running',
  pending: 'pending',
  skipped: 'pending',
};

export default function SolveProgressCard({
  artifact,
  defaultCollapsed,
}: {
  artifact: SolveProgressArtifact;
  defaultCollapsed?: boolean;
}) {
  const t = useT();
  const { stages } = artifact;
  const done = stages.filter((s) => s.status === 'completed').length;

  const rows: TaskRow[] = stages.map((stage, i) => {
    const steps = [
      // Stage labels are model-generated with their own ad-hoc id space — they
      // do NOT map to the canonical journey ids, so the spine i18n helpers must
      // not be wired here (stageLabel() would only fall back to this same text).
      ...(stage.summary ? [{ label: stage.summary }] : []),
      ...(stage.skill_id && stage.status === 'completed'
        ? [{ label: t('solve.via', { skill: stage.skill_id }), meta: stage.skill_id }]
        : []),
    ];
    return {
      id: stage.id || `stage-${i}`,
      label: stage.label,
      status: STATUS_MAP[stage.status] ?? 'pending',
      index: i + 1,
      amount: stage.status === 'skipped' ? t('solve.skipped') : undefined,
      steps: steps.length > 0 ? steps : undefined,
    };
  });

  return (
    <ArtifactCardShell
      typeLabel={t('solve.title')}
      title={t('solve.title')}
      headerRight={
        <span className="lp-mono text-[10px] text-ink-5">
          {t('solve.complete', { done, total: stages.length })}
        </span>
      }
      exportArtifact={artifact}
      defaultCollapsed={defaultCollapsed}
      style={{ gridColumn: 'span 6' }}
    >
      <TaskRows rows={rows} variant="list" />
    </ArtifactCardShell>
  );
}
