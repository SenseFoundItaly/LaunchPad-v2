'use client';

import type { ChatMessage as ChatMessageType } from '@/types';
import type { EntityCard, WorkflowCard } from '@/types/artifacts';
import { parseMessageContent } from '@/lib/artifact-parser';
import ArtifactRenderer from './artifacts/ArtifactRenderer';
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
    <div className="my-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 animate-pulse">
      <div className="h-3 w-24 bg-zinc-700 rounded mb-2" />
      <div className="h-3 w-full bg-zinc-700 rounded mb-1.5" />
      <div className="h-3 w-3/4 bg-zinc-700 rounded" />
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
        if (line.startsWith('# ')) return <h2 key={i} className="text-base font-bold text-white mt-3 mb-1">{renderInline(line.slice(2))}</h2>;
        if (line.startsWith('## ')) return <h3 key={i} className="text-sm font-semibold text-zinc-100 mt-2 mb-0.5">{renderInline(line.slice(3))}</h3>;
        if (line.startsWith('### ')) return <h4 key={i} className="text-sm font-medium text-zinc-200 mt-1.5">{renderInline(line.slice(4))}</h4>;
        if (line.startsWith('---') || line.match(/^[━═─]{3,}/)) {
          return <hr key={i} className="border-zinc-700 my-2" />;
        }
        // Section headers like ━━━ 1. PROBLEM ━━━
        if (line.match(/^[━═─]+\s*.+\s*[━═─]+$/)) {
          const title = line.replace(/[━═─]/g, '').trim();
          return (
            <div key={i} className="mt-4 mb-2 py-1.5 px-3 bg-zinc-700/30 rounded-md">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">{title}</span>
            </div>
          );
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={i} className="flex gap-2 text-sm">
              <span className="text-zinc-500 shrink-0">&bull;</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        // Arrow bullets (→)
        if (line.trimStart().startsWith('\u2192 ') || line.trimStart().startsWith('-> ')) {
          const text = line.trimStart().replace(/^(\u2192|->)\s*/, '');
          return (
            <div key={i} className="flex gap-2 text-sm pl-1">
              <span className="text-blue-400 shrink-0">&rarr;</span>
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
              <span className="text-blue-400 font-bold shrink-0">{num}</span>
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

/** Render inline bold/italic */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-zinc-100">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
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
            ? 'bg-blue-600 text-white rounded-br-md'
            : 'bg-zinc-800 text-zinc-200 rounded-bl-md'
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
