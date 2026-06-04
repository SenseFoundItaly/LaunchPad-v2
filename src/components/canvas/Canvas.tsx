'use client';

/**
 * Canvas — single-scroll right pane for the chat surface.
 *
 * Stack (top → bottom):
 *   1. IdeaCanvasHeader  — pinned snapshot of idea_canvas
 *   2. SpineSection      — 7-stage validation strip, click-to-expand
 *   3. InlineSolveProgress (when active) + matched intelligence briefs
 *   4. MemorySection     — applied memory_facts list
 *   5. DepartmentSection × 5 (market / product / pricing / finance / growth)
 *
 * The old tabs (Latest / Context / Intel / Product / Pricing / Finance /
 * Growth) and CanvasHeader chrome are gone. Everything lives on one scroll.
 *
 * Artifact grouping: each Artifact carries a `department` field (set by the
 * agent or the parser fallback). Empty departments are skipped.
 *
 * Inline artifacts (option-set, action-suggestion, task, monitor-proposal,
 * budget-proposal) render inside chat bubbles; they don't reach this surface.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Artifact, Department, SolveProgressArtifact } from '@/types/artifacts';
import { parseMessageContent } from '@/lib/artifact-parser';
import { Icon, I, Pill } from '@/components/design/primitives';
import SolveProgressCard from '@/components/chat/artifacts/SolveProgressCard';
import { BriefCard } from '@/components/signals/BriefCard';
import { useIntelligenceBriefs, matchBriefs } from '@/hooks/useIntelligenceBriefs';
import { IdeaCanvasHeader } from './IdeaCanvasHeader';
import { SpineSection } from './SpineSection';
import { DepartmentSection } from './DepartmentSection';

interface CanvasEntry {
  artifact: Artifact;
  sourceMessageId: string;
  turnIndex: number;
}

interface CanvasProps {
  projectId: string;
  locale: 'en' | 'it';
  canvasEntries: CanvasEntry[];
  messages: Array<{ role: string; content: string }>;
  handleArtifactAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
  focusedMessageId: string | null;
  /** Fired when a founder clicks a skill row in the Spine breakdown. Parent
   *  sends `I choose: <label>` through the chat so the agent kicks off the
   *  skill — same convention as the inline option-set CTA. */
  onSkillClick?: (skillLabel: string) => void;
}

interface MemoryFact {
  id: string;
  fact: string;
  kind: string;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
}

const DEPT_ORDER: Department[] = ['market', 'product', 'pricing', 'finance', 'growth'];

export function Canvas({
  projectId,
  locale,
  canvasEntries,
  messages,
  handleArtifactAction,
  focusedMessageId,
  onSkillClick,
}: CanvasProps) {
  // Group entries by department. Memory is handled via the memory_facts list
  // below (top-level Memory section) — `memory` department entries (rare;
  // `fact` artifacts don't render anyway) are silently ignored here.
  const grouped = useMemo(() => {
    const map: Record<Department, CanvasEntry[]> = {
      market: [],
      product: [],
      pricing: [],
      finance: [],
      growth: [],
      memory: [],
    };
    for (const entry of canvasEntries) {
      if (entry.artifact.type === 'solve-progress') continue; // rendered separately
      const dept = (entry.artifact.department ?? 'market') as Department;
      if (!(dept in map)) {
        map.market.push(entry);
      } else {
        map[dept].push(entry);
      }
    }
    return map;
  }, [canvasEntries]);

  const hasSolveProgress = canvasEntries.some((e) => e.artifact.type === 'solve-progress');

  // Intelligence briefs proactively surfaced when their entity matches a
  // visible entity-card artifact. Same logic as the previous canvas had.
  const { briefs } = useIntelligenceBriefs(projectId);
  const matchedBriefs = useMemo(() => matchBriefs(briefs, canvasEntries), [briefs, canvasEntries]);

  const [facts, setFacts] = useState<MemoryFact[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/projects/${projectId}/intelligence`);
        if (!res.ok) return;
        const body = await res.json();
        const inner = body?.data ?? body;
        if (!cancelled) setFacts(Array.isArray(inner?.facts) ? inner.facts : []);
      } catch { /* ignore */ }
    }
    load();
    const handler = () => { if (!cancelled) load(); };
    window.addEventListener('lp-actions-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('lp-actions-changed', handler);
    };
  }, [projectId]);

  const totalArtifacts = canvasEntries.filter((e) => e.artifact.type !== 'solve-progress').length;
  const visibleDepartments = DEPT_ORDER.filter((d) => grouped[d].length > 0);
  const isEmpty = !hasSolveProgress && totalArtifacts === 0 && matchedBriefs.length === 0;

  return (
    <div
      className="lp-scroll"
      style={{ flex: 1, overflow: 'auto', padding: 20 }}
    >
      <IdeaCanvasHeader projectId={projectId} locale={locale} factCount={facts.length} />

      <SpineSection projectId={projectId} locale={locale} onSkillClick={onSkillClick} />

      {hasSolveProgress && (
        <div style={{ marginBottom: 14 }}>
          <InlineSolveProgress messages={messages} locale={locale} />
        </div>
      )}

      {matchedBriefs.length > 0 && (
        <section style={{ marginBottom: 18 }}>
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
            {locale === 'it' ? 'Intelligence correlata' : 'Related intelligence'}
          </div>
          {matchedBriefs.map((b) => (
            <BriefCard key={b.id} brief={b} />
          ))}
        </section>
      )}

      {/* Memory — applied facts the agent has recorded for this project */}
      {facts.length > 0 && (
        <section data-canvas-section="memory" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Icon d={I.book} size={13} style={{ color: 'var(--ink-3)' }} />
            <span
              className="lp-serif"
              style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}
            >
              {locale === 'it' ? 'Memoria' : 'Memory'}
            </span>
            <span
              className="lp-mono"
              style={{ fontSize: 10, color: 'var(--ink-5)' }}
            >
              ({facts.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {facts.map((f) => {
              // Back-link: a fact spawned by a chat artifact carries the
              // artifact's client_id in source_id. Find a matching canvas
              // entry — if present, clicking the fact scrolls to that card.
              const linkedEntry =
                f.source_type === 'chat' && f.source_id
                  ? canvasEntries.find((e) => e.artifact.id === f.source_id)
                  : undefined;
              const monitorLink = f.source_type === 'monitor' && f.source_id;
              const linkable = !!linkedEntry || !!monitorLink;
              const sourceLabel = linkedEntry
                ? (locale === 'it' ? 'da artefatto' : 'from artifact')
                : monitorLink
                  ? (locale === 'it' ? 'da signal' : 'from signal')
                  : f.source_type;
              return (
                <div
                  key={f.id}
                  className="lp-card"
                  role={linkable ? 'button' : undefined}
                  tabIndex={linkable ? 0 : undefined}
                  onClick={linkable ? () => {
                    if (linkedEntry) {
                      const el = document.querySelector(
                        `[data-artifact-id="${linkedEntry.artifact.id}"]`,
                      ) as HTMLElement | null;
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('lp-flash');
                        setTimeout(() => el.classList.remove('lp-flash'), 1200);
                      }
                    }
                    // monitorLink: no in-page target yet; future hook
                  } : undefined}
                  style={{
                    padding: 10,
                    cursor: linkable ? 'pointer' : 'default',
                    transition: 'border-color 100ms, background 100ms',
                  }}
                  onMouseEnter={(e) => {
                    if (linkable) {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (linkable) {
                      e.currentTarget.style.borderColor = '';
                    }
                  }}
                  title={
                    linkedEntry
                      ? (locale === 'it'
                          ? `Vai all'artefatto sorgente (${linkedEntry.artifact.type})`
                          : `Jump to source artifact (${linkedEntry.artifact.type})`)
                      : undefined
                  }
                >
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>{f.fact}</div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: 'var(--ink-5)',
                      marginTop: 4,
                      fontFamily: 'var(--f-mono)',
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                    }}
                  >
                    <span>{f.kind}</span>
                    {sourceLabel && (
                      <>
                        <span>·</span>
                        <span style={{ color: linkable ? 'var(--accent-ink)' : 'var(--ink-5)' }}>
                          {sourceLabel}{linkable ? ' →' : ''}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {visibleDepartments.map((dept) => (
        <DepartmentSection
          key={dept}
          department={dept}
          locale={locale}
          entries={grouped[dept]}
          handleArtifactAction={handleArtifactAction}
          focusedMessageId={focusedMessageId}
        />
      ))}

      {isEmpty && facts.length === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: 40,
            color: 'var(--ink-4)',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          <Icon d={I.layers} size={28} style={{ opacity: 0.4 }} />
          <p style={{ margin: 0, maxWidth: 400, lineHeight: 1.5 }}>
            {locale === 'it'
              ? 'Gli artefatti del co-pilot appariranno qui, raggruppati per dipartimento.'
              : 'Co-pilot artifacts will appear here, grouped by department.'}
          </p>
        </div>
      )}
    </div>
  );
}

// Note: not exported. Internal helper kept here so Canvas owns the full
// right-pane surface in one file.
function InlineSolveProgress({
  messages,
  locale,
}: {
  messages: Array<{ role: string; content: string }>;
  locale: 'en' | 'it';
}) {
  const latestSolve = useMemo<SolveProgressArtifact | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      const segments = parseMessageContent(m.content);
      for (const seg of segments) {
        if (seg.type === 'artifact') {
          const a = (seg as { type: 'artifact'; artifact: Artifact }).artifact;
          if (a.type === 'solve-progress') return a as SolveProgressArtifact;
        }
      }
    }
    return null;
  }, [messages]);

  if (!latestSolve) return null;

  const completed = latestSolve.stages.filter((s) => s.status === 'completed').length;
  const total = latestSolve.stages.length;
  const allDone = completed === total;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon d={I.bolt} size={14} style={{ color: allDone ? 'var(--moss)' : 'var(--accent)' }} />
        <span className="lp-serif" style={{ fontSize: 14, color: 'var(--ink-1)' }}>
          {locale === 'it' ? 'Flusso Solve' : 'Solve Flow'}
        </span>
        <Pill kind={allDone ? 'ok' : 'live'}>
          {completed}/{total}
        </Pill>
      </div>
      <SolveProgressCard artifact={latestSolve} />
    </div>
  );
}
