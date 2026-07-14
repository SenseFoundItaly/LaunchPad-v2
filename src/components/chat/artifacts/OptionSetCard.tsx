'use client';

import { useState } from 'react';
import type { OptionSet } from '@/types/artifacts';
import { splitOptionLabel } from '@/components/chat/option-label';
import { useT } from '@/components/providers/LocaleProvider';

interface OptionSetCardProps {
  artifact: OptionSet;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

type OptionSetOption = OptionSet['options'][number];

export default function OptionSetCard({ artifact, onAction }: OptionSetCardProps) {
  // Idea-shaping is no longer offered as a chat option. The full guided kickoff
  // re-runs from scratch (problem definition), and the prompt's "always include
  // next_recommended_skill" rule made it reappear every turn on a Stage-1
  // project — the loop Luca hit. It now lives ONLY as the explicit "Re-run
  // guided Idea Shaping" button in the Canvas (IdeaCanvasHeader). Strip it here
  // deterministically so no prompt drift can resurface it. The stable
  // alternatives (give input / get options / go back) are the IdeaShaping
  // quick-reply strip above the composer.
  const options = artifact.options.filter((o) => o.skill_id !== 'idea-shaping');
  if (options.length === 0) return null;
  return (
    <div className="my-3">
      <p className="text-sm text-ink-4 mb-2">{artifact.prompt}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((option) => (
          <OptionButton key={option.id} option={option} onAction={onAction} />
        ))}
      </div>
    </div>
  );
}

/**
 * One option button. Two behaviours, one rendering:
 *   - skill option (`skill_id` set): clicking RUNS the skill in real time via
 *     the existing `skill:run` streaming path (POST /skills?run=1). The button
 *     manages its own running/done/error state, mirroring the old standalone
 *     skill-suggestion card — so a skill is just an option in the set now, not
 *     a separate Run card with a redundant duplicate option.
 *   - normal option: clicking sends "I choose: <label> — <description>" back to
 *     the agent (unchanged select-option behaviour, with description forwarding).
 */
function OptionButton({
  option,
  onAction,
}: {
  option: OptionSetOption;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const t = useT();
  const isSkill = typeof option.skill_id === 'string' && option.skill_id.length > 0;
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  // UI guardrail: paragraph-length labels get split (first clause → label,
  // remainder → description) and CSS-clamped so options read as buttons, not
  // essays. Full text stays in the tooltip. The PAYLOAD always carries the FULL
  // original label (split.full): the page handler sends "I choose: <label>"
  // back to the agent, and a clamped head like "Yes" can't disambiguate similar
  // options. Only the rendering is clamped — never the send.
  const split = splitOptionLabel(option.label, option.description);

  const labelSuffix =
    state === 'running' ? ` · ${t('chat.running')}` :
    state === 'done' ? ` · ${t('common.done')}` :
    '';

  const handleClick = async () => {
    if (isSkill) {
      // Skill option: run the skill in real time. Don't re-run once running/done.
      if (state === 'running' || state === 'done') return;
      setState('running');
      try {
        await onAction('skill:run', { skill_id: option.skill_id, proposal_id: option.proposal_id });
        setState('done');
      } catch {
        setState('error');
      }
      return;
    }
    // Loop-1 verdict option (GO/PIVOT/STOP): the click IS the decision, so
    // record it via the loops route (closes the loop, unblocks Phase 2) instead
    // of sending "I choose: GO" for the model to narrate.
    if (option.loop_verdict && option.loop_id) {
      if (state === 'running' || state === 'done') return;
      setState('running');
      try {
        await onAction('verdict:record', { loop_id: option.loop_id, verdict: option.loop_verdict });
        setState('done');
      } catch {
        setState('error');
      }
      return;
    }
    // Normal option: forward label + DESCRIPTION (its stated intent) so the agent
    // EXECUTES the option rather than re-reasoning a bare label (which made
    // "Use Example A — Legal radar" get misread as a competitor watcher).
    onAction('select-option', { optionId: option.id, label: split.full, description: option.description });
  };

  return (
    <button
      type="button"
      title={split.full}
      disabled={isSkill && (state === 'running' || state === 'done')}
      onClick={handleClick}
      className="text-left min-w-0 bg-paper-2/50 border border-line-2 rounded-lg p-3 transition-all duration-200 hover:border-moss hover:bg-paper-2 focus:outline-none focus:ring-2 focus:ring-moss/40 disabled:opacity-60 disabled:cursor-default"
    >
      <span className="flex items-baseline gap-2">
        <span className="block text-sm font-medium text-ink-2 truncate flex-1 min-w-0">
          {split.label}{labelSuffix}
        </span>
        {/* No per-option credit chip: only a founder chat message costs a credit
            (1/message); skills, applies and commits are free. */}
      </span>
      {split.description && (
        <span className="block text-xs text-ink-4 mt-1 line-clamp-2">{split.description}</span>
      )}
      {state === 'error' && (
        <span className="block text-xs text-clay mt-1">{t('chat.run-failed')}</span>
      )}
    </button>
  );
}
