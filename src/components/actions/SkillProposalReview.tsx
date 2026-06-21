'use client';

/**
 * SkillProposalReview — human review pane for run_skill proposals.
 *
 * run_skill is the one Inbox approval that SPENDS money the moment it's
 * applied, so it gets a real card instead of the raw JSON dump: which skill,
 * what the founder gets back, what it costs (credits — the only
 * founder-facing money unit), and how long it takes. The raw payload stays
 * one click away behind "view raw".
 *
 * Cost derivation: the proposal payload (skill-tools.ts) carries no credits
 * field — the estimate only lives in the title string ("Run X? (≈4 credits)",
 * legacy "Run X? (~€0.02, ~4 credits)"). We parse it back out; when
 * unparseable we fall back to 4, the balanced-tier default in skill-tools.ts.
 */

import type { PendingAction } from '@/types';
import { Field, FieldLabel, RawPayloadToggle } from './fields';

// One-line "what you'll get" per known skill_id (launchpad-skills/<id>/).
// Unknown skills fall back to payload.context, then a generic line.
const SKILL_OUTCOME: Record<string, string> = {
  'idea-shaping':    'Structures your idea into a scored canvas',
  'startup-scoring': 'Rates the idea across 6 dimensions',
  'market-research': 'Maps competitors + market size with sources',
  'simulation':      'Stress-tests reception across personas & risk scenarios',
  'prototype-spec':  'A build blueprint scoped to your constraints',
  'business-model':  'Pricing tiers + unit economics',
  'financial-model': '3-year projection',
};

// Mirrors the balanced-tier estimate in skill-tools.ts (premium 10 / cheap 1).
const DEFAULT_CREDITS = 4;

/**
 * Parse the credit estimate out of a run_skill title. Handles both the
 * current "(≈4 credits)" and the legacy "(~€0.02, ~4 credits)" formats.
 * Exported so the Apply button can say "Run skill (≈4 credits)".
 */
export function skillCreditsFromAction(action: PendingAction): number {
  const m = action.title?.match(/[~≈]\s*(\d+(?:\.\d+)?)\s*credits?/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_CREDITS;
}

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
    'Runs the skill against your project and posts the results to your workspace';
  const credits = skillCreditsFromAction(action);

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12.5, lineHeight: 1.5 }}>
      <Field label="Skill" value={skillLabel} />
      <Field label="What you'll get" value={outcome} multiline />
      <div style={{ display: 'flex', gap: 28 }}>
        <div>
          <FieldLabel>Est. cost</FieldLabel>
          <div style={{ color: 'var(--ink)', fontSize: 13, fontWeight: 600 }}>
            ≈{credits} credit{credits === 1 ? '' : 's'}
          </div>
          <div style={{ color: 'var(--ink-5)', fontSize: 11, marginTop: 2 }}>
            billed on actual usage
          </div>
        </div>
        <div>
          <FieldLabel>Duration</FieldLabel>
          <div style={{ color: 'var(--ink-2)', fontSize: 12.5 }}>
            runs ~1–2 min after approval
          </div>
        </div>
      </div>
      <RawPayloadToggle payload={raw} />
    </div>
  );
}
