import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Query } from '@anthropic-ai/claude-agent-sdk';

export interface AgentStreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'done' | 'error';
  content?: string;
  toolName?: string;
  sessionId?: string;
  error?: string;
}

/**
 * Run a skill via Claude Agent SDK with streaming.
 * Returns an async generator of text chunks for SSE streaming.
 */
export async function* runAgent(options: {
  message: string;
  systemPrompt?: string;
  sessionId?: string;
  resume?: boolean;
}): AsyncGenerator<AgentStreamChunk> {
  const { message, systemPrompt, sessionId, resume } = options;

  const queryOptions: Record<string, unknown> = {
    model: 'claude-sonnet-4-6',
    allowedTools: ['WebSearch', 'WebFetch'],
    maxTurns: 30,
    systemPrompt: systemPrompt || undefined,
    permissionMode: 'auto' as const,
  };

  // Session management
  if (resume && sessionId) {
    queryOptions.resume = sessionId;
  } else if (sessionId) {
    queryOptions.sessionId = sessionId;
  }

  let resultSessionId = '';

  try {
    const q: Query = query({
      prompt: message,
      options: queryOptions as any,
    });

    for await (const msg of q) {
      // Stream events contain text deltas
      if (msg.type === 'assistant') {
        // Full assistant message
        if (typeof msg.message === 'object' && msg.message.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              yield { type: 'text', content: block.text };
            }
          }
        }
      }

      // Result message
      if (msg.type === 'result') {
        resultSessionId = msg.session_id || '';
        if (msg.subtype === 'error') {
          yield { type: 'error', error: msg.error || 'Agent error' };
        }
      }
    }

    yield { type: 'done', sessionId: resultSessionId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    yield { type: 'error', error: errMsg };
  }
}

/**
 * Simple non-streaming agent call for background skill runs.
 */
export async function runAgentOnce(options: {
  message: string;
  systemPrompt?: string;
}): Promise<{ text: string; sessionId: string }> {
  let text = '';
  let sessionId = '';

  for await (const chunk of runAgent(options)) {
    if (chunk.type === 'text' && chunk.content) {
      text += chunk.content;
    }
    if (chunk.type === 'done' && chunk.sessionId) {
      sessionId = chunk.sessionId;
    }
    if (chunk.type === 'error') {
      throw new Error(chunk.error);
    }
  }

  return { text, sessionId };
}
