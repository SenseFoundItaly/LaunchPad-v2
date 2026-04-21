'use client';

import { use, useEffect, useState, useCallback } from 'react';
import type { MondayBrief, MondayBriefSection } from '@/types';

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
      // Give the cron a moment before re-fetching. In Phase 1 this becomes
      // a server-sent stream so the user sees incremental results.
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
    <div className="h-full overflow-y-auto bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <header className="mb-10 flex items-start justify-between gap-6">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">
              Monday Brief · Settimana del {formatWeekStart(brief.period_week_start)}
            </div>
            <p className="text-xl text-zinc-200 leading-relaxed">
              {brief.personality_intro}
            </p>
          </div>
          <button
            onClick={runScanNow}
            disabled={triggering}
            className="shrink-0 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white transition-colors"
            aria-label="Run Monday ecosystem scan now"
          >
            {triggering ? 'Scanning…' : 'Run scan now'}
          </button>
        </header>

        {brief.sections.length === 0 ? (
          <EmptyState onScan={runScanNow} triggering={triggering} />
        ) : (
          <div className="space-y-8">
            {brief.sections.map((section, idx) => (
              <BriefSectionView key={`${section.kind}-${idx}`} section={section} />
            ))}
          </div>
        )}

        <footer className="mt-12 pt-6 border-t border-zinc-800 text-xs text-zinc-600 flex justify-between">
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
// Section view — maps MondayBriefSection → rendered card
// =============================================================================

function BriefSectionView({ section }: { section: MondayBriefSection }) {
  const accent = sectionAccent(section.kind);
  return (
    <section className={`rounded-xl border ${accent.border} ${accent.bg} p-6`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`} />
        <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">
          {section.heading}
        </h2>
      </div>
      <p className="text-zinc-300 leading-relaxed mb-4">{section.narrative}</p>
      {section.artifacts && section.artifacts.length > 0 && (
        <div className="space-y-2">
          {section.artifacts.map((art, i) => (
            <ArtifactCard key={i} data={art} />
          ))}
        </div>
      )}
    </section>
  );
}

function sectionAccent(kind: MondayBriefSection['kind']): { border: string; bg: string; dot: string } {
  switch (kind) {
    case 'movements':
      return { border: 'border-blue-500/20', bg: 'bg-blue-500/5', dot: 'bg-blue-400' };
    case 'decisions_needed':
      return { border: 'border-amber-500/20', bg: 'bg-amber-500/5', dot: 'bg-amber-400' };
    case 'actions_taken':
      return { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', dot: 'bg-emerald-400' };
    case 'metrics':
      return { border: 'border-rose-500/20', bg: 'bg-rose-500/5', dot: 'bg-rose-400' };
    default:
      return { border: 'border-zinc-800', bg: 'bg-zinc-900/40', dot: 'bg-zinc-500' };
  }
}

// =============================================================================
// Artifact card — lightweight generic renderer. Uses the same shape the
// backend emits from buildMovementsSection / buildDecisionsSection etc.
// Full-fidelity artifact rendering (using ArtifactRenderer from chat) is a
// Phase 1 polish once the wow-moment is validated.
// =============================================================================

function ArtifactCard({ data }: { data: Record<string, unknown> }) {
  const type = String(data.type || 'card');

  if (type === 'entity-card') {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
              {String(data.entity_type || 'entity')}
            </div>
            <div className="text-sm text-zinc-100 font-medium">{String(data.name || '')}</div>
            {data.summary ? <div className="text-xs text-zinc-400 mt-1">{String(data.summary)}</div> : null}
            {data.source_url ? (
              <a
                href={String(data.source_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline mt-1 inline-block"
              >
                Fonte ↗
              </a>
            ) : null}
          </div>
          {typeof data.score === 'number' ? (
            <div className="shrink-0 text-xs font-mono text-zinc-400">
              {(data.score as number).toFixed(2)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (type === 'action-suggestion') {
    const status = String(data.status || 'pending');
    const statusColor = status === 'sent' ? 'text-emerald-400' : status === 'approved' ? 'text-blue-400' : 'text-amber-400';
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">
                {String(data.action_type || 'action')}
              </span>
              <span className={`text-xs ${statusColor}`}>· {status}</span>
              {data.estimated_impact ? (
                <span className="text-xs text-zinc-500">· impatto {String(data.estimated_impact)}</span>
              ) : null}
            </div>
            <div className="text-sm text-zinc-100">{String(data.title || '')}</div>
            {data.rationale ? <div className="text-xs text-zinc-400 mt-1">{String(data.rationale)}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'insight-card') {
    const severity = String(data.severity || 'info');
    const sevColor = severity === 'critical' ? 'text-red-400' : severity === 'warning' ? 'text-amber-400' : 'text-zinc-400';
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs ${sevColor} uppercase tracking-wider`}>{severity}</span>
          <span className="text-xs text-zinc-500">· {String(data.title || '')}</span>
        </div>
        <div className="text-sm text-zinc-300">{String(data.body || '')}</div>
      </div>
    );
  }

  // Unknown artifact type — render JSON as fallback so nothing disappears silently
  return (
    <pre className="text-xs text-zinc-500 bg-zinc-900/60 rounded p-2 overflow-x-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// =============================================================================
// Empty + loading + error states — SOUL voice when nothing has happened yet
// =============================================================================

function EmptyState({ onScan, triggering }: { onScan: () => void; triggering: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
      <div className="text-zinc-300 text-base mb-2">
        Settimana tranquilla. Niente di rilevante si è ancora mosso.
      </div>
      <div className="text-zinc-500 text-sm mb-6">
        È un buon momento per alzare l&apos;asticella su ciò che stai testando.
      </div>
      <button
        onClick={onScan}
        disabled={triggering}
        className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white transition-colors"
      >
        {triggering ? 'Scanning…' : 'Esegui uno scan ora'}
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
      Caricamento Brief…
    </div>
  );
}

function ErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-md text-center">
        <div className="text-red-400 text-sm mb-2">{error}</div>
        <button onClick={onRetry} className="text-xs text-blue-400 hover:underline">
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
