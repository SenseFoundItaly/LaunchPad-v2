'use client';

/**
 * IdeaShapingQuickReplies — three STABLE default replies shown above the chat
 * composer while the founder is still shaping their idea (Stage 1, idea canvas
 * incomplete).
 *
 * Why a fixed strip instead of model-generated options: option-sets are 100%
 * model-authored and reworded every turn, so the founder never gets a stable,
 * recognizable set of "how do you want to proceed" choices — and the prompt's
 * "always offer the next recommended skill" rule kept re-injecting the heavy
 * "Avvia Idea Shaping" kickoff, which re-runs from scratch (the loop Luca hit
 * on MediFlow). These three are deterministic — the model can't drift them away:
 *   1. give-input  — founder fills the section, agent asks for the exact input
 *   2. get-options — agent proposes 2-3 options to evaluate together
 *   3. go-back     — step back one section WITHOUT restarting from scratch
 *
 * Self-gating: fetches the idea canvas and hides once solution + value prop +
 * target market are all present (idea shaping is effectively done). Refetches on
 * lp-actions-changed so it disappears the moment the canvas fills in.
 */

import { useEffect, useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

interface IdeaShapingQuickRepliesProps {
  projectId: string;
  /** Send a message as the founder. Undefined while streaming → strip disabled. */
  onReply?: (message: string) => void;
}

export function IdeaShapingQuickReplies({ projectId, onReply }: IdeaShapingQuickRepliesProps) {
  const t = useT();
  // null = not loaded yet (render nothing); true/false = canvas incomplete?
  const [incomplete, setIncomplete] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/projects/${projectId}/idea-canvas`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const ic = (body?.data ?? null) as
          | { solution?: string | null; value_proposition?: string | null; target_market?: string | null }
          | null;
        // "Done shaping" = the three load-bearing Stage-1 fields are all filled.
        // Until then the strip stays up to keep the founder moving without the
        // restart-prone skill kickoff.
        const done = !!(ic?.solution && ic?.value_proposition && ic?.target_market);
        if (!cancelled) setIncomplete(!done);
      } catch {
        // On error, default to SHOWING the strip — it's a safe, free navigation
        // aid; a transient fetch miss shouldn't hide the founder's way forward.
        if (!cancelled) setIncomplete(true);
      }
    }
    load();
    const handler = () => { if (!cancelled) load(); };
    window.addEventListener('lp-actions-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('lp-actions-changed', handler);
    };
  }, [projectId]);

  if (incomplete !== true) return null;

  const replies = [
    { key: 'give-input', label: t('chat.qr-give-input'), message: t('chat.qr-give-input-msg') },
    { key: 'get-options', label: t('chat.qr-get-options'), message: t('chat.qr-get-options-msg') },
    { key: 'go-back', label: t('chat.qr-go-back'), message: t('chat.qr-go-back-msg') },
  ];

  return (
    <div style={{ padding: '8px 20px 0' }}>
      <div
        className="lp-mono"
        style={{
          fontSize: 9.5,
          color: 'var(--ink-5)',
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {t('chat.qr-heading')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {replies.map((r) => (
          <button
            key={r.key}
            type="button"
            disabled={!onReply}
            title={r.message}
            onClick={() => onReply?.(r.message)}
            className="lp-rail-item"
            style={{
              padding: '5px 11px',
              fontSize: 12,
              color: 'var(--ink-3)',
              background: 'var(--surface)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-m)',
              cursor: onReply ? 'pointer' : 'default',
              opacity: onReply ? 1 : 0.5,
              fontFamily: 'inherit',
              transition: 'border-color .1s, color .1s',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
