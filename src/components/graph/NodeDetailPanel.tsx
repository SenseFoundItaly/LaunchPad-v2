'use client';

/**
 * NodeDetailPanel — the right-hand drawer that opens when a founder clicks any
 * node in the Knowledge graph. It is the single detail surface for the graph:
 * it shows the node's full record (summary, attributes, provenance links, and
 * the relationships that connect it to the rest of the graph) and — for PENDING
 * proposals — carries the Apply / Dismiss review actions that used to live in a
 * cramped floating popover.
 *
 * Rendered as a SIBLING of the graph <svg> (never inside it): KnowledgeGraph's
 * D3 effect calls svg.selectAll('*').remove() on every re-render, so anything
 * mounted within the SVG would be wiped. Positioned absolutely against the graph
 * container so it overlays the right edge and scrolls independently.
 */

import { useEffect, useState } from 'react';
import type { GraphNode } from '@/types/graph';
import type { Source } from '@/types/artifacts';
import { coerceJson } from '@/lib/jsonb';
import { NODE_COLORS } from '@/types/graph';
import { nodeImportanceKey } from '@/lib/node-importance';
import { coerceTimeline, type TimelineEntry } from '@/lib/timeline';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey, TranslateVars } from '@/lib/i18n/messages';

// Re-exported so existing importers (KnowledgeGraph, knowledge/page) keep
// resolving TimelineEntry from here; the canonical home is @/lib/timeline.
export type { TimelineEntry };

/** A node reachable from the selected node in one hop, plus how they relate. */
export interface NodeNeighbor {
  node: GraphNode;
  relation: string;
  /** 'out' = selected → neighbor; 'in' = neighbor → selected. */
  direction: 'out' | 'in';
}

interface NodeDetailPanelProps {
  node: GraphNode | null;
  /** One-hop neighbors, precomputed by KnowledgeGraph from the edge list. */
  neighbors: NodeNeighbor[];
  onClose: () => void;
  /** Click a connected node to swap the panel to it (in-graph navigation). */
  onSelectNeighbor: (node: GraphNode) => void;
  /** Pending-only: apply the proposal into intelligence (debits 0.5 credits). */
  onApply?: (node: GraphNode) => void;
  /** Pending-only: reject the proposal (free). */
  onDismiss?: (node: GraphNode) => void;
  /** Persist an edited name/summary for this node. When provided, an Edit
   *  affordance appears so the founder can correct the node's context in place. */
  onSaveEdit?: (node: GraphNode, patch: { name?: string; summary?: string }) => Promise<void> | void;
  /** Remove one dated move from the node's timeline (founder curating a wrong or
   *  misattributed auto-added entry) without deleting the whole node. When
   *  provided, each timeline row gets a small remove affordance. */
  onDeleteTimelineEntry?: (node: GraphNode, entry: TimelineEntry) => Promise<void> | void;
}

/** snake_case / camelCase → "Title Case" for keys, relations, and type names. */
function humanize(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Hostname of a URL for a compact, readable link label. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * `attributes` should be a `Record<string, unknown>`, but legacy rows persisted
 * it DOUBLE-ENCODED — a `JSON.stringify` into the JSONB column stored a JSON
 * *string* scalar (jsonb_typeof='string'), so postgres.js reads it back as a
 * string. `Object.entries("{...}")` then enumerates the string's CHARACTERS
 * (0:'{', 1:'"', …) → garbage. Parse defensively so both shapes render.
 */
function coerceAttributes(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* not JSON — fall through to empty */
    }
  }
  return {};
}

/** Short "Jun 12" style date for a timeline row; falls back to the raw string. */
function formatMoveDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Render one free-form attribute VALUE. `attributes` is a `Record<string,
 * unknown>` captured by the agent, so a value can be a string, number, boolean,
 * an array, or a nested object — there is no schema. This baseline humanizes the
 * common shapes; it's a deliberate judgment call worth tuning (see chat note).
 */
function formatAttrValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    // Arrays of scalars → join; arrays of objects (e.g. sources) → a count, not a JSON blob.
    const allScalar = value.every((v) => v === null || typeof v !== 'object');
    if (allScalar) return value.map((v) => String(v)).join(', ');
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  if (typeof value === 'object') {
    // Rich metric objects (TAM/SAM/SOM, KPIs) carry an `estimate`/`value`/`label`
    // headline + nested sources/methodology. Surface the headline (+ one helpful
    // secondary field) instead of dumping raw JSON.
    const o = value as Record<string, unknown>;
    const scalar = (k: string) =>
      typeof o[k] === 'string' || typeof o[k] === 'number' ? String(o[k]) : null;
    const headline = scalar('estimate') ?? scalar('value') ?? scalar('label');
    if (headline) {
      const sub = scalar('methodology') ?? scalar('confidence') ?? scalar('timeframe') ?? scalar('change');
      return sub ? `${headline} · ${sub}` : headline;
    }
    // Generic object → shallow "key: scalar" pairs (skip nested), never raw JSON.
    const pairs = Object.entries(o)
      .filter(([, v]) => v !== null && v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`);
    return pairs.length > 0 ? pairs.join(' · ') : '(details)';
  }
  return String(value);
}

/** Build a human label + optional href for one provenance source. */
function describeSource(
  src: Source,
  t: (key: MessageKey, vars?: TranslateVars) => string,
): { label: string; href?: string; quote?: string } {
  switch (src.type) {
    case 'web':
      return { label: src.title || hostOf(src.url), href: src.url, quote: src.quote };
    case 'skill':
      return { label: src.title || t('kbx.source-skill', { id: src.skill_id }), quote: src.quote };
    case 'internal':
      return { label: src.title || t('kbx.source-reference', { ref: humanize(src.ref) }), quote: src.quote };
    case 'user':
      return { label: src.title || t('kbx.source-founder'), quote: src.quote };
    case 'inference':
      return { label: src.title || t('kbx.source-inferred'), quote: src.reasoning };
    default:
      return { label: t('kbx.source-generic') };
  }
}

// --- section primitives (inline styles + CSS vars, matching the graph idiom) --

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--ink-5)',
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

export default function NodeDetailPanel({
  node,
  neighbors,
  onClose,
  onSelectNeighbor,
  onApply,
  onDismiss,
  onSaveEdit,
  onDeleteTimelineEntry,
}: NodeDetailPanelProps) {
  const t = useT();
  // Timeline can be long (capped at 20 server-side); show a handful and expand.
  const [showAllMoves, setShowAllMoves] = useState(false);
  const [removingMove, setRemovingMove] = useState<string | null>(null);
  useEffect(() => { setShowAllMoves(false); }, [node?.id]);
  // In-place edit of the node's name + summary (its "context"). Drafts are
  // seeded from the node on entering edit mode; a node switch resets them.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  useEffect(() => { setEditing(false); setEditErr(null); }, [node?.id]);
  function startEdit() {
    if (!node) return;
    setDraftName(node.name ?? '');
    setDraftSummary(node.summary ?? '');
    setEditErr(null);
    setEditing(true);
  }
  async function saveEdit() {
    if (!node || !onSaveEdit) return;
    const name = draftName.trim();
    if (!name) { setEditErr(t('knowledge.edit-name-required')); return; }
    setSavingEdit(true);
    setEditErr(null);
    try {
      await onSaveEdit(node, { name, summary: draftSummary.trim() });
      setEditing(false);
    } catch (e) {
      setEditErr((e as Error).message || t('knowledge.edit-failed'));
    } finally {
      setSavingEdit(false);
    }
  }
  // Lazy AI "why this matters" — generated once on first view, cached server-side.
  // Off by default (flag); the route returns null when disabled and we keep the
  // template. Cached node.importance shows instantly with no fetch.
  const [aiImportance, setAiImportance] = useState<string | null>(null);
  useEffect(() => {
    setAiImportance(null);
    // Only pending nodes show the "why this matters" pitch (gated below), so
    // skip the fetch for applied nodes — its result would never be rendered.
    if (!node || node.importance || !node.project_id || node.reviewed_state !== 'pending') return;
    let cancelled = false;
    fetch(`/api/projects/${node.project_id}/node-importance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // CSRF guard requires this
      body: JSON.stringify({ node_id: node.id }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (!cancelled && b?.data?.importance) setAiImportance(b.data.importance); })
      .catch(() => { /* keep template */ });
    return () => { cancelled = true; };
  }, [node?.id, node?.importance, node?.project_id]);

  if (!node) return null;

  const typeColor = NODE_COLORS[node.node_type] || 'var(--ink-5)';
  const isPending = node.reviewed_state === 'pending';
  const attrs = coerceAttributes(node.attributes);
  // Timeline is rendered as its own dated section below — EXCLUDE it from the
  // generic Attributes list, or formatAttrValue would print a junk "Timeline:
  // N items" row alongside the real section.
  const timeline = coerceTimeline(attrs.timeline);
  const movesNewestFirst = timeline.slice().reverse();
  const attrEntries = Object.entries(attrs).filter(
    ([k, v]) => k !== 'timeline' && v !== null && v !== undefined && v !== '',
  );
  // coerceJson: sources may be a legacy double-encoded JSON string (jsonb string
  // scalar) → Array.isArray would be false and the Sources block render empty.
  const rawSources = coerceJson(node.sources);
  const sources = (Array.isArray(rawSources) ? rawSources : []) as Source[];
  const createdAt = node.created_at
    ? new Date(node.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <aside
      role="complementary"
      aria-label={t('kbx.details-for', { name: node.name })}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 320,
        maxWidth: '85%',
        height: '100%',
        zIndex: 20,
        background: 'var(--surface)',
        borderLeft: '1px solid var(--line)',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.10)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'lp-rise 180ms ease',
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 11,
              height: 11,
              borderRadius: '50%',
              flexShrink: 0,
              marginTop: 4,
              background: typeColor,
            }}
          />
          {editing ? (
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              aria-label={t('knowledge.edit-name-label')}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 16,
                fontWeight: 650,
                lineHeight: 1.3,
                color: 'var(--ink)',
                background: 'var(--paper-2, var(--surface))',
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '4px 7px',
              }}
            />
          ) : (
            <h3
              style={{
                flex: 1,
                minWidth: 0,
                margin: 0,
                fontSize: 16,
                fontWeight: 650,
                lineHeight: 1.3,
                color: 'var(--ink)',
              }}
            >
              {node.name}
            </h3>
          )}
          {onSaveEdit && !editing && (
            <button
              onClick={startEdit}
              aria-label={t('knowledge.edit')}
              title={t('knowledge.edit')}
              style={{
                flexShrink: 0,
                background: 'none',
                border: 'none',
                color: 'var(--ink-5)',
                cursor: 'pointer',
                padding: 2,
                lineHeight: 0,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M11.5 2.5l2 2L6 12l-2.5.5.5-2.5 7.5-7.5z" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            aria-label={t('kbx.close-details')}
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              color: 'var(--ink-5)',
              cursor: 'pointer',
              padding: 2,
              lineHeight: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="4" x2="4" y2="12" />
              <line x1="4" y1="4" x2="12" y2="12" />
            </svg>
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, marginLeft: 21 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: typeColor,
              textTransform: 'capitalize',
            }}
          >
            {humanize(node.node_type)}
          </span>
          {isPending && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--accent-ink)',
                background: 'var(--accent-wash)',
                border: '1px solid var(--accent)',
                borderRadius: 999,
                padding: '1px 7px',
              }}
            >
              {t('knowledge.detail-pending-review')}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Why this matters — a review-time pitch for WHY the founder should
            apply this proposal. Pending-only: once applied it is stale, so the
            box is hidden when the founder re-opens the now-solid node. */}
        {isPending && (
          <section style={{ background: 'var(--paper-2, var(--surface))', border: '1px solid var(--line)', borderLeft: '2px solid var(--accent)', borderRadius: 6, padding: '10px 12px' }}>
            <SectionLabel>{t('knowledge.section-why')}</SectionLabel>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>
              {node.importance || aiImportance || t(nodeImportanceKey(node.node_type))}
            </p>
          </section>
        )}

        {/* Summary — editable in edit mode. Shown even when empty while editing
            so the founder can add a summary to a bare node. */}
        {editing ? (
          <section>
            <SectionLabel>{t('knowledge.detail-summary')}</SectionLabel>
            <textarea
              value={draftSummary}
              onChange={(e) => setDraftSummary(e.target.value)}
              rows={5}
              placeholder={t('knowledge.edit-summary-placeholder')}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontSize: 13,
                lineHeight: 1.55,
                color: 'var(--ink-2)',
                background: 'var(--paper-2, var(--surface))',
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '8px 10px',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            {editErr && (
              <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--clay)' }}>{editErr}</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={saveEdit}
                disabled={savingEdit}
                style={{
                  flex: 1, fontSize: 12.5, fontWeight: 600,
                  color: 'var(--paper)', background: 'var(--ink)',
                  border: '1px solid var(--ink)', borderRadius: 'var(--r-m)',
                  padding: '7px 10px', cursor: savingEdit ? 'default' : 'pointer',
                  opacity: savingEdit ? 0.6 : 1,
                }}
              >
                {savingEdit ? t('knowledge.edit-saving') : t('knowledge.edit-save')}
              </button>
              <button
                onClick={() => { setEditing(false); setEditErr(null); }}
                disabled={savingEdit}
                style={{
                  fontSize: 12.5, fontWeight: 500, color: 'var(--ink-4)',
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  borderRadius: 'var(--r-m)', padding: '7px 12px', cursor: 'pointer',
                }}
              >
                {t('knowledge.edit-cancel')}
              </button>
            </div>
          </section>
        ) : node.summary ? (
          <section>
            <SectionLabel>{t('knowledge.detail-summary')}</SectionLabel>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-3)' }}>
              {node.summary}
            </p>
          </section>
        ) : null}

        {/* Recent moves — the entity's dated timeline of signals. This is the
            "richer, not longer" surface: each accepted signal APPENDS one entry
            here instead of spawning a node. Newest first; ~5 shown then expand.
            Rendered high (right under Summary) because recency is the reason to
            open the node. Each row can be removed individually so a wrong or
            misattributed move is curated out without deleting the whole node. */}
        {!editing && timeline.length > 0 && (
          <section>
            <SectionLabel>{t('knowledge.detail-timeline')}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(showAllMoves ? movesNewestFirst : movesNewestFirst.slice(0, 5)).map((mv, i) => {
                const when = formatMoveDate(mv.date);
                const key = mv.alert_id || `${mv.date ?? ''}-${i}`;
                const removing = removingMove === key;
                return (
                  <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 6, background: typeColor }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink-3)', wordBreak: 'break-word' }}>
                        {when && <span style={{ color: 'var(--ink-5)', fontWeight: 600 }}>{when} · </span>}
                        {mv.headline}
                      </div>
                      {mv.source_url && (
                        <a
                          href={mv.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, color: 'var(--sky)', textDecoration: 'none' }}
                        >
                          {hostOf(mv.source_url)} ↗
                        </a>
                      )}
                    </div>
                    {onDeleteTimelineEntry && (
                      <button
                        onClick={async () => {
                          setRemovingMove(key);
                          try { await onDeleteTimelineEntry(node, mv); } finally { setRemovingMove(null); }
                        }}
                        disabled={removing}
                        aria-label={t('knowledge.timeline-remove')}
                        title={t('knowledge.timeline-remove')}
                        style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--ink-6)', cursor: removing ? 'default' : 'pointer', padding: 2, lineHeight: 0, opacity: removing ? 0.4 : 1 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="4" x2="4" y2="12" />
                          <line x1="4" y1="4" x2="12" y2="12" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {movesNewestFirst.length > 5 && (
              <button
                onClick={() => setShowAllMoves((v) => !v)}
                style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--ink-5)', fontSize: 11.5, cursor: 'pointer', padding: 0 }}
              >
                {showAllMoves
                  ? t('knowledge.timeline-show-less')
                  : t('knowledge.timeline-show-more', { count: movesNewestFirst.length - 5 })}
              </button>
            )}
          </section>
        )}

        {/* Provenance links / sources */}
        {sources.length > 0 && (
          <section>
            <SectionLabel>{t('knowledge.detail-sources', { count: sources.length })}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sources.map((src, i) => {
                const { label, href, quote } = describeSource(src, t);
                return (
                  <div key={i} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--sky)', textDecoration: 'none', wordBreak: 'break-word' }}
                      >
                        {label}
                        <span style={{ color: 'var(--ink-5)', fontSize: 11 }}> · {hostOf(href)} ↗</span>
                      </a>
                    ) : (
                      <span style={{ color: 'var(--ink-3)' }}>
                        <span style={{ color: 'var(--ink-5)', fontSize: 11 }}>{humanize(src.type)}: </span>
                        {label}
                      </span>
                    )}
                    {quote && (
                      <div
                        style={{
                          marginTop: 3,
                          paddingLeft: 8,
                          borderLeft: '2px solid var(--line-2)',
                          fontSize: 11.5,
                          fontStyle: 'italic',
                          color: 'var(--ink-5)',
                        }}
                      >
                        &ldquo;{quote}&rdquo;
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Attributes */}
        {attrEntries.length > 0 && (
          <section>
            <SectionLabel>{t('knowledge.detail-attributes')}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {attrEntries.map(([key, value]) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{humanize(key)}</span>
                  <span style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.45, wordBreak: 'break-word' }}>
                    {formatAttrValue(value)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Connected nodes */}
        {neighbors.length > 0 && (
          <section>
            <SectionLabel>{t('knowledge.detail-connections', { count: neighbors.length })}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {neighbors.map((nb, i) => (
                <button
                  key={`${nb.node.id}-${i}`}
                  onClick={() => onSelectNeighbor(nb.node)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    borderRadius: 'var(--r-m)',
                    padding: '6px 6px',
                    cursor: 'pointer',
                    color: 'var(--ink-3)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunk)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: NODE_COLORS[nb.node.node_type] || 'var(--ink-5)',
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {nb.node.name}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--ink-5)', flexShrink: 0 }}>
                    {nb.direction === 'out' ? '→ ' : '← '}
                    {humanize(nb.relation).toLowerCase()}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Empty-state hint when there is nothing but a name */}
        {!node.summary && sources.length === 0 && attrEntries.length === 0 && neighbors.length === 0 && timeline.length === 0 && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-5)', lineHeight: 1.5 }}>
            {t('knowledge.detail-empty')}
          </p>
        )}

        {createdAt && (
          <div style={{ fontSize: 11, color: 'var(--ink-6)', marginTop: 'auto' }}>
            {t('knowledge.detail-captured', { date: createdAt })}
          </div>
        )}
      </div>

      {/* Pending-only review actions, pinned to the bottom */}
      {isPending && (onApply || onDismiss) && (
        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--line)' }}>
          {onApply && (
            <button
              onClick={() => onApply(node)}
              style={{
                flex: 1,
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--paper)',
                background: 'var(--ink)',
                border: '1px solid var(--ink)',
                borderRadius: 'var(--r-m)',
                padding: '8px 10px',
                cursor: 'pointer',
              }}
            >
              {t('knowledge.detail-apply')}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => onDismiss(node)}
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: 'var(--ink-4)',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-m)',
                padding: '8px 12px',
                cursor: 'pointer',
              }}
            >
              {t('knowledge.detail-dismiss')}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
