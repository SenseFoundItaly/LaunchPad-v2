'use client';

/**
 * SpineSection — the validation pipeline.
 *
 * Model (founder's words): a STEP (stage) is validated when all its SUBSTEPS
 * (evidence checks) are. Each substep is a plain sentence that's either
 * validated (✓ + the proof) or not yet (○ + what's missing). No scores, no
 * "evidence N/M" / "N checks" counts — a step is simply validated or not.
 *
 * Data: GET /api/projects/{id}/stages — the journey evaluator's full per-check
 * results (label + passed + evidence/gap). (The older /intelligence payload
 * only carried the counts, which is why the tiles used to show bare numbers.)
 *
 * Layout: a compact row of 7 step tiles (number · name · state). Click a tile
 * to see its substep checklist; the active step is open by default.
 */

import { useMemo, useState } from 'react';
import { useStages } from '@/hooks/useStages';
import { useRouter } from 'next/navigation';
import { checkActionPrompt } from '@/lib/journey-prompts';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

interface CheckRow {
  check: { id: string; label: string; source?: string; track?: '1A' | '1B' | '1C' };
  result: { passed: boolean; evidence?: string; gap?: string; proof?: string };
}

interface StageEval {
  stage: { id: string; number: number; label: string; tagline?: string };
  passed: number;
  total: number;
  status: 'done' | 'active' | 'pending';
  results: CheckRow[];
}

interface SpineSectionProps {
  projectId: string;
  locale: 'en' | 'it';
  /** Retained for parent compatibility. The spine no longer launches skills
   *  — it's a validation tracker — so this is currently unused. */
  onSkillClick?: (skillLabel: string) => void;
  /** Click an UNMET substep → pre-fill the chat composer with a tailored prompt
   *  to work on it (wired to the chat page's setInput). */
  onPickPrompt?: (prompt: string) => void;
}

// Canvas-field sources that have a VISIBLE home in the pinned IdeaCanvasHeader
// (the 5 fields it renders) — only these get a "view in canvas" jump.
const CANVAS_VIEW_FIELDS = new Set(['problem', 'solution', 'target_market', 'value_proposition', 'business_model']);

/** Where a validated substep's proof can be "viewed" — derived from its source.
 *  null = inline-only (no surface to jump to). */
function jumpTarget(source: string | undefined): { kind: 'canvas'; field: string } | { kind: 'know' } | null {
  if (!source) return null;
  const m = source.match(/idea_canvas\.(\w+)/);
  if (m && CANVAS_VIEW_FIELDS.has(m[1])) return { kind: 'canvas', field: m[1] };
  if (/competitor/i.test(source)) return { kind: 'know' };
  return null;
}

// Scroll the pinned Idea Canvas field into view and flash it (reuses the
// codebase's lp-flash highlight). The field carries id="canvasfield-<name>"
// (set in IdeaCanvasHeader).
function viewCanvasField(field: string) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(`canvasfield-${field}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('lp-flash');
  setTimeout(() => el.classList.remove('lp-flash'), 1300);
}

// State color + the i18n key for its label (label resolved via useT() at the
// render site; color is pure styling).
const STATE: Record<StageEval['status'], { color: string; labelKey: MessageKey }> = {
  done: { color: 'var(--moss)', labelKey: 'canvas.state-validated' },
  active: { color: 'var(--accent)', labelKey: 'canvas.state-in-progress' },
  pending: { color: 'var(--ink-5)', labelKey: 'canvas.state-not-started' },
};

// L2 Validation-Gate sub-tracks (walkthrough §2). Untracked checks render first;
// tracked checks group under these headers (mirrors the Home StageCard). Only the
// Validation Gate stage tags checks today (1A Market + 1B Technical); empty groups
// (e.g. 1C until PSF is built) are skipped.
const TRACK_LABEL: Record<'1A' | '1B' | '1C', MessageKey> = {
  '1A': 'canvas.track-1a',
  '1B': 'canvas.track-1b',
  '1C': 'canvas.track-1c',
};
const TRACK_ORDER: Array<'1A' | '1B' | '1C'> = ['1A', '1B', '1C'];

export function SpineSection({ projectId, onPickPrompt }: SpineSectionProps) {
  const t = useT();
  const router = useRouter();
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [userPicked, setUserPicked] = useState(false);
  // Which validated substep has its proof expanded (by check id).
  const [openProof, setOpenProof] = useState<string | null>(null);

  // Cached via the shared useStages hook (dedupes with the chat-header subtitle
  // onto one ['stages', projectId] query) so the spine survives tab navigation.
  // The 'stages' topic is invalidated by the lp-actions-changed bridge, so a
  // chat turn that advances the pipeline still refreshes it.
  const { data: evals = [], isLoading } = useStages(projectId);
  const loaded = !isLoading;

  // The first not-yet-validated step — the founder's current focus.
  const activeId = useMemo(
    () => evals.find((e) => e.status === 'active')?.stage.id ?? null,
    [evals],
  );

  // Default-open the active step so the founder sees their current substeps
  // without a click; once they pick a tile, respect that.
  const open = userPicked ? openStage : (openStage ?? activeId);

  if (!loaded) {
    return (
      <div style={{ fontSize: 11, color: 'var(--ink-5)', padding: '4px 0 14px' }}>
        {t('canvas.loading-pipeline')}
      </div>
    );
  }

  const openEval = open ? evals.find((e) => e.stage.id === open) ?? null : null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        className="lp-mono"
        style={{ fontSize: 9.5, color: 'var(--ink-5)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}
      >
        {t('canvas.validation-pipeline')}
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-5)', marginBottom: 6, lineHeight: 1.4 }}>
        {t('canvas.validation-pipeline-hint')}
      </div>

      {/* Horizontal 7-step strip — number · name · state. No counts. */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(evals.length, 7)}, 1fr)`, gap: 6 }}>
        {evals.map((e) => {
          const st = STATE[e.status];
          const isOpen = open === e.stage.id;
          return (
            <button
              key={e.stage.id}
              type="button"
              onClick={() => { setUserPicked(true); setOpenStage(isOpen ? null : e.stage.id); }}
              className="lp-card"
              aria-expanded={isOpen}
              title={e.stage.label}
              style={{
                padding: '8px 8px 6px',
                background: isOpen ? 'var(--paper-2)' : 'var(--paper)',
                cursor: 'pointer',
                textAlign: 'left',
                border: '1px solid ' + (isOpen ? st.color : 'var(--line)'),
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minWidth: 0,
                color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                  {String(e.stage.number).padStart(2, '0')}
                </span>
                <span
                  style={{ width: 7, height: 7, borderRadius: 4, flexShrink: 0, background: e.status === 'done' ? st.color : 'transparent', border: e.status === 'done' ? 'none' : `1.5px solid ${st.color}` }}
                  title={t(st.labelKey)}
                />
              </div>
              <div
                className="lp-serif"
                style={{
                  fontSize: 11.5,
                  color: e.status === 'pending' ? 'var(--ink-4)' : 'var(--ink)',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  minHeight: 28,
                }}
              >
                {e.stage.label}
              </div>
              <span className="lp-mono" style={{ fontSize: 9, color: st.color, letterSpacing: 0.3 }}>
                {t(st.labelKey)}
              </span>
            </button>
          );
        })}
        {evals.length === 0 && (
          <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic', padding: '6px 0' }}>
            {t('canvas.no-steps-yet')}
          </div>
        )}
      </div>

      {/* Expanded substep checklist for the open step. */}
      {openEval && (
        <div className="lp-card" style={{ marginTop: 8, padding: 12, background: 'var(--paper-2)', borderColor: STATE[openEval.status].color }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
            <span className="lp-serif" style={{ fontSize: 13, color: 'var(--ink)' }}>{openEval.stage.label}</span>
            <span className="lp-mono" style={{ fontSize: 10, color: STATE[openEval.status].color, letterSpacing: 0.3 }}>
              {t(STATE[openEval.status].labelKey)}
            </span>
          </div>
          {openEval.stage.tagline && (
            <div style={{ fontSize: 11, color: 'var(--ink-5)', marginBottom: 8, lineHeight: 1.4 }}>
              {openEval.stage.tagline}
            </div>
          )}
          {(() => {
            const renderRow = (r: CheckRow) => {
              const ok = r.result.passed;
              const isGap = !ok;
              const detail = ok ? r.result.evidence : r.result.gap;
              const rowId = r.check.id;
              const hasProof = ok && !!r.result.proof;
              const proofOpen = openProof === rowId;
              const jt = hasProof ? jumpTarget(r.check.source) : null;
              // ○ unmet → pre-fill chat to work on it; ✓ with proof → toggle the
              // inline proof. ✓ without proof = not clickable.
              const canPrefill = isGap && !!onPickPrompt;
              const clickable = canPrefill || hasProof;
              const onRowClick = canPrefill
                ? () => onPickPrompt?.(checkActionPrompt(r.check.label))
                : hasProof
                  ? () => setOpenProof(proofOpen ? null : rowId)
                  : undefined;
              return (
                <div key={rowId}>
                  <div
                    onClick={onRowClick}
                    role={clickable ? 'button' : undefined}
                    title={canPrefill ? t('canvas.ask-copilot-tooltip') : undefined}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, lineHeight: 1.4, cursor: clickable ? 'pointer' : 'default' }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 15, height: 15, borderRadius: 8, flexShrink: 0, marginTop: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, fontWeight: 700,
                        background: ok ? 'var(--moss)' : 'transparent',
                        color: ok ? 'var(--paper)' : 'var(--ink-5)',
                        border: ok ? 'none' : '1.5px solid var(--line-2)',
                      }}
                    >
                      {ok ? '✓' : ''}
                    </span>
                    <span style={{ color: ok ? 'var(--ink-2)' : 'var(--ink-3)', flex: 1, minWidth: 0 }}>
                      {r.check.label}
                      {detail && (
                        <span style={{ color: 'var(--ink-5)' }}> — {detail}</span>
                      )}
                    </span>
                    {hasProof && (
                      <span className="lp-mono" style={{ fontSize: 9.5, color: 'var(--accent)', flexShrink: 0, marginTop: 2 }}>
                        {proofOpen ? t('canvas.proof-hide') : t('canvas.proof-show')}
                      </span>
                    )}
                    {canPrefill && (
                      <span className="lp-mono" style={{ fontSize: 9.5, color: 'var(--accent)', flexShrink: 0, marginTop: 2, whiteSpace: 'nowrap' }}>
                        {t('canvas.ask-copilot-cta')}
                      </span>
                    )}
                  </div>
                  {hasProof && proofOpen && (
                    <div style={{ margin: '4px 0 2px 23px', padding: '6px 9px', background: 'var(--surface)', borderLeft: '2px solid var(--moss)', borderRadius: 4 }}>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {r.result.proof}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
                        {r.check.source && (
                          <span className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-6)' }}>
                            {t('canvas.proof-from', { source: r.check.source })}
                          </span>
                        )}
                        {jt && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (jt.kind === 'canvas') viewCanvasField(jt.field);
                              else router.push(`/project/${projectId}/knowledge`);
                            }}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--accent)' }}
                          >
                            {jt.kind === 'canvas'
                              ? t('canvas.view-in-canvas')
                              : t('canvas.view-in-know')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            };
            // Untracked checks first (every non-validation stage), then the
            // Validation Gate's 1A/1B/1C tracks under sub-headers — mirrors the
            // Home StageCard so the two surfaces read identically.
            const untracked = openEval.results.filter((r) => !r.check.track);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {untracked.map(renderRow)}
                {TRACK_ORDER.map((tk) => {
                  const rows = openEval.results.filter((r) => r.check.track === tk);
                  if (rows.length === 0) return null;
                  const done = rows.filter((r) => r.result.passed).length;
                  return (
                    <div key={tk} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 3, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
                        <span className="lp-mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: 'var(--ink-5)', textTransform: 'uppercase' }}>
                          {t(TRACK_LABEL[tk])}
                        </span>
                        <span className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)' }}>{done}/{rows.length}</span>
                      </div>
                      {rows.map(renderRow)}
                    </div>
                  );
                })}
                {openEval.results.length === 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
                    {t('canvas.no-substeps')}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
