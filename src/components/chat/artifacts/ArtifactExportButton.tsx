'use client';

/**
 * Per-artifact download. Was JSON/CSV-only; the founder's changelog 4/08 ask
 * (#390) added the human formats: a text document (.md — opens everywhere,
 * pastes clean into Notion/Docs/mail) and PDF via a print window (the browser's
 * "save as PDF" — zero dependencies). The raw JSON/CSV stays for machines.
 *
 * One icon, tiny menu. Three buttons in the card header would out-shout the
 * artifact itself; a menu keeps the header at one glyph and makes the format
 * an explicit choice.
 */

import { useEffect, useRef, useState } from 'react';
import type { Artifact } from '@/types/artifacts';
import { buildArtifactExport, buildArtifactMarkdown, markdownToPrintHtml } from '@/lib/artifact-export';
import { useT } from '@/components/providers/LocaleProvider';

export default function ArtifactExportButton({ artifact }: { artifact: Artifact }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const payload = buildArtifactExport(artifact);
  const doc = buildArtifactMarkdown(artifact);
  if (!payload) return null;

  function saveBlob(text: string, mime: string, filename: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printPdf() {
    if (!doc) return;
    // A print window instead of a PDF library: the browser's own "save as PDF"
    // handles pagination and fonts better than anything we could bundle, at
    // zero dependency cost. The page loads from a Blob URL — no document.write,
    // no markup injected into a live document; markdownToPrintHtml HTML-escapes
    // every piece of artifact text before building the page. Popup blockers can
    // refuse the window; the .md download path still covers the need.
    const html = markdownToPrintHtml(doc.text, doc.filename.replace(/\.md$/, ''));
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank', 'width=760,height=900');
    if (!w) { URL.revokeObjectURL(url); return; }
    w.addEventListener('load', () => {
      w.print();
      URL.revokeObjectURL(url);
    });
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const item: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px',
    fontSize: 12, color: 'var(--ink-2)', background: 'transparent',
    border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <span ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-ink-5 hover:text-ink-3 transition-colors p-0.5 shrink-0"
        aria-label={t('shell.download-file', { file: payload.filename })}
        aria-expanded={open}
        title={t('shell.download-file', { file: payload.filename })}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
      {open && (
        <span
          role="menu"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 60,
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 'var(--r-m)', boxShadow: '0 6px 24px rgba(0,0,0,0.14)',
            overflow: 'hidden', minWidth: 168,
          }}
        >
          {doc && (
            <button role="menuitem" style={item} type="button"
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              onClick={() => { saveBlob(doc.text, doc.mime, doc.filename); setOpen(false); }}>
              {t('shell.export-doc')}
            </button>
          )}
          {doc && (
            <button role="menuitem" style={item} type="button"
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              onClick={() => { printPdf(); setOpen(false); }}>
              {t('shell.export-pdf')}
            </button>
          )}
          <button role="menuitem" style={item} type="button"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => { saveBlob(payload.text, payload.mime, payload.filename); setOpen(false); }}>
            {t('shell.export-data', { ext: payload.filename.split('.').pop()?.toUpperCase() ?? 'JSON' })}
          </button>
        </span>
      )}
    </span>
  );
}
