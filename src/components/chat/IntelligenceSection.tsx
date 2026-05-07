'use client';

import { useState, useEffect } from 'react';
import { Pill } from '@/components/design/primitives';

// =============================================================================
// Types
// =============================================================================

interface IntelFact {
  id: string;
  fact: string;
  kind: string;
  confidence: number;
  created_at: string;
}
interface IntelAlert {
  id: string;
  headline: string;
  body: string | null;
  source: string | null;
  source_url: string | null;
  relevance_score: number;
  alert_type: string;
  created_at: string;
}
interface IntelNode {
  id: string;
  name: string;
  node_type: string;
  summary: string | null;
  created_at: string;
}
interface IntelScore {
  overall_score: number | null;
  benchmark: string | null;
  scored_at: string | null;
}
interface IntelStage {
  id: string;
  name: string;
  order: number;
  color: string;
  completion_ratio: number;
  overall_score: number;
  verdict: 'strong_go' | 'go' | 'caution' | 'not_ready';
  skills_total: number;
  skills_completed: number;
  last_signal: { type: string; label: string; at: string } | null;
}
interface IntelData {
  facts: IntelFact[];
  alerts: IntelAlert[];
  nodes: IntelNode[];
  score: IntelScore | null;
  stages?: IntelStage[];
}

const VERDICT_COLOR: Record<IntelStage['verdict'], string> = {
  strong_go: 'var(--moss)',
  go: 'var(--moss)',
  caution: 'var(--accent)',
  not_ready: 'var(--clay)',
};
const VERDICT_LABEL: Record<IntelStage['verdict'], { en: string; it: string }> = {
  strong_go: { en: 'STRONG GO',  it: 'AVANTI FORTE' },
  go:        { en: 'GO',         it: 'AVANTI' },
  caution:   { en: 'CAUTION',    it: 'CAUTELA' },
  not_ready: { en: 'NOT READY',  it: 'NON PRONTO' },
};

function relativeTime(iso: string, locale: 'en' | 'it'): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.floor((now - then) / 1000));
  if (sec < 60) return locale === 'it' ? `${sec}s fa` : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === 'it' ? `${min}m fa` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === 'it' ? `${hr}h fa` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return locale === 'it' ? `${day}g fa` : `${day}d ago`;
  return new Date(iso).toLocaleDateString(locale === 'it' ? 'it' : 'en');
}

// =============================================================================
// IntelligenceSection — extracted from chat/page.tsx IntelligenceTab
// =============================================================================

export function IntelligenceSection({ projectId, locale }: { projectId: string; locale: 'en' | 'it' }) {
  const [data, setData] = useState<IntelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/intelligence`);
        const body = await res.json();
        if (!res.ok || body?.success === false) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const inner = body?.data ?? body;
        if (!cancelled) setData(inner);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <div style={{ padding: 40, fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
        {locale === 'it' ? 'Caricamento intelligence\u2026' : 'Loading intelligence\u2026'}
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24, fontSize: 12, color: 'var(--clay)', textAlign: 'center' }}>
        {error}
      </div>
    );
  }
  if (!data) return null;

  const stages = data.stages ?? [];
  const recentSignalCount = data.facts.length + data.alerts.length + data.nodes.length;

  return (
    <div>
      {/* Score header */}
      {data.score && data.score.overall_score !== null && (
        <div
          className="lp-card"
          style={{
            padding: 12,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--f-mono)' }}>
            {Number(data.score.overall_score).toFixed(1)}
            <span style={{ fontSize: 12, color: 'var(--ink-5)', marginLeft: 4 }}>/10</span>
          </div>
          <div style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-3)' }}>
            {data.score.benchmark || (locale === 'it' ? 'Punteggio complessivo' : 'Overall readiness')}
          </div>
          {data.score.scored_at && (
            <div style={{ fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
              {relativeTime(data.score.scored_at, locale)}
            </div>
          )}
        </div>
      )}

      {/* 7-stage strip */}
      <div className="lp-serif" style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 8 }}>
        {locale === 'it' ? 'Pipeline di validazione' : 'Validation pipeline'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        {stages.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
            {locale === 'it' ? 'Nessuno stadio ancora avviato.' : 'No stages started yet.'}
          </div>
        ) : (
          stages.map((s) => {
            const isOpen = expandedStage === s.id;
            const verdictColor = VERDICT_COLOR[s.verdict];
            const pct = Math.round(s.completion_ratio * 100);
            return (
              <div key={s.id} className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setExpandedStage(isOpen ? null : s.id)}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '20px 1fr 80px 60px 90px 14px',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'inherit',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    color: 'var(--ink-5)',
                  }}>
                    {String(s.order).padStart(2, '0')}
                  </span>
                  <span className="lp-serif" style={{ fontSize: 13, color: 'var(--ink)' }}>
                    {s.name}
                  </span>
                  <div style={{
                    height: 6,
                    background: 'var(--paper-2)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: verdictColor,
                      transition: 'width 200ms ease',
                    }} />
                  </div>
                  <span style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    color: 'var(--ink-3)',
                    textAlign: 'right',
                  }}>
                    {s.skills_completed}/{s.skills_total}
                  </span>
                  <span
                    className="lp-chip"
                    style={{
                      borderColor: verdictColor,
                      color: verdictColor,
                      fontSize: 10,
                      fontFamily: 'var(--f-mono)',
                      padding: '2px 6px',
                      textAlign: 'center',
                    }}
                  >
                    {VERDICT_LABEL[s.verdict][locale]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{isOpen ? '\u25be' : '\u25b8'}</span>
                </button>
                {isOpen && (
                  <div style={{
                    padding: '10px 12px 12px 42px',
                    borderTop: '1px solid var(--line)',
                    background: 'var(--paper-2)',
                  }}>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: 6 }}>
                      {locale === 'it'
                        ? `Punteggio ${s.overall_score.toFixed(1)}/10 \u00b7 ${pct}% completato`
                        : `Score ${s.overall_score.toFixed(1)}/10 \u00b7 ${pct}% complete`}
                    </div>
                    {s.last_signal && (
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6, fontFamily: 'var(--f-mono)' }}>
                        {s.last_signal.label} \u00b7 {relativeTime(s.last_signal.at, locale)}
                      </div>
                    )}
                    {s.skills_completed === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--ink-5)', fontStyle: 'italic', marginBottom: 6 }}>
                        {locale === 'it'
                          ? 'Stadio non avviato \u2014 esegui le skill da Readiness.'
                          : 'Stage not started \u2014 run its skills in Readiness.'}
                      </div>
                    )}
                    <a
                      href={`/project/${projectId}/readiness#stage-${s.order}`}
                      style={{
                        fontSize: 11,
                        color: 'var(--accent-ink)',
                        textDecoration: 'none',
                        fontFamily: 'var(--f-mono)',
                      }}
                    >
                      {locale === 'it' ? 'Apri in Readiness \u2192' : 'Open in Readiness \u2192'}
                    </a>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Recent signals — collapsed by default */}
      <button
        type="button"
        onClick={() => setShowRecent((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--ink-3)',
          padding: '6px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>{showRecent ? '\u25be' : '\u25b8'}</span>
        <span className="lp-serif">
          {locale === 'it' ? 'Segnali recenti' : 'Recent signals'}
        </span>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-5)' }}>
          ({recentSignalCount})
        </span>
      </button>

      {showRecent && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.facts.length > 0 && (
            <section>
              <div className="lp-serif" style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
                {locale === 'it' ? 'Fatti' : 'Facts'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.facts.map((f) => (
                  <div key={f.id} className="lp-card" style={{ padding: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>{f.fact}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
                      <span>{f.kind}</span>
                      <span>\u00b7</span>
                      <span>conf {Math.round(f.confidence * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.alerts.length > 0 && (
            <section>
              <div className="lp-serif" style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
                {locale === 'it' ? 'Alert' : 'Alerts'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.alerts.map((al) => (
                  <a
                    key={al.id}
                    href={al.source_url ?? '#'}
                    target={al.source_url ? '_blank' : undefined}
                    rel="noreferrer"
                    className="lp-card"
                    style={{
                      padding: 10,
                      textDecoration: 'none',
                      color: 'inherit',
                      display: 'block',
                      cursor: al.source_url ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>{al.headline}</div>
                    {al.body && (
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.4 }}>
                        {al.body.slice(0, 220)}{al.body.length > 220 ? '\u2026' : ''}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
                      <span>{al.alert_type.replace(/_/g, ' ')}</span>
                      {al.source && <><span>\u00b7</span><span>{al.source}</span></>}
                      <span>\u00b7</span>
                      <span>rel {Math.round(al.relevance_score * 100)}%</span>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          {data.nodes.length > 0 && (
            <section>
              <div className="lp-serif" style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
                {locale === 'it' ? 'Entit\u00e0 del grafo' : 'Graph entities'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.nodes.map((n) => (
                  <div key={n.id} className="lp-card" style={{ padding: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500 }}>{n.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
                      {n.node_type}
                    </div>
                    {n.summary && (
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.4 }}>
                        {n.summary.slice(0, 180)}{n.summary.length > 180 ? '\u2026' : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {recentSignalCount === 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
              {locale === 'it' ? 'Nessun segnale ancora.' : 'No signals yet.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
