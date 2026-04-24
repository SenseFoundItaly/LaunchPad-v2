'use client';

import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, ToolActivity } from '@/types';

export function useChat(projectId: string, step: string = 'chat') {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  // Keep ref in sync with state
  messagesRef.current = messages;

  const sendMessage = useCallback(
    async (content: string) => {
      const currentMessages = messagesRef.current;

      const userMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };

      const updatedMessages = [...currentMessages, userMsg];

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        tools: [],
      };

      const withAssistant = [...updatedMessages, assistantMsg];
      setMessages(withAssistant);
      setIsStreaming(true);

      try {
        abortRef.current = new AbortController();
        const response = await fetch(`/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            step,
            messages: updatedMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Chat API error:', response.status, errorText);
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: `Error: ${response.status} - ${errorText}`,
            };
            return updated;
          });
          return;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let toolsList: ToolActivity[] = [];

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {break;}

            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const parsed = JSON.parse(line.slice(6));

                  if (parsed.content) {
                    fullContent += parsed.content;
                    setMessages((prev) => {
                      const updated = [...prev];
                      updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        content: fullContent,
                        tools: toolsList.length > 0 ? [...toolsList] : undefined,
                      };
                      return updated;
                    });
                  }

                  if (parsed.tool_start) {
                    toolsList = [
                      ...toolsList.map(t => t.status === 'running' ? { ...t, status: 'done' as const } : t),
                      {
                        id: parsed.tool_start.id,
                        name: parsed.tool_start.name,
                        args: parsed.tool_start.args,
                        status: 'running',
                      },
                    ];
                    setMessages((prev) => {
                      const updated = [...prev];
                      updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        content: fullContent,
                        tools: [...toolsList],
                      };
                      return updated;
                    });
                  }

                  if (parsed.tool_end) {
                    toolsList = toolsList.map(t =>
                      t.id === parsed.tool_end.id
                        ? { ...t, status: parsed.tool_end.error ? 'error' as const : 'done' as const }
                        : t
                    );
                    setMessages((prev) => {
                      const updated = [...prev];
                      updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        content: fullContent,
                        tools: [...toolsList],
                      };
                      return updated;
                    });
                  }

                  if (parsed.error) {
                    console.error('Stream error:', parsed.error);
                    setMessages((prev) => {
                      const updated = [...prev];
                      updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        content: fullContent + `\n\n[Error: ${parsed.error}]`,
                      };
                      return updated;
                    });
                  }
                } catch {
                  // skip malformed lines
                }
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Chat error:', err);
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            };
            return updated;
          });
        }
      } finally {
        setIsStreaming(false);
        // Broadcast a generic "data changed" signal so cross-page surfaces
        // (org, fundraising, intelligence) refetch after a chat turn. Chat
        // tools may have written to investors / milestones / agents tables
        // directly (without going through pending_actions, so the existing
        // `lp-tasks-changed` event misses them). Cost is a few GET refetches
        // on the active tab — much cheaper than missing a freshly-recorded
        // investor or stage change.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lp-data-changed', { detail: { projectId } }));
        }
      }
    },
    [projectId, step]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, isStreaming, sendMessage, stopStreaming, clearMessages, setMessages };
}
