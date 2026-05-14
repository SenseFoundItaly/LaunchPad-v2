'use client';

import { useState } from 'react';
import type { DocumentArtifact } from '@/types/artifacts';
import { IconBtn, I, Pill } from '@/components/design/primitives';
import { openPrintPreview } from '@/lib/print-utils';
import ArtifactCardShell from './ArtifactCardShell';

export default function DocumentCard({ artifact }: { artifact: DocumentArtifact }) {
  const [activeSection, setActiveSection] = useState(0);
  const [copied, setCopied] = useState(false);

  const sections = artifact.sections ?? [];
  const isPitchDeck = artifact.doc_type === 'pitch-deck';

  const DOC_TYPE_LABELS: Record<string, string> = {
    'pitch-deck': 'Pitch Deck',
    'one-pager': 'One-Pager',
  };

  function copyMarkdown() {
    navigator.clipboard.writeText(artifact.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadMarkdown() {
    const blob = new Blob([artifact.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title.replace(/\s+/g, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printPdf() {
    openPrintPreview(artifact.title, artifact.content);
  }

  return (
    <ArtifactCardShell
      typeLabel="Document"
      title={artifact.title}
      sources={artifact.sources}
      style={{ gridColumn: 'span 6' }}
      headerRight={<>
        <Pill kind="info" dot>
          {DOC_TYPE_LABELS[artifact.doc_type] ?? artifact.doc_type}
        </Pill>
        {sections.length > 0 && (
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            {sections.length} {isPitchDeck ? 'slides' : 'sections'}
          </span>
        )}
        <IconBtn d={I.copy} title={copied ? 'Copied!' : 'Copy markdown'} onClick={copyMarkdown} />
        <IconBtn d={I.download} title="Download .md" onClick={downloadMarkdown} />
        <IconBtn d={I.printer} title="Print / PDF" onClick={printPdf} />
      </>}
    >
      <div style={{ display: 'flex', minHeight: 400, border: '1px solid var(--line)', borderRadius: 'var(--r-m)', overflow: 'hidden' }}>
        {/* Section navigator */}
        {sections.length > 1 && (
          <div
            style={{
              width: 200,
              flexShrink: 0,
              borderRight: '1px solid var(--line)',
              overflow: 'auto',
              padding: '8px 0',
              background: 'var(--paper)',
            }}
          >
            {sections.map((sec, i) => (
              <button
                key={i}
                onClick={() => setActiveSection(i)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none',
                  background: activeSection === i ? 'var(--accent-wash)' : 'transparent',
                  color: activeSection === i ? 'var(--accent-ink)' : 'var(--ink-3)',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: 'var(--f-sans)',
                  fontWeight: activeSection === i ? 600 : 400,
                  borderLeft: activeSection === i ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {isPitchDeck ? `${i + 1}. ` : ''}{sec.heading}
              </button>
            ))}
          </div>
        )}

        {/* Content area */}
        <div
          className="lp-scroll"
          style={{
            flex: 1,
            padding: 20,
            overflow: 'auto',
            fontSize: 13,
            lineHeight: 1.7,
            color: 'var(--ink-2)',
          }}
        >
          {sections.length > 0 ? (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 0, marginBottom: 12, color: 'var(--ink-1)' }}>
                {sections[activeSection]?.heading}
              </h2>
              <MarkdownBlock text={sections[activeSection]?.body ?? ''} />
            </div>
          ) : (
            <MarkdownBlock text={artifact.content} />
          )}
        </div>
      </div>
    </ArtifactCardShell>
  );
}

/** Renders markdown-like text as safe React elements (no raw HTML injection). */
function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={i} style={{ margin: '12px 0 4px', fontSize: 14, fontWeight: 600 }}>
          {inlineFormat(line.slice(4))}
        </h4>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h3 key={i} style={{ margin: '16px 0 6px', fontSize: 16, fontWeight: 600 }}>
          {inlineFormat(line.slice(3))}
        </h3>
      );
    } else if (line.startsWith('# ')) {
      elements.push(
        <h2 key={i} style={{ margin: '20px 0 8px', fontSize: 18, fontWeight: 600 }}>
          {inlineFormat(line.slice(2))}
        </h2>
      );
    } else if (line.startsWith('- ')) {
      elements.push(
        <li key={i} style={{ marginLeft: 16, marginBottom: 2 }}>
          {inlineFormat(line.slice(2))}
        </li>
      );
    } else if (line.trim() === '') {
      elements.push(<br key={i} />);
    } else {
      elements.push(
        <p key={i} style={{ margin: '4px 0' }}>
          {inlineFormat(line)}
        </p>
      );
    }
  }

  return <>{elements}</>;
}

/** Inline bold/italic formatting — returns React nodes, not raw HTML. */
function inlineFormat(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/\*(.+?)\*/);

    const match = boldMatch && italicMatch
      ? (boldMatch.index! <= italicMatch.index! ? boldMatch : italicMatch)
      : boldMatch ?? italicMatch;

    if (!match || match.index === undefined) {
      parts.push(remaining);
      break;
    }

    if (match.index > 0) {
      parts.push(remaining.slice(0, match.index));
    }

    const isBold = match[0].startsWith('**');
    parts.push(
      isBold
        ? <strong key={key++}>{match[1]}</strong>
        : <em key={key++}>{match[1]}</em>
    );

    remaining = remaining.slice(match.index + match[0].length);
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
