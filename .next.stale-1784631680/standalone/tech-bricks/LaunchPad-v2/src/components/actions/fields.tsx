'use client';

/**
 * Shared review-pane bits for the Inbox detail panel.
 *
 * Field/FieldLabel mirror the in-page helpers MonitorProposalReview uses in
 * actions/page.tsx so all review panes read identically. RawPayloadToggle is
 * the "view raw" escape hatch — the JSON dump that used to BE the pane is now
 * one click away instead of the default.
 */

import { useState } from 'react';

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="lp-mono"
      style={{
        fontSize: 10,
        color: 'var(--ink-5)',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: 3,
      }}
    >
      {children}
    </div>
  );
}

export function Field({ label, value, multiline, mono }: { label: string; value: string; multiline?: boolean; mono?: boolean }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div
        style={{
          color: 'var(--ink-2)',
          fontSize: 12.5,
          lineHeight: 1.5,
          whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
          overflow: multiline ? undefined : 'hidden',
          textOverflow: multiline ? undefined : 'ellipsis',
          fontFamily: mono ? 'var(--f-mono)' : 'inherit',
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function RawPayloadToggle({ payload }: { payload: unknown }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <button
        onClick={() => setShow((s) => !s)}
        className="lp-mono"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: 10.5,
          color: 'var(--ink-5)',
          cursor: 'pointer',
          textDecoration: 'underline dotted',
        }}
      >
        {show ? 'hide raw' : 'view raw'}
      </button>
      {show && (
        <pre
          style={{
            margin: '8px 0 0',
            padding: 10,
            fontSize: 10.5,
            background: 'var(--paper-2)',
            color: 'var(--ink-3)',
            fontFamily: 'var(--f-mono)',
            maxHeight: 300,
            overflow: 'auto',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-m)',
          }}
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
