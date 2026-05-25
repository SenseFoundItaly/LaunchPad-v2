'use client';

import { Icon, I } from '@/components/design/primitives';
import { DepthChip } from './DepthChip';

interface FindingRowProps {
  headline: string;
  body: string | null;
  source_url: string | null;
  watcher_name: string | null;
  kind: 'finding' | 'change';
  /** finding from an LLM scan = deep; URL diff = pulse */
  depth: 'pulse' | 'deep';
  confidence: number | null;
  relevance_score: number | null;
  brief_id: string | null;
  created_at: string;
}

/**
 * Compact one-line row for raw signals beneath the briefs. Surfaces the
 * three depth signals (depth chip, confidence, brief_id) so the founder
 * can tell at a glance which raw rows already got synthesized.
 */
export function FindingRow({
  headline,
  body,
  source_url,
  watcher_name,
  kind,
  depth,
  confidence,
  relevance_score,
  brief_id,
  created_at,
}: FindingRowProps) {
  const score = confidence ?? relevance_score ?? 0;
  const scoreColor =
    score >= 0.75 ? 'var(--moss)' : score >= 0.5 ? 'var(--ink-4)' : 'var(--ink-5)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        borderBottom: '1px solid var(--line)',
        fontSize: 12.5,
        opacity: brief_id ? 0.7 : 1,
      }}
    >
      <DepthChip depth={depth} size="xs" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontWeight: 500,
              color: 'var(--ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {headline}
          </span>
          {brief_id && (
            <span
              title="Cited in a brief above"
              style={{
                fontSize: 9.5,
                fontFamily: 'var(--f-mono)',
                color: 'var(--ink-5)',
                background: 'var(--paper-2)',
                padding: '1px 4px',
                borderRadius: 3,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                whiteSpace: 'nowrap',
              }}
            >
              in brief
            </span>
          )}
        </div>
        {body && (
          <span
            style={{
              color: 'var(--ink-4)',
              fontSize: 11.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {body}
          </span>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            color: 'var(--ink-5)',
          }}
        >
          {watcher_name && (
            <>
              <Icon d={I.signal} size={9} stroke={1.3} />
              {watcher_name}
              <span style={{ color: 'var(--ink-6)' }}>·</span>
            </>
          )}
          <span>{humanAge(created_at)}</span>
          {source_url && (
            <>
              <span style={{ color: 'var(--ink-6)' }}>·</span>
              <a
                href={source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--ink-4)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                source
                <Icon d={I.external} size={9} stroke={1.3} />
              </a>
            </>
          )}
          <span style={{ marginLeft: 'auto', color: scoreColor }}>
            {(score * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function humanAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
