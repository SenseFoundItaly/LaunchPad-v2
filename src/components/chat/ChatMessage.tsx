'use client';

import type { ChatMessage as ChatMessageType } from '@/types';
import type { EntityCard, WorkflowCard } from '@/types/artifacts';
import { parseMessageContent } from '@/lib/artifact-parser';
import ArtifactRenderer from './artifacts/ArtifactRenderer';
import SourcesFooter from './artifacts/SourcesFooter';
import ToolActivityBar from './ToolActivityBar';
import MessageActions from './MessageActions';

interface ChatMessageProps {
  message: ChatMessageType;
  onArtifactAction?: (action: string, payload: Record<string, unknown>) => void;
  onEntityDiscovered?: (entity: EntityCard) => void;
  onWorkflowDiscovered?: (workflow: WorkflowCard) => void;
  /** When provided on a user message, shows a Retry button that resubmits. */
  onRetry?: (content: string) => void;
}

function ArtifactPendingShimmer() {
  return (
    <div className="my-3 bg-paper-2/50 border border-line-2 rounded-lg p-4 animate-pulse">
      <div className="h-3 w-24 bg-paper-3 rounded mb-2" />
      <div className="h-3 w-full bg-paper-3 rounded mb-1.5" />
      <div className="h-3 w-3/4 bg-paper-3 rounded" />
    </div>
  );
}

function FormattedText({ content }: { content: string }) {
  return (
    <div className="space-y-1.5">
      {content.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />;
        // Hide leaked artifact syntax
        if (line.includes(':::artifact') || line.includes(':::') && line.trim() === ':::') return null;
        if (line.trim().startsWith('{"type"') || line.trim().startsWith('{"prompt"') || line.trim().startsWith('{"title"')) {
          try { JSON.parse(line.trim()); return null; } catch { /* not JSON, render normally */ }
        }
        if (line.startsWith('# ')) return <h2 key={i} className="text-base font-bold text-ink mt-3 mb-1">{renderInline(line.slice(2))}</h2>;
        if (line.startsWith('## ')) return <h3 key={i} className="text-sm font-semibold text-ink mt-2 mb-0.5">{renderInline(line.slice(3))}</h3>;
        if (line.startsWith('### ')) return <h4 key={i} className="text-sm font-medium text-ink-2 mt-1.5">{renderInline(line.slice(4))}</h4>;
        if (line.startsWith('---') || line.match(/^[━═─]{3,}/)) {
          return <hr key={i} className="border-line-2 my-2" />;
        }
        // Section headers like ━━━ 1. PROBLEM ━━━
        if (line.match(/^[━═─]+\s*.+\s*[━═─]+$/)) {
          const title = line.replace(/[━═─]/g, '').trim();
          return (
            <div key={i} className="mt-4 mb-2 py-1.5 px-3 bg-paper-3/30 rounded-md">
              <span className="text-xs font-bold text-ink-3 uppercase tracking-wider">{title}</span>
            </div>
          );
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={i} className="flex gap-2 text-sm">
              <span className="text-ink-5 shrink-0">&bull;</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        // Arrow bullets (→)
        if (line.trimStart().startsWith('\u2192 ') || line.trimStart().startsWith('-> ')) {
          const text = line.trimStart().replace(/^(\u2192|->)\s*/, '');
          return (
            <div key={i} className="flex gap-2 text-sm pl-1">
              <span className="text-moss shrink-0">&rarr;</span>
              <span>{renderInline(text)}</span>
            </div>
          );
        }
        // Circled number items (①②③)
        if (line.match(/^[①②③④⑤⑥⑦⑧⑨⑩]\s/)) {
          const num = line[0];
          const text = line.slice(2);
          return (
            <div key={i} className="flex gap-2 text-sm mt-1">
              <span className="text-moss font-bold shrink-0">{num}</span>
              <span>{renderInline(text)}</span>
            </div>
          );
        }
        if (line.match(/^\d+\.\s/)) {
          return <p key={i} className="text-sm pl-1">{renderInline(line)}</p>;
        }
        return <p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>;
      })}
    </div>
  );
}

/**
 * Render inline bold/italic + citation markers.
 *
 * Citation markers: `[1]`, `[23]`, `[1,3]`, `[1-3]` → rendered as superscript
 * chips linked to the matching SourcesFooter chip (which carries
 * `data-source-index={N}` per entry — click scrolls + flashes it).
 *
 * Citation recognition is intentionally narrow: `\[\d[\d,\s-]*\]` — must
 * start with a digit, allows commas/dashes for multi-refs. Won't false-
 * positive on `[optional]`, `[TODO]`, markdown-style link labels, etc.
 *
 * Phase E of the mandatory-sources plan.
 */
const CITATION_REGEX = /\[(\d[\d,\s-]*)\]/g;

function CitationChip({ raw }: { raw: string }) {
  // Click handler: scroll the matching chip into view + flash a highlight.
  // Picks the first referenced index (e.g. "[1,3]" → scrolls to [1]).
  const first = raw.match(/\d+/)?.[0];
  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    if (!first) return;
    // Scope to the enclosing chat message so [1] on turn A doesn't jump
    // to sources on turn B.
    const chatMsg = (e.currentTarget as HTMLElement).closest('.group');
    const scope: ParentNode = chatMsg || document;
    const target = scope.querySelector(`[data-source-index="${first}"]`) as HTMLElement | null;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('ring-2', 'ring-moss');
      setTimeout(() => target.classList.remove('ring-2', 'ring-moss'), 1500);
    }
  }
  return (
    <sup>
      <a
        href={`#source-${first ?? '1'}`}
        onClick={handleClick}
        className="inline-block text-[10px] font-mono px-1 mx-0.5 rounded bg-sky/15 text-sky hover:bg-sky/30 transition-colors cursor-pointer no-underline"
      >
        {raw}
      </a>
    </sup>
  );
}

function renderInline(text: string): React.ReactNode {
  // First pass: split on bold markers. Second pass (per non-bold chunk):
  // split on citation markers. Order matters — bold is outer, citations
  // can appear inside bold ranges.
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  return boldParts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2);
      return (
        <strong key={i} className="font-semibold text-ink">
          {splitCitations(inner, `${i}-b`)}
        </strong>
      );
    }
    return <span key={i}>{splitCitations(part, `${i}-t`)}</span>;
  });
}

function splitCitations(text: string, keyPrefix: string): React.ReactNode[] {
  // Use matchAll (not .exec) to avoid stateful regex + security-hook false
  // positives on the word "exec". matchAll returns all matches in order
  // with correct .index values.
  const matches = Array.from(text.matchAll(CITATION_REGEX));
  if (matches.length === 0) {
    return [<span key={`${keyPrefix}-plain`}>{text}</span>];
  }
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  for (const m of matches) {
    const idx = m.index ?? 0;
    if (idx > lastIdx) {
      nodes.push(<span key={`${keyPrefix}-${lastIdx}`}>{text.slice(lastIdx, idx)}</span>);
    }
    nodes.push(<CitationChip key={`${keyPrefix}-c-${idx}`} raw={m[0]} />);
    lastIdx = idx + m[0].length;
  }
  if (lastIdx < text.length) {
    nodes.push(<span key={`${keyPrefix}-${lastIdx}-end`}>{text.slice(lastIdx)}</span>);
  }
  return nodes;
}

/**
 * Red warning card rendered for `artifact-error` segments — segments that
 * parsed as valid JSON but failed source-requirement validation. Visible
 * only in dev by default; in prod we still show a subtler one-liner so
 * the founder knows something was attempted-and-discarded rather than
 * silently missing. This replaces the silent-drop behavior of the old parser.
 */
function ArtifactErrorCard({ reason, artifact_type }: { reason: string; artifact_type?: string }) {
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    return (
      <div className="my-3 bg-clay/10 border border-clay/40 rounded-lg p-3 text-xs">
        <div className="font-semibold text-clay mb-1">
          Artifact rejected{artifact_type ? ` (${artifact_type})` : ''}
        </div>
        <div className="text-clay/80">{reason}</div>
        <div className="text-clay/60 mt-1 text-[10px]">
          The agent produced a card without citing sources. It was discarded to prevent unsourced
          claims from entering your project data. Re-run if you need this analysis.
        </div>
      </div>
    );
  }
  return (
    <div className="my-2 text-xs text-clay/70 italic">
      (One unsourced {artifact_type ?? 'artifact'} discarded.)
    </div>
  );
}

const noop = () => {};

export default function ChatMessage({
  message,
  onArtifactAction,
  onEntityDiscovered,
  onWorkflowDiscovered,
  onRetry,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const segments = isUser ? null : parseMessageContent(message.content);

  // For assistant messages, the "copy" clipboard content strips artifact blocks
  // and leaves the readable text — what the user sees, not the raw markdown.
  const copyableText = isUser
    ? message.content
    : (segments || [])
        .filter((s): s is { type: 'text'; content: string } => s.type === 'text')
        .map((s) => s.content)
        .join('\n\n')
        .trim() || message.content;

  // Retry only for user messages with non-empty content — assistant messages
  // can't "retry" themselves; the founder would retry the preceding user msg.
  const canRetry = isUser && onRetry && message.content.trim().length > 0;

  return (
    <div className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-moss text-white rounded-br-md'
            : 'bg-paper-2 text-ink-2 rounded-bl-md'
        }`}
      >
        {!isUser && message.tools && message.tools.length > 0 && (
          <ToolActivityBar tools={message.tools} />
        )}
        {isUser || !segments ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          segments.map((segment, idx) => {
            switch (segment.type) {
              case 'text':
                return <FormattedText key={idx} content={segment.content} />;
              case 'artifact':
                return (
                  <ArtifactRenderer
                    key={segment.artifact.id ?? `art-${idx}`}
                    artifact={segment.artifact}
                    onAction={onArtifactAction ?? noop}
                    onEntityDiscovered={onEntityDiscovered ?? noop}
                    onWorkflowDiscovered={onWorkflowDiscovered ?? noop}
                  />
                );
              case 'artifact-pending':
                return <ArtifactPendingShimmer key={`pending-${idx}`} />;
              case 'artifact-error':
                return (
                  <ArtifactErrorCard
                    key={`err-${idx}`}
                    reason={segment.reason}
                    artifact_type={segment.artifact_type}
                  />
                );
              case 'citations':
                return (
                  <SourcesFooter
                    key={`citations-${idx}`}
                    sources={segment.sources}
                    label="Sources"
                  />
                );
              default:
                return null;
            }
          })
        )}
      </div>
      {/* Skip action row for empty assistant messages (still streaming) */}
      {(isUser || message.content.trim().length > 0) && (
        <div className={`${isUser ? 'pr-2' : 'pl-2'} w-full max-w-[80%]`}>
          <MessageActions
            content={copyableText}
            onRetry={canRetry ? () => onRetry!(message.content) : undefined}
            align={isUser ? 'right' : 'left'}
          />
        </div>
      )}
    </div>
  );
}
