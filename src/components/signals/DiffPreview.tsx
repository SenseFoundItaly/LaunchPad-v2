'use client';

import { useState } from 'react';
import { Icon, I } from '@/components/design/primitives';

interface DiffPreviewProps {
  diff: string;
  collapsed?: boolean;
}

export function DiffPreview({ diff, collapsed = false }: DiffPreviewProps) {
  const [expanded, setExpanded] = useState(!collapsed);

  if (!diff) return null;

  const lines = diff.split('\n').slice(0, expanded ? 50 : 5);

  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 10,
          color: 'var(--ink-4)',
          padding: '2px 0',
          fontFamily: 'var(--f-mono)',
        }}
      >
        <Icon d={expanded ? I.chevd : I.chevr} size={10} />
        diff preview
      </button>
      {(expanded || !collapsed) && (
        <pre
          style={{
            margin: 0,
            padding: '6px 8px',
            fontSize: 10,
            fontFamily: 'var(--f-mono)',
            background: 'var(--paper-2)',
            borderRadius: 4,
            overflow: 'auto',
            maxHeight: expanded ? 300 : 80,
            lineHeight: 1.6,
          }}
        >
          {lines.map((line, i) => {
            let color = 'var(--ink-3)';
            if (line.startsWith('+')) color = 'var(--moss)';
            else if (line.startsWith('-')) color = 'var(--clay)';
            else if (line.startsWith('@@')) color = 'var(--sky)';
            return (
              <div key={i} style={{ color }}>
                {line}
              </div>
            );
          })}
          {!expanded && diff.split('\n').length > 5 && (
            <div style={{ color: 'var(--ink-5)', fontStyle: 'italic' }}>
              … {diff.split('\n').length - 5} more lines
            </div>
          )}
        </pre>
      )}
    </div>
  );
}
