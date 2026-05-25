'use client';

import { Icon, I, Pill } from '@/components/design/primitives';
import { DepthChip } from './DepthChip';
import type { Watcher } from '@/lib/watchers';

interface WatcherCardProps {
  watcher: Watcher;
  selected: boolean;
  onSelect: () => void;
  onRunNow?: () => void;
  onPause?: () => void;
}

const TOPIC_LABELS: Record<string, string> = {
  competitors: 'Competitors',
  ip: 'Patents & IP',
  trends: 'Trends',
  partnerships: 'Partnerships',
  hiring: 'Hiring',
  sentiment: 'Sentiment',
  funding: 'Funding',
  regulatory: 'Regulatory',
  pricing: 'Pricing',
  custom: 'Custom',
};

/**
 * Right-rail card. Compresses everything a founder needs to triage a
 * recurring watcher into ~80px of vertical space:
 *
 *   line 1: name + "X new" badge
 *   line 2: topic · depth · cadence
 *   line 3: last-run age + actions on hover
 */
export function WatcherCard({ watcher, selected, onSelect, onRunNow, onPause }: WatcherCardProps) {
  const hasNew = watcher.recent_finding_count > 0;
  const isPaused = watcher.status === 'paused';
  const lastRunAge = watcher.last_run_at ? humanAge(watcher.last_run_at) : 'never';

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: '100%',
        textAlign: 'left',
        background: selected ? 'var(--paper-2)' : 'transparent',
        border: 'none',
        borderLeft: selected ? '2px solid var(--ink)' : '2px solid transparent',
        padding: '10px 12px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily: 'inherit',
        opacity: isPaused ? 0.55 : 1,
      }}
    >
      {/* Row 1: name + new badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
        <span
          style={{
            flex: 1,
            fontSize: 12.5,
            fontWeight: 500,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {watcher.name}
        </span>
        {hasNew && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'var(--f-mono)',
              background: 'var(--clay)',
              color: 'var(--on-accent)',
              padding: '1px 5px',
              borderRadius: 8,
              lineHeight: 1.3,
            }}
          >
            {watcher.recent_finding_count} new
          </span>
        )}
      </div>

      {/* Row 2: topic · depth · cadence */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          {TOPIC_LABELS[watcher.topic] || watcher.topic}
        </span>
        <span style={{ color: 'var(--ink-6)', fontSize: 10 }}>·</span>
        <DepthChip depth={watcher.depth} size="xs" />
        <span style={{ color: 'var(--ink-6)', fontSize: 10 }}>·</span>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          {watcher.cadence}
        </span>
        {isPaused && <Pill kind="n">paused</Pill>}
      </div>

      {/* Row 3: last-run age + hover actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', flex: 1 }}>
          ran {lastRunAge}
        </span>
        {onRunNow && (
          <MiniBtn d={I.play} title="Run now" onClick={onRunNow} />
        )}
        {onPause && (
          <MiniBtn
            d={isPaused ? I.play : I.pause}
            title={isPaused ? 'Resume' : 'Pause'}
            onClick={onPause}
          />
        )}
      </div>
    </button>
  );
}

function MiniBtn({ d, title, onClick }: { d: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{
        width: 20,
        height: 20,
        border: 'none',
        background: 'transparent',
        color: 'var(--ink-4)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
      }}
    >
      <Icon d={d} size={11} stroke={1.4} />
    </button>
  );
}

function humanAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
