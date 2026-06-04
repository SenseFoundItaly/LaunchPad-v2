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
  /** Click handler for a skill row in the expanded breakdown. Convention:
   *  parent sends `I choose: <label>` through the chat — matches the existing
   *  select-option flow in chat/page.tsx so the agent kicks off the skill. */
  onSkillClick?: (skillLabel: string) => void;
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

/** Compact relative-age formatter for the skill completion timestamp.
 *  e.g. "3d ago" / "2h ago" / "12m ago". Keeps the breakdown chip small. */
function formatRelativeAge(iso: string, locale: 'en' | 'it'): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const sec = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return locale === 'it' ? `${sec}s fa` : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === 'it' ? `${min}m fa` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === 'it' ? `${hr}h fa` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return locale === 'it' ? `${day}g fa` : `${day}d ago`;
  return new Date(iso).toLocaleDateString(locale === 'it' ? 'it' : 'en');
}

export function SpineSection({ projectId, locale, onSkillClick }: SpineSectionProps) {
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
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
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
                  ? `Punteggio ${stage.overall_score.toFixed(1)}/10`
                  : `Score ${stage.overall_score.toFixed(1)}/10`}
              </span>
              <span
                className="lp-mono"
                style={{ fontSize: 10, color: 'var(--ink-5)' }}
                title={locale === 'it'
                  ? 'Il punteggio si basa sugli skill completati elencati sotto.'
                  : 'Score is derived from the completed skills listed below.'}
              >
                · {locale === 'it'
                  ? `basato su ${stage.skills_completed}/${stage.skills_total} skill`
                  : `backed by ${stage.skills_completed}/${stage.skills_total} skills`}
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
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 6,
                }}
              >
                {skillsList.map((sk) => {
                  const completion = skillMap.get(sk.id);
                  const done = completion?.status === 'completed';
                  const clickable = !!onSkillClick;
                  const verb = done
                    ? (locale === 'it' ? 'Rivedi' : 'Revisit')
                    : (locale === 'it' ? 'Avvia' : 'Start');
                  const summary = completion?.summary?.trim() || '';
                  const completedAt = completion?.completed_at || '';
                  return (
                    <button
                      key={sk.id}
                      type="button"
                      onClick={clickable ? () => onSkillClick!(sk.label) : undefined}
                      disabled={!clickable}
                      title={clickable ? `${verb} ${sk.label}${summary ? ` — ${summary}` : ''}` : sk.label}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 4,
                        padding: '6px 8px',
                        background: done ? 'var(--paper)' : 'transparent',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-s)',
                        fontSize: 11.5,
                        cursor: clickable ? 'pointer' : 'default',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        color: 'inherit',
                        transition: 'border-color 100ms, background 100ms',
                      }}
                      onMouseEnter={(e) => {
                        if (clickable) {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                          e.currentTarget.style.background = 'var(--paper)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (clickable) {
                          e.currentTarget.style.borderColor = 'var(--line)';
                          e.currentTarget.style.background = done ? 'var(--paper)' : 'transparent';
                        }
                      }}
                    >
                      {/* Header row: dot + label + verb */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                            fontWeight: done ? 500 : 400,
                          }}
                        >
                          {sk.label}
                        </span>
                        {clickable && (
                          <span
                            className="lp-mono"
                            style={{
                              fontSize: 9.5,
                              color: 'var(--ink-5)',
                              letterSpacing: 0.3,
                              textTransform: 'uppercase',
                              flexShrink: 0,
                            }}
                          >
                            {verb} →
                          </span>
                        )}
                      </div>
                      {/* Evidence row: summary excerpt + timestamp.
                          Visible only for completed skills with a real summary —
                          this is what backs the stage score. */}
                      {done && summary && (
                        <div
                          style={{
                            fontSize: 10.5,
                            color: 'var(--ink-4)',
                            lineHeight: 1.4,
                            paddingLeft: 14, // align under the label, past the dot
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            whiteSpace: 'normal',
                          }}
                        >
                          {summary}
                        </div>
                      )}
                      {done && completedAt && (
                        <div
                          className="lp-mono"
                          style={{
                            fontSize: 9.5,
                            color: 'var(--ink-5)',
                            paddingLeft: 14,
                          }}
                        >
                          {locale === 'it' ? 'completato ' : 'ran '}{formatRelativeAge(completedAt, locale)}
                        </div>
                      )}
                    </button>
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
