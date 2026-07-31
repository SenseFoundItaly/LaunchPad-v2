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
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import { Field, FieldLabel, RawPayloadToggle } from './fields';

// One-line "what you'll get" per known skill_id (launchpad-skills/<id>/).
// Unknown analyses fall back to payload.context, then a generic line.
const SKILL_OUTCOME: Record<string, MessageKey> = {
  'idea-shaping':    'spr.outcome-idea-shaping',
  'startup-scoring': 'spr.outcome-startup-scoring',
  'market-research': 'spr.outcome-market-research',
  'simulation':      'spr.outcome-simulation',
  'prototype-spec':  'spr.outcome-prototype-spec',
  'business-model':  'spr.outcome-business-model',
  'financial-model': 'spr.outcome-financial-model',
};

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
    (skillId ? prettifySkillId(skillId) : t('spr.skill-fallback'));
  const context = typeof p.context === 'string' ? p.context.trim() : '';
  const outcomeKey = SKILL_OUTCOME[skillId];
  const outcome = outcomeKey
    ? t(outcomeKey)
    : context || t('spr.outcome-fallback');

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12.5, lineHeight: 1.5 }}>
      <Field label={t('spr.analysis')} value={skillLabel} />
      <Field label={t('spr.what-you-get')} value={outcome} multiline />
      <div>
        <FieldLabel>{t('spr.duration')}</FieldLabel>
        <div style={{ color: 'var(--ink-2)', fontSize: 12.5 }}>
          {t('spr.duration-value')}
        </div>
      </div>
      <RawPayloadToggle payload={raw} />
    </div>
  );
}
