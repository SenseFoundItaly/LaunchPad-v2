import type { AgentTool } from '@earendil-works/pi-agent-core';

const CONTINUATION = /^(?:yes|ok|okay|sure|sounds good|yep|si|sì|perfetto|go ahead|continue|proceed|avanti|procedi|continua)[.!\s]*$/i;
const DISCUSSION = /\b(?:discussion[ -]only|do not save|don't save|don’t save|without saving|no saving|non salvare|senza salvare|solo discussione|solo una discussione)\b/i;

/** A short continuation inherits the last substantive founder request's scope.
 * Only founder text can set this policy; assistant offers cannot lift it.
 * A new substantive request is assessed on its own. */
export function isDiscussionOnly(message: string, history: Array<{ role?: string; content?: unknown }> = []): boolean {
  if (DISCUSSION.test(message)) return true;
  if (!CONTINUATION.test(message.trim())) return false;
  for (const row of [...history].reverse()) {
    if (row.role !== 'user' || typeof row.content !== 'string' || CONTINUATION.test(row.content.trim())) continue;
    return DISCUSSION.test(row.content);
  }
  return false;
}

/** Preserve schemas/order/cache prefixes while enforcing scope at execution. */
export function blockDiscussionWrite(tool: AgentTool): AgentTool {
  return { ...tool, async execute() {
    return {
      content: [{ type: 'text', text: 'The founder requested discussion only. Do not save project data, create proposals, or run skills that persist results. Answer using the available context and read tools.' }],
      details: { error: 'discussion_only' },
    };
  } };
}
