'use client';

import { useState } from 'react';
import { Pill, Icon, I } from '@/components/design/primitives';
import { DepthChip } from './DepthChip';
import { EvidenceMeter } from './EvidenceMeter';

/**
 * Input shape — the union of fields the card actually reads. Accepts both:
 *   - The bare IntelligenceBrief (from /api/projects/.../intelligence-briefs);
 *     `evidence_count` falls back to `signal_count`, `sources_consulted` to 0.
 *   - The richer TimelineBrief from /api/projects/.../timeline, which carries
 *     a pre-computed `sources_consulted` and `evidence_count`.
 *
 * One object prop keeps call sites short and immune to field-addition churn.
 */
export interface BriefCardInput {
  /** Optional — when present alongside `onSaveToKnowledge`, the footer renders
   *  a "Save to knowledge" button that converts this brief into a durable
   *  memory_fact attributed to brief.id. Both inputs default to absent so
   *  existing mount sites continue to render exactly as before. */
  id?: string;
  title: string;
  narrative: string;
  temporal_prediction: string | null;
  entity_name: string | null;
  confidence: number;
  recommended_actions: unknown[];
  created_at: string;
  /** Signals folded into this brief — falls back to `signal_count` if absent. */
  evidence_count?: number;
  signal_count?: number;
  /** Distinct source URLs across cited signals — defaults to 0 when not computed. */
  sources_consulted?: number;
}

interface BriefCardProps {
  brief: BriefCardInput;
  /** Founder confirmation that the brief is worth preserving as durable
   *  knowledge. When provided AND brief.id is set, the footer surfaces a
   *  "Save to knowledge" button. Callback must throw on failure so the card
   *  can show the error state. */
  onSaveToKnowledge?: (briefId: string) => Promise<void>;
}

/**
 * The top-of-page card. Synthesized narrative grounded in N signals + M sources,
 * with explicit prediction and "do this next" recommendation. First-class
 * surface — full prose, prediction called out, evidence meter footer.
 */
type SaveState = 'idle' | 'busy' | 'saved' | 'error';

export function BriefCard({ brief, onSaveToKnowledge }: BriefCardProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  // Brief detail (narrative + prediction + do-next callout) defaults closed so
  // the Signals page scans as a list of headlines; expand on demand.
  const [expanded, setExpanded] = useState(false);
  // Snapshot wall-clock once per mount so the fresh/age computations stay
  // pure within render (React 19 lint rule). Briefs don't tick live anyway.
  const [now] = useState(() => Date.now());
  const canSave = Boolean(brief.id && onSaveToKnowledge);

  async function handleSave() {
    if (!brief.id || !onSaveToKnowledge || saveState === 'busy') return;
    setSaveState('busy');
    setSaveError(null);
    try {
      await onSaveToKnowledge(brief.id);
      setSaveState('saved');
    } catch (err) {
      setSaveError((err as Error).message);
      setSaveState('error');
    }
  }

  function toggle() {
    setExpanded((v) => !v);
  }

  function onTitleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }

  const {
    title,
    narrative,
    temporal_prediction,
    entity_name,
    confidence,
    recommended_actions,
    created_at,
    signal_count,
  } = brief;
  const evidence_count = brief.evidence_count ?? signal_count ?? 0;
  const sources_consulted = brief.sources_consulted ?? 0;
  const ageHours = (now - new Date(created_at).getTime()) / 3_600_000;
  const isFresh = ageHours < 24;
  const topAction =
    Array.isArray(recommended_actions) && recommended_actions.length > 0
      ? (recommended_actions[0] as { title?: string; description?: string; action?: string; rationale?: string })
      : null;
  // IntelligenceBrief shape uses `action`/`rationale`; TimelineBrief shape uses
  // `title`/`description`. Normalize so the callout renders for either.
  const actionTitle = topAction?.title || topAction?.action || null;
  const actionDescription = topAction?.description || topAction?.rationale || null;

  return (
    <article
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-l)',
        padding: '14px 16px',
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: isFresh ? '0 0 0 1px var(--accent-wash)' : 'none',
      }}
    >
      {/* Always-visible chip row: depth + entity + fresh + age */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DepthChip depth="deep" />
        {entity_name && (
          <Pill kind="warn" dot={false}>
            {entity_name}
          </Pill>
        )}
        {isFresh && <Pill kind="live" dot>fresh</Pill>}
        <div style={{ flex: 1 }} />
        <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>
          {humanAge(created_at, now)}
        </span>
      </div>

      {/* Title (clickable to toggle) + chevron indicating accordion state */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={onTitleKey}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}
      >
        <h3
          className="lp-serif"
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: -0.2,
            lineHeight: 1.25,
            color: 'var(--ink)',
            flex: 1,
          }}
        >
          {title}
        </h3>
        <ChevronIcon open={expanded} />
      </div>

      {/* Detail body — hidden by default. Narrative + prediction + do-next live here. */}
      {expanded && (
        <>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}>
            {narrative}
          </p>

          {temporal_prediction && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '8px 10px',
                background: 'var(--paper-2)',
                borderLeft: '2px solid var(--accent)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--ink-2)',
              }}
            >
              <Icon d={I.sparkles} size={12} stroke={1.4} style={{ color: 'var(--accent)', marginTop: 1, flexShrink: 0 }} />
              <span>
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 6 }}>
                  Prediction
                </span>
                {temporal_prediction}
              </span>
            </div>
          )}

          {actionTitle && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '8px 10px',
                background: 'var(--paper-2)',
                borderLeft: '2px solid var(--moss)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--ink-2)',
              }}
            >
              <Icon d={I.arrow} size={12} stroke={1.4} style={{ color: 'var(--moss)', marginTop: 1, flexShrink: 0 }} />
              <span>
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 6 }}>
                  Do next
                </span>
                <strong style={{ fontWeight: 600 }}>{actionTitle}</strong>
                {actionDescription && (
                  <span style={{ color: 'var(--ink-4)' }}> · {actionDescription}</span>
                )}
              </span>
            </div>
          )}
        </>
      )}

      {/* Footer: evidence meter + optional save-to-knowledge. Always visible — these
          are the trust signal + primary action. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, gap: 8 }}>
        <EvidenceMeter
          sources={sources_consulted}
          signals={evidence_count}
          confidence={confidence}
        />
        {canSave && <SaveToKnowledgeButton state={saveState} onClick={handleSave} />}
      </div>
      {saveError && (
        <div
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--clay)', marginTop: -4 }}
        >
          {saveError}
        </div>
      )}
    </article>
  );
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0, marginTop: 4 }}
    aria-hidden="true"
  >
    <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function SaveToKnowledgeButton({ state, onClick }: { state: SaveState; onClick: () => void }) {
  if (state === 'saved') {
    return (
      <span
        className="text-[10px] px-2 py-0.5 rounded-full bg-moss-wash text-moss font-medium"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
      >
        <Icon d={I.check} size={10} stroke={1.6} />
        In knowledge
      </span>
    );
  }
  const isBusy = state === 'busy';
  const isError = state === 'error';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 500,
        padding: '3px 8px',
        border: '1px solid var(--line)',
        borderRadius: 4,
        background: isError ? 'color-mix(in srgb, var(--clay) 8%, var(--surface))' : 'var(--surface)',
        color: isError ? 'var(--clay)' : 'var(--ink-3)',
        cursor: isBusy ? 'wait' : 'pointer',
        opacity: isBusy ? 0.7 : 1,
        fontFamily: 'inherit',
        flexShrink: 0,
      }}
    >
      <Icon d={I.sparkles} size={10} stroke={1.4} />
      {isBusy ? 'Saving…' : isError ? 'Retry' : 'Save to knowledge'}
    </button>
  );
}

function humanAge(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
