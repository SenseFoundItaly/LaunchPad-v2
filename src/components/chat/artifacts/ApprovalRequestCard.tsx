'use client';

import { useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';
import type { ApprovalRequestArtifact } from '@/types/artifacts';
import { ApprovalCard, type ApprovalAnswer } from '@/components/ui/ApprovalCard';
import ArtifactCardShell from './ArtifactCardShell';

/**
 * `approval-request` — a multi-question founder gate, rendered with the
 * ApprovalCard primitive.
 *
 * Scope, deliberately narrow: this GATHERS answers. It does not close a
 * validation loop, persist canvas fields, or unlock a stage. Those all belong to
 * `option-set` (verdict:record / commit:apply, with the skill-prereq lock and
 * revert-on-failed-write) and to `validation-proposal`. Adding a second path
 * that could green the spine is exactly what the founder-approval invariant
 * exists to prevent, so this type is additive and deliberately inert.
 *
 * Answers go out through the standard artifact action verb, so persistence
 * follows the same route every other card uses.
 */
export default function ApprovalRequestCard({
  artifact,
  onAction,
  defaultCollapsed,
}: {
  artifact: ApprovalRequestArtifact;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  defaultCollapsed?: boolean;
}) {
  const t = useT();
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (answers: Record<string, ApprovalAnswer>) => {
    setSubmitted(true);
    void onAction?.('approval:answer', { artifact_id: artifact.id, answers });
  };

  return (
    <ArtifactCardShell
      typeLabel={t('ui.approval.type-label')}
      title={artifact.title}
      sources={artifact.sources}
      provenance={artifact.provenance}
      exportArtifact={artifact}
      defaultCollapsed={defaultCollapsed}
    >
      <ApprovalCard
        questions={artifact.questions}
        onSubmit={handleSubmit}
        // The shell already owns dismissal (collapse / inspector), so the
        // card's own dismiss affordance would be a second, weaker one.
        dismissible={false}
      />
      {submitted && (
        <p className="lp-fade-in mt-2 text-[12px] text-ink-3">{t('ui.approval.recorded')}</p>
      )}
    </ArtifactCardShell>
  );
}
