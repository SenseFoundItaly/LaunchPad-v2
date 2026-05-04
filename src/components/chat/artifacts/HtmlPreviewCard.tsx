'use client';

import { useState, useRef } from 'react';
import type { HtmlPreviewArtifact } from '@/types/artifacts';
import { IconBtn, I, Pill } from '@/components/design/primitives';

const VIEWPORTS: { id: 'desktop' | 'tablet' | 'mobile'; label: string; width: number }[] = [
  { id: 'desktop', label: 'Desktop', width: 1280 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'mobile', label: 'Mobile', width: 375 },
];

export default function HtmlPreviewCard({ artifact }: { artifact: HtmlPreviewArtifact }) {
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>(artifact.viewport ?? 'desktop');
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const currentVp = VIEWPORTS.find((v) => v.id === viewport) ?? VIEWPORTS[0];

  function copyHtml() {
    navigator.clipboard.writeText(artifact.html).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadHtml() {
    const blob = new Blob([artifact.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title.replace(/\s+/g, '-').toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openInNewTab() {
    const blob = new Blob([artifact.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  return (
    <div
      style={{
        gridColumn: 'span 6',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-m)',
        overflow: 'hidden',
        background: 'var(--surface)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--paper)',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
          {artifact.title}
        </span>
        <Pill kind="ok" dot>html</Pill>
        <span style={{ flex: 1 }} />

        {/* Viewport toggles */}
        {VIEWPORTS.map((vp) => (
          <button
            key={vp.id}
            onClick={() => setViewport(vp.id)}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              border: `1px solid ${viewport === vp.id ? 'var(--accent)' : 'var(--line-2)'}`,
              background: viewport === vp.id ? 'var(--accent-wash)' : 'transparent',
              color: viewport === vp.id ? 'var(--accent-ink)' : 'var(--ink-4)',
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: 'var(--f-mono)',
            }}
          >
            {vp.label} ({vp.width})
          </button>
        ))}

        <span style={{ width: 1, height: 16, background: 'var(--line-2)' }} />

        <IconBtn d={I.copy} title={copied ? 'Copied!' : 'Copy HTML'} onClick={copyHtml} />
        <IconBtn d={I.download} title="Download .html" onClick={downloadHtml} />
        <IconBtn d={I.external} title="Open in new tab" onClick={openInNewTab} />
      </div>

      {/* Preview iframe */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          background: 'var(--paper-2)',
          padding: viewport === 'desktop' ? 0 : 16,
          minHeight: 400,
        }}
      >
        <iframe
          ref={iframeRef}
          srcDoc={artifact.html}
          sandbox="allow-scripts"
          title={artifact.title}
          style={{
            width: viewport === 'desktop' ? '100%' : currentVp.width,
            maxWidth: '100%',
            height: 600,
            border: viewport === 'desktop' ? 'none' : '1px solid var(--line)',
            borderRadius: viewport === 'desktop' ? 0 : 8,
            background: '#fff',
          }}
        />
      </div>
    </div>
  );
}
