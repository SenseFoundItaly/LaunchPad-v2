'use client';

/**
 * EntityGridFallback — the Graph tab's edge-less state.
 *
 * When the project has applied entities but zero mapped relationships, the
 * force-directed viz degenerates into unconnected floating dots that read as
 * "broken". Render the same entities as a labeled grid instead — name,
 * node_type pill (colored via the shared NODE_COLORS palette), summary line —
 * with a note explaining why there are no lines yet. The parent keeps the D3
 * viz for the edges>0 case.
 */

import type { GraphNode } from '@/types/graph';
import { NODE_COLORS } from '@/types/graph';
import { useT } from '@/components/providers/LocaleProvider';

export default function EntityGridFallback({ nodes }: { nodes: GraphNode[] }) {
  const t = useT();
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '20px 24px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--ink-5)',
            lineHeight: 1.5,
            padding: '8px 12px',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-m)',
          }}
        >
          {nodes.length === 1
            ? '1 entity captured — relationships appear as entities connect.'
            : `${nodes.length} entities captured — relationships appear as entities connect.`}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 10,
          }}
        >
          {nodes.map((n) => (
            <div
              key={n.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-l)',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'var(--ink-1)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 0,
                  }}
                  title={n.name}
                >
                  {n.name}
                </span>
                <NodeTypePill type={n.node_type} />
              </div>
              {n.summary && (
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--ink-4)',
                    lineHeight: 1.45,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {n.summary}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** node_type chip colored from the shared graph palette (same hues as the viz legend). */
function NodeTypePill({ type }: { type: string }) {
  const color = NODE_COLORS[type] || 'var(--ink-5)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 10,
        color: 'var(--ink-4)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      {type.replace(/_/g, ' ')}
    </span>
  );
}
