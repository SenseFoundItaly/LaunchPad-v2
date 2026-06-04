'use client';

/**
 * SpineSection — horizontal 7-stage strip with click-to-expand inline detail.
 *
 * Data: GET /api/projects/{id}/intelligence (returns `stages[]` already
 * verdict-tagged + GET /api/projects/{id}/skills for per-skill completion).
 *
 * Layout: horizontal row of 7 chips. Click expands an inline detail panel
 * underneath the strip showing per-skill completion. Only one stage can be
 * open at a time.
 *
 * Verdict colors mirror IntelligenceSection (now removed).
 */

import { useEffect, useMemo, useState } from 'react';
import { STAGES } from '@/lib/stages';

type Verdict = 'strong_go' | 'go' | 'caution' | 'not_ready';

interface StageRow {
  id: string;
  name: string;
  order: number;
  color: string;
  completion_ratio: number;
  overall_score: number;
  verdict: Verdict;
  skills_total: number;
  skills_completed: number;
  last_signal: { type: string; label: string; at: string } | null;
}

interface SkillCompletion {
  skill_id: string;
  status: string;
  summary: string | null;
  completed_at: string;
}

interface SpineSectionProps {
  projectId: string;
  locale: 'en' | 'it';
}

const VERDICT_COLOR: Record<Verdict, string> = {
  strong_go: 'var(--moss)',
  go: 'var(--moss)',
  caution: 'var(--accent)',
  not_ready: 'var(--clay)',
};

const VERDICT_LABEL: Record<Verdict, { en: string; it: string }> = {
  strong_go: { en: 'STRONG GO', it: 'AVANTI FORTE' },
  go: { en: 'GO', it: 'AVANTI' },
  caution: { en: 'CAUTION', it: 'CAUTELA' },
  not_ready: { en: 'NOT READY', it: 'NON PRONTO' },
};

export function SpineSection({ projectId, locale }: SpineSectionProps) {
  const [stages, setStages] = useState<StageRow[]>([]);
  const [skills, setSkills] = useState<SkillCompletion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openStage, setOpenStage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [intelRes, skillsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/intelligence`),
          fetch(`/api/projects/${projectId}/skills`),
        ]);
        const intelBody = await intelRes.json();
        const skillsBody = await skillsRes.json();
        if (cancelled) return;
        const inner = intelBody?.data ?? intelBody;
        setStages(Array.isArray(inner?.stages) ? inner.stages : []);
        const sk = skillsBody?.data ?? skillsBody;
        setSkills(Array.isArray(sk) ? sk : []);
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

  // Lookup skill completion by skill_id once
  const skillMap = useMemo(() => {
    const m = new Map<string, SkillCompletion>();
    for (const s of skills) m.set(s.skill_id, s);
    return m;
  }, [skills]);

  if (!loaded) {
    return (
      <div style={{ fontSize: 11, color: 'var(--ink-5)', padding: '4px 0 14px' }}>
        {locale === 'it' ? 'Caricamento pipeline…' : 'Loading pipeline…'}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        className="lp-mono"
        style={{
          fontSize: 9.5,
          color: 'var(--ink-5)',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {locale === 'it' ? 'Pipeline di validazione' : 'Validation pipeline'}
      </div>
      {/* Horizontal 7-step strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(stages.length, 7)}, 1fr)`,
          gap: 6,
        }}
      >
        {stages.map((s) => {
          const isOpen = openStage === s.id;
          const verdictColor = VERDICT_COLOR[s.verdict];
          const pct = Math.round(s.completion_ratio * 100);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setOpenStage(isOpen ? null : s.id)}
              className="lp-card"
              style={{
                padding: '8px 8px 6px',
                background: isOpen ? 'var(--paper-2)' : 'var(--paper)',
                cursor: 'pointer',
                textAlign: 'left',
                border: '1px solid ' + (isOpen ? verdictColor : 'var(--line)'),
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minWidth: 0,
                color: 'inherit',
              }}
              title={s.name}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  className="lp-mono"
                  style={{ fontSize: 10, color: 'var(--ink-5)' }}
                >
                  {String(s.order).padStart(2, '0')}
                </span>
                <span
                  className="lp-mono"
                  style={{ fontSize: 9.5, color: verdictColor, letterSpacing: 0.4 }}
                >
                  {VERDICT_LABEL[s.verdict][locale]}
                </span>
              </div>
              <div
                className="lp-serif"
                style={{
                  fontSize: 11.5,
                  color: 'var(--ink)',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  minHeight: 28,
                }}
              >
                {s.name}
              </div>
              <div
                style={{
                  height: 4,
                  background: 'var(--paper-2)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: verdictColor,
                    transition: 'width 200ms ease',
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: 'var(--ink-5)',
                  fontFamily: 'var(--f-mono)',
                }}
              >
                <span>{s.overall_score.toFixed(1)}</span>
                <span>{pct}%</span>
              </div>
            </button>
          );
        })}
        {stages.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              fontSize: 11.5,
              color: 'var(--ink-5)',
              fontStyle: 'italic',
              padding: '6px 0',
            }}
          >
            {locale === 'it' ? 'Nessuno stadio ancora avviato.' : 'No stages started yet.'}
          </div>
        )}
      </div>

      {/* Expanded detail under the strip */}
      {openStage && (() => {
        const stage = stages.find((s) => s.id === openStage);
        if (!stage) return null;
        const stageDef = STAGES.find((d) => d.number === stage.order);
        const skillsList = stageDef?.skills ?? [];
        const verdictColor = VERDICT_COLOR[stage.verdict];
        return (
          <div
            className="lp-card"
            style={{
              marginTop: 8,
              padding: 12,
              background: 'var(--paper-2)',
              borderColor: verdictColor,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span
                className="lp-serif"
                style={{ fontSize: 13, color: 'var(--ink)' }}
              >
                {stage.name}
              </span>
              <span
                className="lp-mono"
                style={{ fontSize: 10, color: 'var(--ink-5)' }}
              >
                {locale === 'it'
                  ? `Punteggio ${stage.overall_score.toFixed(1)}/10 · ${Math.round(stage.completion_ratio * 100)}% completato`
                  : `Score ${stage.overall_score.toFixed(1)}/10 · ${Math.round(stage.completion_ratio * 100)}% complete`}
              </span>
            </div>
            {skillsList.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
                {locale === 'it' ? 'Nessuno skill configurato.' : 'No skills configured.'}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 6,
                }}
              >
                {skillsList.map((sk) => {
                  const completion = skillMap.get(sk.id);
                  const done = completion?.status === 'completed';
                  return (
                    <div
                      key={sk.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 8px',
                        background: done ? 'var(--paper)' : 'transparent',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-s)',
                        fontSize: 11.5,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          background: done ? 'var(--moss)' : 'var(--paper-2)',
                          border: done ? 'none' : '1px solid var(--line-2)',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          color: done ? 'var(--ink-2)' : 'var(--ink-4)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                      >
                        {sk.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {stage.last_signal && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 10.5,
                  color: 'var(--ink-5)',
                  fontFamily: 'var(--f-mono)',
                }}
              >
                {stage.last_signal.label}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
