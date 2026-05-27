'use client';

import { useState, useEffect, useCallback } from 'react';
import { Icon, I, Pill } from '@/components/design/primitives';
import { DepthChip } from './DepthChip';
import type { WatcherTopic, WatcherKind, WatcherDepth, WatcherCadence } from '@/lib/watchers';

interface ProposedWatcher {
  name: string;
  topic: WatcherTopic;
  kind: WatcherKind;
  depth: WatcherDepth;
  cadence: WatcherCadence;
  rationale: string;
  inputs: {
    urls?: string[];
    keywords?: string[];
    competitor_names?: string[];
  };
}

interface SuggestionsDrawerProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onAccepted: () => void;
}

type FetchStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

/**
 * Right-side drawer for accept-or-reject of proposed watchers.
 *
 * Flow: open → POST /watchers/suggest → render list with checkboxes →
 * POST /watchers/accept → close + refresh parent timeline.
 *
 * Each row shows the four signals that distinguish a good proposal from
 * a generic one: depth/cadence/topic/kind chips + the rationale citing
 * the project context.
 */
export function SuggestionsDrawer({ open, projectId, onClose, onAccepted }: SuggestionsDrawerProps) {
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposedWatcher[]>([]);
  const [skippedReason, setSkippedReason] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [accepting, setAccepting] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    setProposals([]);
    setSelected(new Set());
    setSkippedReason(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/watchers/suggest`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setErrorMsg(body.error || `HTTP ${res.status}`);
        setStatus('error');
        return;
      }
      const list = (body.data?.proposed || []) as ProposedWatcher[];
      const reason = (body.data?.skipped_reason || null) as string | null;
      setProposals(list);
      setSkippedReason(reason);
      if (list.length === 0) {
        setStatus('empty');
      } else {
        setStatus('ready');
        // Pre-select all proposals — founder unchecks what they don't want
        setSelected(new Set(list.map((_, i) => i)));
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus('error');
    }
  }, [projectId]);

  useEffect(() => {
    if (open) fetchSuggestions();
  }, [open, fetchSuggestions]);

  function toggle(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function handleAccept() {
    const items = proposals.filter((_, i) => selected.has(i));
    if (items.length === 0) return;
    setAccepting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/watchers/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: items }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setErrorMsg(body.error || `HTTP ${res.status}`);
        setAccepting(false);
        return;
      }
      onAccepted();
      onClose();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setAccepting(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.18)',
          zIndex: 80,
        }}
      />
      {/* Drawer */}
      <aside
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 460,
          background: 'var(--paper)',
          borderLeft: '1px solid var(--line)',
          boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.06)',
          zIndex: 90,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Icon d={I.sparkles} size={14} stroke={1.4} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1 }}>
            <h2
              className="lp-serif"
              style={{ margin: 0, fontSize: 16, fontWeight: 500, letterSpacing: -0.2 }}
            >
              Suggested watchers
            </h2>
            <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginTop: 2 }}>
              tailored to this project · review &amp; accept
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              width: 24,
              height: 24,
              border: 'none',
              background: 'transparent',
              color: 'var(--ink-4)',
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon d={I.x} size={12} stroke={1.4} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
          {status === 'loading' && (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-5)' }}>
              Thinking…
            </div>
          )}
          {status === 'error' && (
            <div
              style={{
                padding: 16,
                background: 'var(--surface)',
                border: '1px solid var(--clay)',
                borderRadius: 'var(--r-m)',
                fontSize: 12,
                color: 'var(--ink-2)',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn’t fetch suggestions.</div>
              <div style={{ color: 'var(--ink-4)', fontSize: 11 }}>{errorMsg}</div>
              <button
                onClick={fetchSuggestions}
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  padding: '4px 10px',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  color: 'var(--ink)',
                }}
              >
                Retry
              </button>
            </div>
          )}
          {status === 'empty' && (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--ink-5)',
                lineHeight: 1.6,
              }}
            >
              {skippedReason === 'insufficient_context'
                ? 'Not enough project context to suggest. Add competitors or fill in the idea canvas, then try again.'
                : 'No new watchers to suggest — looks like the obvious angles are already covered.'}
            </div>
          )}
          {status === 'ready' &&
            proposals.map((p, i) => (
              <ProposalCard
                key={`${p.name}-${i}`}
                proposal={p}
                checked={selected.has(i)}
                onToggle={() => toggle(i)}
              />
            ))}
        </div>

        {/* Footer */}
        {status === 'ready' && (
          <div
            style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--surface)',
            }}
          >
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)', flex: 1 }}>
              {selected.size} of {proposals.length} selected
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{
                fontSize: 12,
                padding: '6px 12px',
                border: '1px solid var(--line)',
                borderRadius: 4,
                background: 'transparent',
                color: 'var(--ink-3)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={selected.size === 0 || accepting}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '6px 14px',
                border: 'none',
                borderRadius: 4,
                background: selected.size === 0 ? 'var(--ink-5)' : 'var(--ink)',
                color: 'var(--paper)',
                cursor: selected.size === 0 || accepting ? 'not-allowed' : 'pointer',
                opacity: accepting ? 0.7 : 1,
              }}
            >
              {accepting ? 'Saving…' : `Accept ${selected.size}`}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// ProposalCard — one row per proposal
// ---------------------------------------------------------------------------

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

function ProposalCard({
  proposal,
  checked,
  onToggle,
}: {
  proposal: ProposedWatcher;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 10,
        padding: '12px 12px',
        marginBottom: 8,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderLeft: checked ? '3px solid var(--ink)' : '3px solid var(--line)',
        borderRadius: 'var(--r-m)',
        cursor: 'pointer',
        alignItems: 'flex-start',
        opacity: checked ? 1 : 0.65,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ marginTop: 3, accentColor: 'var(--ink)' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink)',
            lineHeight: 1.3,
            marginBottom: 4,
          }}
        >
          {proposal.name}
        </div>
        {/* Chip row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          <Pill kind="info">{TOPIC_LABELS[proposal.topic] || proposal.topic}</Pill>
          <DepthChip depth={proposal.depth} size="xs" />
          <span
            className="lp-mono"
            style={{
              fontSize: 9.5,
              color: 'var(--ink-5)',
              padding: '2px 6px',
              background: 'var(--paper-2)',
              borderRadius: 3,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              fontWeight: 600,
            }}
          >
            {proposal.cadence}
          </span>
          <span
            className="lp-mono"
            style={{
              fontSize: 9.5,
              color: 'var(--ink-5)',
              padding: '2px 6px',
              background: 'var(--paper-2)',
              borderRadius: 3,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              fontWeight: 600,
            }}
          >
            {proposal.kind}
          </span>
        </div>
        {/* Rationale — the why */}
        {proposal.rationale && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: 6 }}>
            {proposal.rationale}
          </div>
        )}
        {/* Inputs preview */}
        <InputsPreview inputs={proposal.inputs} />
      </div>
    </label>
  );
}

function InputsPreview({ inputs }: { inputs: ProposedWatcher['inputs'] }) {
  const bits: React.ReactNode[] = [];
  if (inputs.urls?.length) {
    bits.push(
      <InputChip key="urls" icon={I.link} label={`${inputs.urls.length} URL${inputs.urls.length === 1 ? '' : 's'}`} title={inputs.urls.join('\n')} />,
    );
  }
  if (inputs.keywords?.length) {
    bits.push(
      <InputChip key="kw" icon={I.search} label={`${inputs.keywords.length} keyword${inputs.keywords.length === 1 ? '' : 's'}`} title={inputs.keywords.join(', ')} />,
    );
  }
  if (inputs.competitor_names?.length) {
    bits.push(
      <InputChip key="cn" icon={I.users} label={inputs.competitor_names.slice(0, 2).join(', ') + (inputs.competitor_names.length > 2 ? ` +${inputs.competitor_names.length - 2}` : '')} title={inputs.competitor_names.join(', ')} />,
    );
  }
  if (bits.length === 0) return null;
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{bits}</div>;
}

function InputChip({ icon, label, title }: { icon: string; label: string; title: string }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10.5,
        fontFamily: 'var(--f-mono)',
        color: 'var(--ink-4)',
        padding: '2px 6px',
        background: 'var(--paper-2)',
        borderRadius: 3,
      }}
    >
      <Icon d={icon} size={9} stroke={1.3} />
      {label}
    </span>
  );
}
