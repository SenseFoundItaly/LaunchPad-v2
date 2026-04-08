'use client';

import { useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { ChatMessage as ChatMessageType } from '@/types';
import type { EntityCard, WorkflowCard } from '@/types/artifacts';

interface ChatPanelProps {
  messages: ChatMessageType[];
  onSend: (message: string) => void;
  isStreaming: boolean;
  placeholder?: string;
  emptyMessage?: string;
  onArtifactAction?: (action: string, payload: Record<string, unknown>) => void;
  onEntityDiscovered?: (entity: EntityCard) => void;
  onWorkflowDiscovered?: (workflow: WorkflowCard) => void;
}

export default function ChatPanel({
  messages,
  onSend,
  isStreaming,
  placeholder,
  emptyMessage = 'Start a conversation to shape your idea',
  onArtifactAction,
  onEntityDiscovered,
  onWorkflowDiscovered,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            {emptyMessage}
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              onArtifactAction={onArtifactAction}
              onEntityDiscovered={onEntityDiscovered}
              onWorkflowDiscovered={onWorkflowDiscovered}
            />
          ))
        )}
        {isStreaming && messages.length > 0 && messages[messages.length - 1].content === '' && (
          <div className="flex justify-start mb-4">
            <div className="bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <ChatInput onSend={onSend} disabled={isStreaming} placeholder={placeholder} />
    </div>
  );
}
