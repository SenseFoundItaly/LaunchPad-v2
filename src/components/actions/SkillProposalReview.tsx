'use client';

/**
 * SkillProposalReview — human review pane for run_skill proposals.
 *
 * Gives the run_skill Inbox approval a real card instead of a raw JSON dump:
 * which analysis, what the founder gets back, and how long it takes. Running it
 * is free (only a founder chat message costs a credit), so no cost is shown.
 * The raw payload stays one click away behind "view raw".
 */

import type { PendingAction } from '@/types';
import { Field, FieldLabel, RawPayloadToggle } from './fields';

// One-line "what you'll get" per known skill_id (launchpad-skills/<id>/).
// Unknown analyses fall back to payload.context, then a generic line.
const SKILL_OUTCOME: Record<string, string> = {
  'idea-shaping':    'Structures your idea into a scored canvas',
  'startup-scoring': 'Rates the idea across 6 dimensions',
  'market-research': 'Maps competitors + market size with sources',
  'simulation':      'Stress-tests reception across personas & risk scenarios',
  'prototype-spec':  'A build blueprint scoped to your constraints',
  'business-model':  'Pricing tiers + unit economics',
  'financial-model': '3-year projection',
};

function prettifySkillId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function SkillProposalReview({ action }: { action: PendingAction }) {
  const raw = action.edited_payload || action.payload || {};
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const skillId = typeof p.skill_id === 'string' ? p.skill_id : '';
  const skillLabel =
    (typeof p.skill_label === 'string' && p.skill_label.trim()) ||
    (skillId ? prettifySkillId(skillId) : 'Skill');
  const context = typeof p.context === 'string' ? p.context.trim() : '';
  const outcome =
    SKILL_OUTCOME[skillId] ||
    context ||
    'Runs the analysis against your project and posts the results to your workspace';

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12.5, lineHeight: 1.5 }}>
      <Field label="Analysis" value={skillLabel} />
      <Field label="What you'll get" value={outcome} multiline />
      <div>
        <FieldLabel>Duration</FieldLabel>
        <div style={{ color: 'var(--ink-2)', fontSize: 12.5 }}>
          runs ~1–2 min after approval
        </div>
      </div>
      <RawPayloadToggle payload={raw} />
    </div>
  );
}
