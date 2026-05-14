'use client';

import { use, useEffect, useState, useCallback } from 'react';
import { Pill } from '@/components/design/primitives';
import type { MondayBrief, MondayBriefSection, RecommendedAction } from '@/types';

interface BriefResponse {
  success: boolean;
  data: MondayBrief;
  error?: string;
}

export default function MondayBriefPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [brief, setBrief] = useState<MondayBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  const fetchBrief = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/brief`);
      const body: BriefResponse = await res.json();
      if (!body.success) throw new Error(body.error || 'Failed to load Brief');
      setBrief(body.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchBrief(); }, [fetchBrief]);

  async function runScanNow() {
    setTriggering(true);
    try {
      await fetch(`/api/cron?force=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, type_prefix: 'ecosystem.' }),
      });
      setTimeout(fetchBrief, 2000);
    } catch (e) {
      setError(`Scan trigger failed: ${(e as Error).message}`);
    } finally {
      setTriggering(false);
    }
  }

  if (loading && !brief) return <Skeleton />;
  if (error) return <ErrorBanner error={error} onRetry={fetchBrief} />;
  if (!brief) return <Skeleton />;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--paper)', color: 'var(--ink)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 32px' }}>
        <header style={{ marginBottom: 40, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ flex: 1 }}>
            <div className="lp-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--ink-5)', marginBottom: 8 }}>
              Monday Brief · Settimana del {formatWeekStart(brief.period_week_start)}
            </div>
            <p style={{ fontSize: 18, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              {brief.personality_intro}
            </p>
          </div>
          <button
            onClick={runScanNow}
            disabled={triggering}
            aria-label="Run Monday ecosystem scan now"
            style={{
              flexShrink: 0,
              padding: '8px 16px',
              fontSize: 12,
              borderRadius: 'var(--r-m)',
              background: triggering ? 'var(--paper-3)' : 'var(--accent)',
              color: triggering ? 'var(--ink-5)' : 'var(--accent-ink)',
              border: 'none',
              cursor: triggering ? 'default' : 'pointer',
              fontWeight: 500,
              transition: 'background .12s',
            }}
          >
            {triggering ? 'Scanning…' : 'Run scan now'}
          </button>
        </header>

        {brief.sections.length === 0 ? (
          <EmptyState onScan={runScanNow} triggering={triggering} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {brief.sections.map((section, idx) => (
              <BriefSectionView key={`${section.kind}-${idx}`} section={section} />
            ))}
          </div>
        )}

        <footer style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-5)', display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {brief.ecosystem_alerts.length} segnali · {brief.pending_actions.filter(a => a.status === 'pending' || a.status === 'edited').length} decisioni · {brief.operational_alerts.length} alert operativi
          </span>
          <span>Generato {formatTimestamp(brief.generated_at)}</span>
        </footer>
      </div>
    </div>
  );
}

// =============================================================================
// Section accent colors — CSS variable-based inline styles
// =============================================================================

const SECTION_ACCENTS: Record<string, { border: string; bg: string; dot: string }> = {
  movements:        { border: 'oklch(0.65 0.18 240 / 0.2)', bg: 'oklch(0.65 0.18 240 / 0.04)', dot: 'oklch(0.65 0.18 240)' },
  strategic_intel:  { border: 'oklch(0.65 0.18 300 / 0.2)', bg: 'oklch(0.65 0.18 300 / 0.04)', dot: 'oklch(0.65 0.18 300)' },
  decisions_needed: { border: 'oklch(0.75 0.15 60 / 0.2)',  bg: 'oklch(0.75 0.15 60 / 0.04)',  dot: 'oklch(0.75 0.15 60)' },
  actions_taken:    { border: 'oklch(0.70 0.15 155 / 0.2)', bg: 'oklch(0.70 0.15 155 / 0.04)', dot: 'oklch(0.70 0.15 155)' },
  metrics:          { border: 'oklch(0.65 0.18 20 / 0.2)',  bg: 'oklch(0.65 0.18 20 / 0.04)',  dot: 'oklch(0.65 0.18 20)' },
  fundraising:      { border: 'var(--line)',                 bg: 'var(--surface-sunk)',          dot: 'var(--ink-5)' },
};

function sectionAccent(kind: string) {
  return SECTION_ACCENTS[kind] || { border: 'var(--line)', bg: 'var(--surface-sunk)', dot: 'var(--ink-5)' };
}

// =============================================================================
// Section view — maps MondayBriefSection → rendered card
// =============================================================================

function BriefSectionView({ section }: { section: MondayBriefSection }) {
  const accent = sectionAccent(section.kind);
  return (
    <section
      className="lp-card"
      style={{ border: `1px solid ${accent.border}`, background: accent.bg, padding: 24 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent.dot, flexShrink: 0 }} />
        <h2 className="lp-mono" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--ink-2)' }}>
          {section.heading}
        </h2>
      </div>
      <p style={{ color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 16, fontSize: 13 }}>{section.narrative}</p>
      {section.artifacts && section.artifacts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {section.artifacts.map((art, i) => (
            <ArtifactCard key={i} data={art} />
          ))}
        </div>
      )}
    </section>
  );
}

// =============================================================================
// Artifact cards — generic renderer for each artifact type
// =============================================================================

function ArtifactCard({ data }: { data: Record<string, unknown> }) {
  const type = String(data.type || 'card');

  if (type === 'entity-card') {
    return (
      <div className="lp-card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              {String(data.entity_type || 'entity')}
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{String(data.name || '')}</div>
            {data.summary ? <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>{String(data.summary)}</div> : null}
            {data.source_url ? (
              <a
                href={String(data.source_url)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, display: 'inline-block' }}
              >
                Fonte ↗
              </a>
            ) : null}
          </div>
          {typeof data.score === 'number' ? (
            <div className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>
              {(data.score as number).toFixed(2)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (type === 'action-suggestion') {
    const status = String(data.status || 'pending');
    const statusKind = status === 'sent' ? 'ok' : status === 'applied' ? 'info' : 'warn';
    return (
      <div className="lp-card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {String(data.action_type || 'action')}
              </span>
              <Pill kind={statusKind as 'ok' | 'info' | 'warn'}>{status}</Pill>
              {data.estimated_impact ? (
                <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>· impatto {String(data.estimated_impact)}</span>
              ) : null}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink)' }}>{String(data.title || '')}</div>
            {data.rationale ? <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>{String(data.rationale)}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'insight-card') {
    const severity = String(data.severity || 'info');
    const sevKind = severity === 'critical' ? 'warn' : severity === 'warning' ? 'warn' : 'n';
    return (
      <div className="lp-card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Pill kind={sevKind as 'warn' | 'n'}>{severity}</Pill>
          <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>· {String(data.title || '')}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{String(data.body || '')}</div>
      </div>
    );
  }

  if (type === 'intelligence-brief') {
    const confidence = typeof data.confidence === 'number' ? data.confidence : 0;
    const confKind = confidence >= 0.8 ? 'ok' : confidence >= 0.5 ? 'info' : 'warn';
    const actions = Array.isArray(data.recommended_actions) ? data.recommended_actions as RecommendedAction[] : [];
    return (
      <div className="lp-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
              {String(data.title || '')}
            </div>
            {data.entity_name ? (
              <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {String(data.entity_name)}
              </span>
            ) : null}
          </div>
          <Pill kind={confKind as 'ok' | 'info' | 'warn'}>{Math.round(confidence * 100)}%</Pill>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 10 }}>
          {String(data.narrative || '')}
        </p>
        {data.temporal_prediction ? (
          <div style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 'var(--r-s)', background: 'var(--paper-2)', fontSize: 11, color: 'var(--ink-4)', marginBottom: 10 }}>
            {String(data.temporal_prediction)}
          </div>
        ) : null}
        {actions.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 4 }}>
            <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Recommended actions
            </div>
            {actions.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <Pill kind={a.urgency === 'immediate' ? 'warn' : a.urgency === 'this_week' ? 'info' : 'n'}>
                  {a.urgency.replace('_', ' ')}
                </Pill>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{a.action}</div>
                  {a.rationale ? <div style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 2 }}>{a.rationale}</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Unknown artifact type — render JSON as fallback
  return (
    <pre className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)', background: 'var(--surface-sunk)', borderRadius: 'var(--r-m)', padding: 8, overflowX: 'auto' }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// =============================================================================
// Empty + loading + error states
// =============================================================================

function EmptyState({ onScan, triggering }: { onScan: () => void; triggering: boolean }) {
  return (
    <div className="lp-card" style={{ padding: 48, textAlign: 'center' }}>
      <div style={{ color: 'var(--ink-3)', fontSize: 14, marginBottom: 8 }}>
        Settimana tranquilla. Niente di rilevante si è ancora mosso.
      </div>
      <div style={{ color: 'var(--ink-5)', fontSize: 12, marginBottom: 24 }}>
        È un buon momento per alzare l&apos;asticella su ciò che stai testando.
      </div>
      <button
        onClick={onScan}
        disabled={triggering}
        style={{
          padding: '8px 16px',
          fontSize: 12,
          borderRadius: 'var(--r-m)',
          background: triggering ? 'var(--paper-3)' : 'var(--accent)',
          color: triggering ? 'var(--ink-5)' : 'var(--accent-ink)',
          border: 'none',
          cursor: triggering ? 'default' : 'pointer',
          fontWeight: 500,
        }}
      >
        {triggering ? 'Scanning…' : 'Esegui uno scan ora'}
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-5)', fontSize: 13 }}>
      Caricamento Brief…
    </div>
  );
}

function ErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 400, textAlign: 'center' }}>
        <div style={{ color: 'var(--clay)', fontSize: 13, marginBottom: 8 }}>{error}</div>
        <button
          onClick={onRetry}
          style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Riprova
        </button>
      </div>
    </div>
  );
}

function formatWeekStart(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('it-IT', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}
