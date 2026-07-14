'use client';

/**
 * Canvas — single-scroll right pane for the chat surface.
 *
 * Stack (top → bottom):
 *   1. IdeaCanvasHeader  — pinned snapshot of idea_canvas
 *   2. SpineSection      — 7-stage validation strip, click-to-expand
 *   3. InlineSolveProgress (when active) + matched intelligence briefs
 *   4. Knowledge         — ONE merged section: graph nodes + facts + pending
 *                          signal count (founders see a single "Knowledge"
 *                          concept; the old separate "Memory (facts)" section
 *                          is gone)
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
import Link from 'next/link';
import type { Artifact, Department, SolveProgressArtifact } from '@/types/artifacts';
import { parseMessageContent } from '@/lib/artifact-parser';
import { Icon, I, Pill } from '@/components/design/primitives';
import { PanelBoundary } from '@/components/design/PanelBoundary';
import SolveProgressCard from '@/components/chat/artifacts/SolveProgressCard';
import { BriefCard } from '@/components/signals/BriefCard';
import { useIntelligenceBriefs, matchBriefs } from '@/hooks/useIntelligenceBriefs';
import { useT } from '@/components/providers/LocaleProvider';
import { IdeaCanvasHeader } from './IdeaCanvasHeader';
import { SpineSection } from './SpineSection';
import { DepartmentSection } from './DepartmentSection';

interface CanvasEntry {
  artifact: Artifact;
  sourceMessageId: string;
  turnIndex: number;
}

/**
 * In-flight artifact block (item 9: progressive Canvas paint). Parsed from the
 * `:::artifact{…}` header of the streaming message before its body completes, so
 * the Canvas can show a dimmed skeleton in the right department while the card
 * is still arriving. Reconciled away the moment the full artifact (same id)
 * lands in `canvasEntries`.
 */
export interface PendingPlaceholder {
  id: string;
  type: string;
  department: Department;
}

interface CanvasProps {
  projectId: string;
  locale: 'en' | 'it';
  canvasEntries: CanvasEntry[];
  /** Streaming-only skeletons for artifacts mid-generation (item 9). */
  pendingPlaceholders?: PendingPlaceholder[];
  messages: Array<{ role: string; content: string }>;
  handleArtifactAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
  focusedMessageId: string | null;
  /** Fired when a founder clicks a skill row in the Spine breakdown. Parent
   *  sends `I choose: <label>` through the chat so the agent kicks off the
   *  skill — same convention as the inline option-set CTA. */
  onSkillClick?: (skillLabel: string) => void;
  /** Click an unmet Spine substep → pre-fill the chat composer with a prompt to
   *  work on it. Threaded to the chat page's setInput. */
  onPickPrompt?: (prompt: string) => void;
}

/** Applied memory_facts row (DB store name; founder-facing label is just
 *  "Knowledge" — never surface the word "memory" in this component's UI). */
interface KnowledgeFact {
  id: string;
  fact: string;
  kind: string;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
}

/** Lightweight shape of the graph_nodes the intelligence endpoint already
 *  returns. Surfaced as counts (+ names) on the Canvas so the richest layer of
 *  knowledge isn't invisible (audit M1). `reviewed_state` distinguishes
 *  founder-applied knowledge from pending PROPOSALS (born pending; rendered as
 *  "proposed" until the founder applies them on /knowledge — never auto-applied). */
interface KnowledgeNode {
  id: string;
  name: string;
  node_type: string;
  summary: string | null;
  reviewed_state?: 'applied' | 'pending';
  created_at: string;
}

const DEPT_ORDER: Department[] = ['market', 'product', 'pricing', 'finance', 'growth'];

export function Canvas({
  projectId,
  locale,
  canvasEntries,
  pendingPlaceholders,
  messages,
  handleArtifactAction,
  focusedMessageId,
  onSkillClick,
  onPickPrompt,
}: CanvasProps) {
  const t = useT();
  // Group entries by department. Facts are handled via the merged Knowledge
  // section below — `memory` department entries (rare; `fact` artifacts don't
  // render anyway) are silently ignored here.
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

  const [facts, setFacts] = useState<KnowledgeFact[]>([]);
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  // Pending graph_nodes = PROPOSALS the founder hasn't applied yet. Surfaced as
  // "proposed" so a populated-but-unapplied graph is visible (audit M1) — the
  // count is NEVER folded into knowledgeCount-as-applied; it's labelled apart.
  const [proposedNodeCount, setProposedNodeCount] = useState(0);
  // Canonical applied-knowledge total from the server (countAppliedKnowledge:
  // applied non-root nodes + applied facts, uncapped) — the SAME number the
  // NavRail badge shows. null until first load; we then fall back to the capped
  // local estimate only for older/degraded payloads (see knowledgeCount below).
  const [serverKnowledgeCount, setServerKnowledgeCount] = useState<number | null>(null);
  // `degraded` is true when the intelligence endpoint reports `partial` (a
  // facet query hiccuped) OR the fetch itself failed. Either way we must NOT
  // render a confident empty state — a transient miss shouldn't read to the
  // founder as "you know nothing" (audit M2, UI half).
  const [degraded, setDegraded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/projects/${projectId}/intelligence`);
        if (!res.ok) {
          if (!cancelled) setDegraded(true);
          return;
        }
        const body = await res.json();
        const inner = body?.data ?? body;
        if (cancelled) return;
        setFacts(Array.isArray(inner?.facts) ? inner.facts : []);
        setNodes(Array.isArray(inner?.nodes) ? inner.nodes : []);
        setAlertCount(Array.isArray(inner?.alerts) ? inner.alerts.length : 0);
        setProposedNodeCount(
          typeof inner?.proposedNodeCount === 'number'
            ? inner.proposedNodeCount
            // Fallback for older payloads: derive from the node list.
            : (Array.isArray(inner?.nodes)
                ? inner.nodes.filter((n: KnowledgeNode) => n.reviewed_state === 'pending').length
                : 0),
        );
        setServerKnowledgeCount(
          typeof inner?.knowledgeCount === 'number' ? inner.knowledgeCount : null,
        );
        setDegraded(inner?.partial === true);
      } catch {
        if (!cancelled) setDegraded(true);
      }
    }
    load();
    const handler = () => { if (!cancelled) load(); };
    window.addEventListener('lp-actions-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('lp-actions-changed', handler);
    };
  }, [projectId, reloadKey]);
  const retryIntelligence = () => setReloadKey((k) => k + 1);

  const totalArtifacts = canvasEntries.filter((e) => e.artifact.type !== 'solve-progress').length;
  const visibleDepartments = DEPT_ORDER.filter((d) => grouped[d].length > 0);
  // Item 9 — drop any placeholder whose full card has already landed (the real
  // artifact wins), then keep skeletons while the message is mid-stream.
  const activePlaceholders = useMemo(() => {
    if (!pendingPlaceholders?.length) return [] as PendingPlaceholder[];
    const have = new Set(canvasEntries.map((e) => e.artifact.id));
    return pendingPlaceholders.filter((p) => !have.has(p.id));
  }, [pendingPlaceholders, canvasEntries]);

  const isEmpty =
    !hasSolveProgress &&
    totalArtifacts === 0 &&
    matchedBriefs.length === 0 &&
    activePlaceholders.length === 0;
  // Applied-knowledge total shown in the "Knowledge — N elementi" row. Prefer
  // the canonical server count (countAppliedKnowledge — applied non-root nodes +
  // applied facts, uncapped) so this matches the NavRail badge exactly. Fall
  // back to the capped local estimate (applied nodes in the LIMIT-8 list + the
  // ≤10 facts loaded) only for older/degraded payloads where it's absent.
  // Proposed (pending) nodes are counted separately — never folded in here.
  const appliedNodeCount = nodes.filter((n) => n.reviewed_state !== 'pending').length;
  const knowledgeCount = serverKnowledgeCount ?? appliedNodeCount + facts.length;
  const hasKnowledgeRow = knowledgeCount > 0 || proposedNodeCount > 0 || alertCount > 0;

  // Skim-first collapse: artifacts from the latest chat turn render open,
  // older ones default-collapsed (ArtifactRenderer threads `defaultCollapsed`
  // down to the card shell).
  const latestTurnIndex = useMemo(
    () => canvasEntries.reduce((max, e) => Math.max(max, e.turnIndex), 0),
    [canvasEntries],
  );

  return (
    <div
      className="lp-scroll"
      style={{ flex: 1, overflow: 'auto', padding: 20 }}
    >
      {/* Every dynamic section below is boundary-wrapped like the spine: one
          corrupted artifact/brief must degrade to a muted card, not drop the
          whole Co-pilot tab to the route error screen. */}
      <PanelBoundary resetKey={projectId}>
        <IdeaCanvasHeader
          projectId={projectId}
          locale={locale}
          factCount={facts.length}
          onRelaunchIdeaShaping={() => handleArtifactAction('skill:run', { skill_id: 'idea-shaping' })}
        />
      </PanelBoundary>

      {/* Boundary-wrapped: a render throw in the validation spine (e.g. a
          corrupted stages payload) degrades to a muted card instead of taking
          down the whole Co-pilot tab via the route-level error.tsx. */}
      <PanelBoundary resetKey={projectId}>
        <SpineSection projectId={projectId} locale={locale} onSkillClick={onSkillClick} onPickPrompt={onPickPrompt} />
      </PanelBoundary>

      {hasSolveProgress && (
        <div style={{ marginBottom: 14 }}>
          <PanelBoundary resetKey={projectId}>
            <InlineSolveProgress messages={messages} locale={locale} />
          </PanelBoundary>
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
            {t('canvas.related-intelligence')}
          </div>
          {matchedBriefs.map((b) => (
            <PanelBoundary key={b.id} resetKey={projectId}>
              <BriefCard brief={b} />
            </PanelBoundary>
          ))}
        </section>
      )}

      {/* Degraded notice (audit M2, UI half) — a facet of the knowledge fetch
          hiccuped. Non-alarming + offers a retry, so a transient miss doesn't
          read as a confident "you know nothing". */}
      {degraded && (
        <section data-canvas-section="degraded" style={{ marginBottom: 18 }}>
          <div
            className="lp-card"
            style={{
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderColor: 'var(--line)',
            }}
          >
            <Icon d={I.history} size={14} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4, flex: 1 }}>
              {t('canvas.knowledge-load-partial')}
            </span>
            <button
              type="button"
              onClick={retryIntelligence}
              className="lp-mono"
              style={{
                fontSize: 11,
                color: 'var(--accent-ink)',
                background: 'var(--accent-wash)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-m)',
                padding: '3px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                flexShrink: 0,
              }}
            >
              <Icon d={I.history} size={12} />
              {t('common.retry')}
            </button>
          </div>
        </section>
      )}

      {/* Knowledge — ONE compact summary row. The node cards, facts list and
          Facts subheading moved to /knowledge (the browsing home); the Canvas
          only shows counts from the /intelligence fetch above. The word
          "memory" must not appear on this surface.

          Applied vs proposed: `knowledgeCount` is APPLIED only (founder-
          approved facts + applied nodes). `proposedNodeCount` is pending
          graph_nodes — captures the founder hasn't applied yet (audit M1: a
          populated graph used to read as empty here). Proposed is shown in a
          muted clay tone with a "review" link to /knowledge, where the existing
          Apply affordance turns them green. We NEVER fold proposed into the
          applied count or auto-apply anything. */}
      {hasKnowledgeRow && (
        <section data-canvas-section="knowledge" style={{ marginBottom: 18 }}>
          <div
            className="lp-card"
            style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Icon d={I.graph} size={13} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
            <span
              className="lp-serif"
              style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, flexShrink: 0 }}
            >
              {t('canvas.knowledge')}
            </span>
            <span
              className="lp-mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-4)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {'— '}
              {/* Applied count. When 0 applied but proposals exist, "0 items"
                  is misleading — say "nothing applied yet" so the proposed
                  segment carries the signal instead. Reuses the existing
                  canvas.knowledge-items-* keys for the non-zero case. */}
              {knowledgeCount === 0
                ? t('canvas.knowledge-none-applied')
                : knowledgeCount === 1
                  ? t('canvas.knowledge-items-one', { count: knowledgeCount })
                  : t('canvas.knowledge-items-other', { count: knowledgeCount })}
              {proposedNodeCount > 0 && (
                <>
                  {' · '}
                  <Link
                    href={`/project/${projectId}/knowledge`}
                    title={t('canvas.knowledge-review-proposed')}
                    style={{ color: 'var(--clay)', textDecoration: 'none', fontStyle: 'italic' }}
                  >
                    {proposedNodeCount === 1
                      ? t('canvas.knowledge-proposed-one', { count: proposedNodeCount })
                      : t('canvas.knowledge-proposed-other', { count: proposedNodeCount })}
                  </Link>
                </>
              )}
              {alertCount > 0 && (
                <>
                  {' · '}
                  <Link
                    href={`/project/${projectId}/actions?lane=signal`}
                    style={{ color: 'var(--clay)', textDecoration: 'none' }}
                  >
                    {alertCount === 1
                      ? t('canvas.signals-pending-one', { count: alertCount })
                      : t('canvas.signals-pending-other', { count: alertCount })}
                  </Link>
                </>
              )}
            </span>
            <Link
              href={`/project/${projectId}/knowledge`}
              className="lp-mono"
              style={{
                fontSize: 10,
                color: 'var(--accent-ink)',
                marginLeft: 'auto',
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              {proposedNodeCount > 0 ? t('canvas.knowledge-review') : t('canvas.open')} →
            </Link>
          </div>
        </section>
      )}

      {visibleDepartments.map((dept) => (
        // Per-department boundary: one malformed artifact takes down its own
        // group only — the other departments' cards keep rendering.
        <PanelBoundary key={dept} resetKey={projectId}>
          <DepartmentSection
            department={dept}
            locale={locale}
            entries={grouped[dept]}
            handleArtifactAction={handleArtifactAction}
            focusedMessageId={focusedMessageId}
            latestTurnIndex={latestTurnIndex}
          />
        </PanelBoundary>
      ))}

      {/* Item 9 — progressive paint. Dimmed skeletons for artifacts the agent is
          mid-streaming, so the Canvas fills card-by-card instead of snapping in
          all-at-once at stream end. Each reconciles to its real card by id. */}
      {activePlaceholders.length > 0 && (
        <section data-canvas-section="pending" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {activePlaceholders.map((p) => (
            <div
              key={p.id}
              className="lp-card lp-scan"
              style={{
                position: 'relative',
                overflow: 'hidden',
                padding: '12px 14px',
                borderStyle: 'dashed',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span className="lp-pulse" style={{ display: 'inline-flex', flex: 1, flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <span className="lp-serif" style={{ fontSize: 13, color: 'var(--ink-2)', textTransform: 'capitalize' }}>
                  {p.type.replace(/[-_]/g, ' ')}
                </span>
                <span style={{ height: 8, width: '70%', borderRadius: 4, background: 'var(--line)' }} />
                <span style={{ height: 8, width: '45%', borderRadius: 4, background: 'var(--line)' }} />
              </span>
              <Pill kind="live" dot>{t('canvas.generating')}</Pill>
            </div>
          ))}
        </section>
      )}

      {isEmpty && facts.length === 0 && nodes.length === 0 && alertCount === 0 && !degraded && (
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
            {t('canvas.empty-state')}
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
}: {
  messages: Array<{ role: string; content: string }>;
  locale: 'en' | 'it';
}) {
  const t = useT();
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
          {t('canvas.solve-flow')}
        </span>
        <Pill kind={allDone ? 'ok' : 'live'}>
          {completed}/{total}
        </Pill>
      </div>
      <SolveProgressCard artifact={latestSolve} />
    </div>
  );
}
