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

import type { GraphNode } from '@/types/graph';
import type { Source } from '@/types/artifacts';
import { NODE_COLORS } from '@/types/graph';
import { KNOWLEDGE_APPLY_CREDITS } from '@/lib/credit-costs';

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
 * Render one free-form attribute VALUE. `attributes` is a `Record<string,
 * unknown>` captured by the agent, so a value can be a string, number, boolean,
 * an array, or a nested object — there is no schema. This baseline humanizes the
 * common shapes; it's a deliberate judgment call worth tuning (see chat note).
 */
function formatAttrValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    return value.map((v) => formatAttrValue(v)).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Build a human label + optional href for one provenance source. */
function describeSource(src: Source): { label: string; href?: string; quote?: string } {
  switch (src.type) {
    case 'web':
      return { label: src.title || hostOf(src.url), href: src.url, quote: src.quote };
    case 'skill':
      return { label: src.title || `Skill: ${src.skill_id}`, quote: src.quote };
    case 'internal':
      return { label: src.title || `${humanize(src.ref)} reference`, quote: src.quote };
    case 'user':
      return { label: src.title || 'Founder', quote: src.quote };
    case 'inference':
      return { label: src.title || 'Inferred', quote: src.reasoning };
    default:
      return { label: 'Source' };
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
}: NodeDetailPanelProps) {
  if (!node) return null;

  const typeColor = NODE_COLORS[node.node_type] || 'var(--ink-5)';
  const isPending = node.reviewed_state === 'pending';
  const attrEntries = Object.entries(node.attributes || {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  const sources = Array.isArray(node.sources) ? node.sources : [];
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
      aria-label={`Details for ${node.name}`}
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
          <button
            onClick={onClose}
            aria-label="Close details"
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
              Pending review
            </span>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Summary */}
        {node.summary && (
          <section>
            <SectionLabel>Summary</SectionLabel>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-3)' }}>
              {node.summary}
            </p>
          </section>
        )}

        {/* Provenance links / sources */}
        {sources.length > 0 && (
          <section>
            <SectionLabel>Sources &amp; links ({sources.length})</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sources.map((src, i) => {
                const { label, href, quote } = describeSource(src);
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
            <SectionLabel>Attributes</SectionLabel>
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
            <SectionLabel>Connections ({neighbors.length})</SectionLabel>
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
        {!node.summary && sources.length === 0 && attrEntries.length === 0 && neighbors.length === 0 && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-5)', lineHeight: 1.5 }}>
            No further detail captured for this node yet. As the Co-pilot researches,
            attributes and sources will appear here.
          </p>
        )}

        {createdAt && (
          <div style={{ fontSize: 11, color: 'var(--ink-6)', marginTop: 'auto' }}>
            Captured {createdAt}
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
              Apply · {KNOWLEDGE_APPLY_CREDITS} credits
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
              Dismiss
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
