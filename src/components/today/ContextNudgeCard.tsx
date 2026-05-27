'use client';

import { useState } from 'react';
import { Icon, I } from '@/components/design/primitives';

interface ContextNudgeCardProps {
  projectId: string;
  /** Which fields are already filled — drives which inputs render. */
  has: { has_idea: boolean; has_competitors: boolean; has_keywords: boolean };
  /** Called after a successful save so the parent can refetch the timeline. */
  onSaved: () => void;
}

/**
 * Cold-start card for the Today page.
 *
 * The proposer + correlator need ANY of (idea / competitors / keywords) to
 * produce useful output. When all three are empty, every panel below this card
 * is empty too — and the founder has no idea why.
 *
 * This card collapses that gap into 3 inputs and one Save button. It shows
 * only the fields the project hasn't filled, so a partially-onboarded project
 * sees fewer rows (not an "edit everything" form).
 *
 * Why this design (vs the alternatives — URL-only inference, generic seeds,
 * "go talk to the co-pilot"):
 *   - Founders type their one-liner faster than an agent infers it correctly.
 *   - Competitor names are the single highest-leverage input — the proposer's
 *     specificity rules and the correlator's entity-grouping both anchor on them.
 *   - Keywords come for free from the graph as soon as the chat does anything.
 */
export function ContextNudgeCard({ projectId, has, onSaved }: ContextNudgeCardProps) {
  const [problem, setProblem] = useState('');
  const [solution, setSolution] = useState('');
  const [competitorsRaw, setCompetitorsRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const competitors = competitorsRaw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Show only what's missing — a project with competitors already won't see
  // that row, so partial onboarding gets a shorter form each return visit.
  const needsIdea = !has.has_idea;
  const needsCompetitors = !has.has_competitors;

  const canSave =
    !saving &&
    ((needsIdea && (problem.trim() || solution.trim())) ||
      (needsCompetitors && competitors.length > 0));

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem: problem.trim() || undefined,
          solution: solution.trim() || undefined,
          competitors: competitors.length > 0 ? competitors : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 'var(--r-l)',
        padding: '16px 18px',
        marginBottom: 4,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon d={I.sparkles} size={14} stroke={1.4} style={{ color: 'var(--accent)' }} />
        <h2
          className="lp-serif"
          style={{ margin: 0, fontSize: 15, fontWeight: 500, letterSpacing: -0.2, color: 'var(--ink)' }}
        >
          Tell me about you.
        </h2>
      </header>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-4)' }}>
        Watchers and briefs need context to be useful. The more specific your
        moat and competitor set, the sharper the recurring signals will be.
      </p>

      {needsIdea && (
        <>
          <Field
            label="Problem"
            hint="One sentence. What pain do you solve? (Used as the founder's moat in every brief.)"
            value={problem}
            onChange={setProblem}
            placeholder="Indie devs ship features faster than they can validate them."
          />
          <Field
            label="Solution"
            hint="One sentence. How you solve it."
            value={solution}
            onChange={setSolution}
            placeholder="A co-pilot that auto-runs the validation loop while you code."
          />
        </>
      )}

      {needsCompetitors && (
        <Field
          label="Top competitors"
          hint="Comma- or newline-separated. Brand or product names — 3–5 is enough."
          value={competitorsRaw}
          onChange={setCompetitorsRaw}
          placeholder="Stripe, Linear, Notion"
          multiline
        />
      )}

      {error && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11.5,
            color: 'var(--clay)',
            fontFamily: 'var(--f-mono)',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '6px 14px',
            border: 'none',
            borderRadius: 4,
            background: canSave ? 'var(--ink)' : 'var(--ink-5)',
            color: 'var(--paper)',
            cursor: canSave ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Saving…' : 'Save & propose watchers'}
        </button>
        <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>
          {competitors.length > 0 && `${competitors.length} competitor${competitors.length === 1 ? '' : 's'} ready`}
        </span>
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const InputEl = multiline ? 'textarea' : 'input';
  return (
    <div style={{ marginBottom: 10 }}>
      <label
        className="lp-mono"
        style={{
          display: 'block',
          fontSize: 10,
          color: 'var(--ink-4)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 3,
        }}
      >
        {label}
      </label>
      <InputEl
        value={value}
        onChange={(e) => onChange((e.target as HTMLInputElement | HTMLTextAreaElement).value)}
        placeholder={placeholder}
        rows={multiline ? 2 : undefined}
        style={{
          width: '100%',
          padding: '6px 10px',
          fontSize: 12.5,
          fontFamily: 'inherit',
          color: 'var(--ink)',
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          outline: 'none',
          resize: multiline ? 'vertical' : 'none',
          lineHeight: 1.45,
        }}
      />
      <div style={{ fontSize: 10.5, color: 'var(--ink-5)', marginTop: 3, lineHeight: 1.4 }}>
        {hint}
      </div>
    </div>
  );
}
