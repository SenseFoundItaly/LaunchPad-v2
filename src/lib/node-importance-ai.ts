/**
 * AI "why this matters" for a single knowledge node (coherence follow-up, the
 * tier-3 upgrade over the deterministic per-type template in node-importance.ts).
 *
 * Design that keeps it SAFE + cheap:
 *  - Generated ONCE per node, on first view (lazy), then cached on
 *    graph_nodes.importance. Never regenerated → it can't drift across turns
 *    (the coherence risk only exists for live/repeated generation).
 *  - Describes ONLY this node's own data — no cross-node claims to contradict.
 *  - Cheap tier (Haiku via task:'summarize'); cost ABSORBED (skip_credit_debit)
 *    since the founder didn't trigger it.
 *  - Flag-gated (NODE_IMPORTANCE_AI). Off → no LLM call; the template stands.
 *  - Fail-open: any error → null, and the caller keeps the template.
 */
import { runAgent } from '@/lib/pi-agent';
import { recordAgentUsage } from '@/lib/cost-meter';

export const NODE_IMPORTANCE_AI = process.env.NODE_IMPORTANCE_AI === '1';

const SYSTEM = [
  'You explain why a single knowledge item matters to a founder building a startup.',
  'Reply with ONE sentence, max 25 words. Be concrete and specific to THIS item — reference its actual numbers/facts where useful.',
  'Say what it adds to the project or what to do with it. No preamble, no quotes, no markdown, no lists. Plain sentence only.',
].join(' ');

/** Clean + clamp the model output to one tidy sentence. Pure; exported for tests. */
export function cleanImportance(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/^["'`*\-•\s]+/, '').replace(/["'`*\s]+$/, ''); // strip wrapping quotes/markdown
  if (s.length < 8) return null;
  if (s.length > 240) {
    const cut = s.slice(0, 240);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > 180 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '') + '…';
  }
  return s;
}

interface ImportanceNode {
  name?: string | null;
  node_type?: string | null;
  summary?: string | null;
  attributes?: Record<string, unknown> | null;
}

/**
 * Generate the one-sentence rationale for a node. Returns null when the flag is
 * off, on any failure, or on empty output — the caller falls back to the template.
 */
export async function generateNodeImportance(projectId: string, node: ImportanceNode): Promise<string | null> {
  if (!NODE_IMPORTANCE_AI) return null;
  try {
    const attrs = node.attributes && typeof node.attributes === 'object'
      ? Object.entries(node.attributes).map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`).join('\n').slice(0, 800)
      : '';
    const prompt = [
      `Type: ${node.node_type || 'fact'}`,
      `Name: ${node.name || '(untitled)'}`,
      node.summary ? `Summary: ${String(node.summary).slice(0, 400)}` : '',
      attrs ? `Details:\n${attrs}` : '',
      '',
      'Why does this matter to the founder? One sentence.',
    ].filter(Boolean).join('\n');

    const startedAt = Date.now();
    const res = await runAgent(prompt, {
      systemPrompt: SYSTEM,
      task: 'summarize', // cheap tier (Haiku)
      tools: false,
      timeout: 25000,
      maxToolCalls: 0,
    });
    recordAgentUsage({
      project_id: projectId,
      step: 'node-importance',
      task: 'summarize',
      usage: res.usage,
      latency_ms: Date.now() - startedAt,
      skip_credit_debit: true, // absorb — the founder didn't trigger it
    });
    return cleanImportance(res.text);
  } catch (err) {
    console.warn('[node-importance-ai] generation failed (non-fatal):', (err as Error).message);
    return null;
  }
}
