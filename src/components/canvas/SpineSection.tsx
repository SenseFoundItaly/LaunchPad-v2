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

import { useEffect, useMemo, useState } from 'react';

interface CheckRow {
  check: { id: string; label: string; source?: string };
  result: { passed: boolean; evidence?: string; gap?: string };
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
}

const STATE: Record<StageEval['status'], { color: string; en: string; it: string }> = {
  done: { color: 'var(--moss)', en: 'Validated', it: 'Validato' },
  active: { color: 'var(--accent)', en: 'In progress', it: 'In corso' },
  pending: { color: 'var(--ink-5)', en: 'Not started', it: 'Da iniziare' },
};

export function SpineSection({ projectId, locale }: SpineSectionProps) {
  const [evals, setEvals] = useState<StageEval[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [userPicked, setUserPicked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/projects/${projectId}/stages`);
        const body = await res.json();
        if (cancelled) return;
        const inner = body?.data ?? body;
        const list: StageEval[] = Array.isArray(inner?.evaluations) ? inner.evaluations : [];
        list.sort((a, b) => a.stage.number - b.stage.number);
        setEvals(list);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    const handler = () => { if (!cancelled) load(); };
    window.addEventListener('lp-actions-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('lp-actions-changed', handler);
    };
  }, [projectId]);

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
        {locale === 'it' ? 'Caricamento pipeline…' : 'Loading pipeline…'}
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
        {locale === 'it' ? 'Pipeline di validazione' : 'Validation pipeline'}
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-5)', marginBottom: 6, lineHeight: 1.4 }}>
        {locale === 'it'
          ? 'Un passo è validato quando tutti i suoi sotto-passi lo sono.'
          : 'A step is validated when all its substeps are.'}
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
                  title={st[locale]}
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
                {st[locale]}
              </span>
            </button>
          );
        })}
        {evals.length === 0 && (
          <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic', padding: '6px 0' }}>
            {locale === 'it' ? 'Nessuno passo ancora avviato.' : 'No steps started yet.'}
          </div>
        )}
      </div>

      {/* Expanded substep checklist for the open step. */}
      {openEval && (
        <div className="lp-card" style={{ marginTop: 8, padding: 12, background: 'var(--paper-2)', borderColor: STATE[openEval.status].color }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
            <span className="lp-serif" style={{ fontSize: 13, color: 'var(--ink)' }}>{openEval.stage.label}</span>
            <span className="lp-mono" style={{ fontSize: 10, color: STATE[openEval.status].color, letterSpacing: 0.3 }}>
              {STATE[openEval.status][locale]}
            </span>
          </div>
          {openEval.stage.tagline && (
            <div style={{ fontSize: 11, color: 'var(--ink-5)', marginBottom: 8, lineHeight: 1.4 }}>
              {openEval.stage.tagline}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {openEval.results.map((r, i) => {
              const ok = r.result.passed;
              const detail = ok ? r.result.evidence : r.result.gap;
              return (
                <div key={r.check.id || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, lineHeight: 1.4 }}>
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
                  <span style={{ color: ok ? 'var(--ink-2)' : 'var(--ink-3)' }}>
                    {r.check.label}
                    {detail && (
                      <span style={{ color: 'var(--ink-5)' }}> — {detail}</span>
                    )}
                  </span>
                </div>
              );
            })}
            {openEval.results.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
                {locale === 'it' ? 'Nessun sotto-passo definito.' : 'No substeps defined.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
