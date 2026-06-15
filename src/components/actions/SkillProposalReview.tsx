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
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

// One-line "what you'll get" per known skill_id (launchpad-skills/<id>/).
// Values are translation keys resolved at render (hooks can't run here).
// Unknown skills fall back to payload.context, then a generic line.
const SKILL_OUTCOME_KEY: Record<string, MessageKey> = {
  'idea-shaping':    'skillui.outcome.idea-shaping',
  'startup-scoring': 'skillui.outcome.startup-scoring',
  'market-research': 'skillui.outcome.market-research',
  'simulation':      'skillui.outcome.simulation',
  'prototype-spec':  'skillui.outcome.prototype-spec',
  'business-model':  'skillui.outcome.business-model',
  'financial-model': 'skillui.outcome.financial-model',
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
  const t = useT();
  const raw = action.edited_payload || action.payload || {};
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const skillId = typeof p.skill_id === 'string' ? p.skill_id : '';
  const skillLabel =
    (typeof p.skill_label === 'string' && p.skill_label.trim()) ||
    (skillId ? prettifySkillId(skillId) : t('skillui.skill'));
  const context = typeof p.context === 'string' ? p.context.trim() : '';
  const outcomeKey = SKILL_OUTCOME_KEY[skillId];
  const outcome =
    (outcomeKey ? t(outcomeKey) : '') ||
    context ||
    t('skillui.outcome.generic');
  const credits = skillCreditsFromAction(action);

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12.5, lineHeight: 1.5 }}>
      <Field label={t('skillui.skill')} value={skillLabel} />
      <Field label={t('skillui.what-youll-get')} value={outcome} multiline />
      <div style={{ display: 'flex', gap: 28 }}>
        <div>
          <FieldLabel>{t('skillui.cost')}</FieldLabel>
          <div style={{ color: 'var(--ink)', fontSize: 13, fontWeight: 600 }}>
            {credits === 1 ? t('skillui.credits-one', { credits }) : t('skillui.credits-other', { credits })}
          </div>
        </div>
        <div>
          <FieldLabel>{t('skillui.duration')}</FieldLabel>
          <div style={{ color: 'var(--ink-2)', fontSize: 12.5 }}>
            {t('skillui.duration-estimate')}
          </div>
        </div>
      </div>
      <RawPayloadToggle payload={raw} />
    </div>
  );
}
