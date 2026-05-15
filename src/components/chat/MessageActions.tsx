'use client';

import { useState } from 'react';

interface MessageActionsProps {
  /** The raw message content to copy (for user messages) or the visible text (for assistant). */
  content: string;
  /** When provided, shows a Retry button that resubmits this content as a new user message. */
  onRetry?: () => void;
  /** Align the pill row to the left (assistant) or right (user). */
  align: 'left' | 'right';
}

/**
 * Claude-style action pill row under a chat message.
 *
 *   [ Copy ]  [ Retry ]   (user messages — both)
 *   [ Copy ]              (assistant messages — copy only)
 *
 * Visually subdued until hover. Copy shows a brief "Copied" confirmation.
 */
export default function MessageActions({ content, onRetry, align }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Older browsers / insecure context: fall through silently
    }
  }

  return (
    <div
      className={`flex gap-1 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${
        align === 'right' ? 'justify-end' : 'justify-start'
      }`}
    >
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy message'}
        className="flex items-center gap-1 text-[11px] text-ink-5 hover:text-ink-2 px-1.5 py-0.5 rounded hover:bg-paper-3/40 transition-colors"
      >
        {copied ? (
          <>
            <CheckIcon />
            <span>Copied</span>
          </>
        ) : (
          <>
            <CopyIcon />
            <span>Copy</span>
          </>
        )}
      </button>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          title="Resend this message"
          className="flex items-center gap-1 text-[11px] text-ink-5 hover:text-ink-2 px-1.5 py-0.5 rounded hover:bg-paper-3/40 transition-colors"
        >
          <RetryIcon />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
