'use client';

import type { ChatMessage as ChatMessageType } from '@/types';
import type { EntityCard, WorkflowCard } from '@/types/artifacts';
import { parseMessageContent, type CitationSource } from '@/lib/artifact-parser';
import ArtifactRenderer from './artifacts/ArtifactRenderer';

interface ChatMessageProps {
  message: ChatMessageType;
  onArtifactAction?: (action: string, payload: Record<string, unknown>) => void;
  onEntityDiscovered?: (entity: EntityCard) => void;
  onWorkflowDiscovered?: (workflow: WorkflowCard) => void;
}

function ArtifactPendingShimmer() {
  return (
    <div className="my-3 bg-paper-3/50 border border-line-2 rounded-lg p-4 animate-pulse">
      <div className="h-3 w-24 bg-ink-6 rounded mb-2" />
      <div className="h-3 w-full bg-ink-6 rounded mb-1.5" />
      <div className="h-3 w-3/4 bg-ink-6 rounded" />
    </div>
  );
}

function SourcesFooter({ sources }: { sources: CitationSource[] }) {
  return (
    <div className="mt-3 pt-2 border-t border-line-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-5 mb-1.5">Sources</div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => {
          const label = s.title.length > 50 ? s.title.slice(0, 50).trimEnd() + '…' : s.title;
          if (s.url) {
            return (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-paper-3/50 text-ink-3 hover:text-ink hover:bg-paper-3 transition-colors no-underline"
              >
                <span className="font-mono text-[10px] text-ink-5">[{i + 1}]</span>
                {label}
              </a>
            );
          }
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-paper-3/50 text-ink-4"
            >
              <span className="font-mono text-[10px] text-ink-5">[{i + 1}]</span>
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const noop = () => {};

export default function ChatMessage({
  message,
  onArtifactAction,
  onEntityDiscovered,
  onWorkflowDiscovered,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const segments = isUser ? null : parseMessageContent(message.content);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-moss text-on-accent rounded-br-md'
            : 'bg-paper-3 text-ink-2 rounded-bl-md'
        }`}
      >
        {isUser || !segments ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          segments.map((segment, idx) => {
            switch (segment.type) {
              case 'text': {
                // Strip any <CITATIONS> blocks that survived the parser
                const text = segment.content.replace(/<CITATIONS>[\s\S]*?<\/CITATIONS>/g, '').trim();
                if (!text) return null;
                return <div key={idx} className="whitespace-pre-wrap">{text}</div>;
              }
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
              case 'citations':
                return <SourcesFooter key={`citations-${idx}`} sources={segment.sources} />;
              default:
                return null;
            }
          })
        )}
      </div>
    </div>
  );
}
