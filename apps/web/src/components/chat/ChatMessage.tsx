'use client';

import type { ChatMessage as ChatMessageType } from '@/types';
import type { EntityCard, WorkflowCard } from '@/types/artifacts';
import { parseMessageContent } from '@/lib/artifact-parser';
import ArtifactRenderer from './artifacts/ArtifactRenderer';

interface ChatMessageProps {
  message: ChatMessageType;
  onArtifactAction?: (action: string, payload: Record<string, unknown>) => void;
  onEntityDiscovered?: (entity: EntityCard) => void;
  onWorkflowDiscovered?: (workflow: WorkflowCard) => void;
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
            ? 'bg-blue-600 text-white rounded-br-md'
            : 'bg-zinc-800 text-zinc-200 rounded-bl-md'
        }`}
      >
        {isUser || !segments ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          segments.map((segment, idx) => {
            switch (segment.type) {
              case 'text':
                return <div key={idx} className="whitespace-pre-wrap">{segment.content}</div>;
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
    </div>
  );
}
