'use client';

import { useState } from 'react';
import { Pill } from '@/components/design/primitives';
import UnifiedReviewControls from '@/components/chat/artifacts/UnifiedReviewControls';
import { ACTION_LANE_BUTTONS } from '@/lib/inbox/adapters';
import type { InboxItem, InboxState } from '@/lib/inbox/types';

interface UnifiedInboxItemProps {
  item: InboxItem;
  onApply: (item: InboxItem) => Promise<void>;
  onReject: (item: InboxItem) => Promise<void>;
  locale: 'en' | 'it';
}

const TYPE_CHIP_STYLES: Record<string, { bg: string; fg: string }> = {
  approval:     { bg: 'var(--accent)',  fg: 'var(--ink)' },
  todo:         { bg: 'var(--sky)',     fg: 'var(--on-accent)' },
  notification: { bg: 'var(--paper-3)', fg: 'var(--ink-3)' },
};

function timeAgo(dateStr: string, now: number, locale: 'en' | 'it'): string {
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return locale === 'it' ? 'ora' : 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function AttributionChip({ item, locale }: { item: InboxItem; locale: 'en' | 'it' }) {
  if (!item.attribution) return null;
  const { sourceType, sourceLabel, seenAt, upstreamHref } = item.attribution;
  const seenDate = new Date(seenAt).toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-US', {
    month: 'short', day: 'numeric',
  });
  const label = `${sourceType} · ${sourceLabel} · ${seenDate}`;
  const chip = (
    <span
      className="lp-mono"
      style={{
        fontSize: 9.5,
        color: 'var(--ink-5)',
        background: 'var(--paper-2)',
        padding: '2px 6px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '100%',
      }}
    >
      {label}
    </span>
  );
  if (upstreamHref) {
    return (
      <a href={upstreamHref} style={{ textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
        {chip}
      </a>
    );
  }
  return chip;
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }}
    aria-hidden="true"
  >
    <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function UnifiedInboxItem({ item, onApply, onReject, locale }: UnifiedInboxItemProps) {
  const [state, setState] = useState<InboxState>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [now] = useState(() => Date.now());

  const chipStyle = TYPE_CHIP_STYLES[item.lane] ?? TYPE_CHIP_STYLES.approval;
  const hasReject = ACTION_LANE_BUTTONS[item.lane]?.hasReject ?? true;
  const isEdited = item.source === 'action' && (item.raw as { status?: string })?.status === 'edited';

  async function handleApply() {
    if (state === 'busy') return;
    setState('busy');
    setErrorMessage(null);
    try {
      await onApply(item);
      setState('applied');
    } catch (err) {
      setErrorMessage((err as Error).message);
      setState('error');
    }
  }

  async function handleReject() {
    if (state === 'busy') return;
    setState('busy');
    setErrorMessage(null);
    try {
      await onReject(item);
      setState('rejected');
    } catch (err) {
      setErrorMessage((err as Error).message);
      setState('error');
    }
  }

  function toggle() {
    setExpanded((v) => !v);
  }

  function onHeaderKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }

  return (
    <div className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Always-visible header — click anywhere on it to toggle */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={onHeaderKey}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 10,
          cursor: 'pointer',
        }}
      >
        {item.kindChip && (
          <span
            className="lp-chip"
            style={{
              background: chipStyle.bg,
              color: chipStyle.fg,
              border: 'none',
              fontSize: 10,
              flexShrink: 0,
            }}
          >
            {item.kindChip}
          </span>
        )}
        <span
          className="lp-serif"
          style={{
            flex: 1,
            fontSize: 13,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {item.title}
        </span>
        {isEdited && <Pill kind="info">edited</Pill>}
        <span
          style={{
            fontSize: 10,
            color: 'var(--ink-5)',
            fontFamily: 'var(--f-mono)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {timeAgo(item.createdAt, now, locale)}
        </span>
        {/* Inline action pills — clicking these must NOT toggle the accordion */}
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
        >
          <UnifiedReviewControls
            lane={item.lane}
            state={state}
            onApply={handleApply}
            onReject={hasReject ? handleReject : undefined}
            errorMessage={errorMessage ?? undefined}
            variant="inline"
            destination={item.destination}
            impactHint={item.impactHint}
          />
        </div>
        <ChevronIcon open={expanded} />
      </div>

      {/* Expanded body — full rationale + attribution + footer CTAs with destination/impact */}
      {expanded && (
        <div style={{ padding: '8px 10px 10px', borderTop: '1px solid var(--line)' }}>
          {item.detail && (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--ink-3)',
                lineHeight: 1.45,
                marginBottom: 8,
                whiteSpace: 'pre-wrap',
              }}
            >
              {item.detail}
            </div>
          )}
          {item.attribution && (
            <div style={{ marginBottom: 8 }}>
              <AttributionChip item={item} locale={locale} />
            </div>
          )}
          <div onClick={(e) => e.stopPropagation()}>
            <UnifiedReviewControls
              lane={item.lane}
              state={state}
              onApply={handleApply}
              onReject={hasReject ? handleReject : undefined}
              errorMessage={errorMessage ?? undefined}
              variant="footer"
              destination={item.destination}
              impactHint={item.impactHint}
            />
          </div>
        </div>
      )}
    </div>
  );
}
