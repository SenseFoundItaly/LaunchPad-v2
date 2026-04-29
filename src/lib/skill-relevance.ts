/**
 * Per-turn skill filter.
 *
 * With 11 skills registered as auto-invokable tools, every chat turn paid
 * 1,500-2,000 tokens of tool descriptions + gave the agent 11 alternative
 * actions to consider — "tool drowning." We keep all 11 skills available
 * but only surface the 2-3 most relevant ones to the agent per turn, based
 * on a fast Haiku-tier classifier call.
 *
 * Cost/latency per classification: ~$0.0003 + ~300-500ms. Saves ~$0.005
 * in reduced tool descriptions per turn + cuts agent-side decision
 * latency. Falls back gracefully (all 11 skills → balanced-tier chat) if
 * the classifier errors or times out.
 */

import { completeSimple, getModel, getEnvApiKey } from '@mariozechner/pi-ai';
import type { TextContent } from '@mariozechner/pi-ai';
import { pickModel } from './llm/router';
import { recordUsage } from './cost-meter';

interface SkillManifestEntry {
  id: string;
  name: string;
  description: string;
}

interface ProjectContext {
  name: string;
  description: string;
  current_step: number;
}

// Module-level cache: (message-normalized + projectId + current_step) → ranked ids.
// Short-lived; cleared every ~5 minutes to pick up any new skills or
// skill-description edits.
const CACHE_MS = 5 * 60 * 1000;
interface CacheEntry {
  ids: string[];
  expiresAt: number;
}
const rankCache = new Map<string, CacheEntry>();

function cacheKey(msg: string, projectId: string, step: number): string {
  // Normalize message: lowercase, collapse whitespace, take first 200 chars.
  const normalized = msg.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  return `${projectId}|${step}|${normalized}`;
}

/**
 * Return the top-N skill ids most relevant to the user's message + project
 * stage. Never throws — returns all-11 fallback if the classifier fails.
 */
export async function rankSkillsForQuery(
  message: string,
  project: ProjectContext & { id: string },
  skills: SkillManifestEntry[],
  opts: { topN?: number; timeoutMs?: number } = {},
): Promise<SkillManifestEntry[]> {
  const topN = opts.topN ?? 3;
  const timeoutMs = opts.timeoutMs ?? 5_000;

  if (skills.length <= topN) return skills;

  // Cache hit?
  const key = cacheKey(message, project.id, project.current_step);
  const cached = rankCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const byId = new Map(skills.map((s) => [s.id, s]));
    const picked = cached.ids.map((id) => byId.get(id)).filter((s): s is SkillManifestEntry => !!s);
    if (picked.length > 0) return picked.slice(0, topN);
  }

  try {
    const { provider, model } = pickModel('classify');
    const apiKey = getEnvApiKey(provider as 'anthropic' | 'openrouter');

    const skillList = skills
      .map((s, i) => `${i + 1}. ${s.id}: ${s.description.slice(0, 100)}`)
      .join('\n');

    const systemPrompt = `You are a skill router. Given a founder's chat message and the list of available startup-coaching skills, return the ${topN} skill ids that are most likely to help answer the message. Respond ONLY with a JSON array of ids, no prose, no markdown fences.`;

    const userPrompt = `Project: ${project.name} (stage ${project.current_step})
${project.description ? `Description: ${project.description.slice(0, 200)}\n` : ''}
Founder message: ${message.slice(0, 500)}

Available skills:
${skillList}

Return the ${topN} most relevant skill ids as a JSON array, e.g. ["market-research","startup-scoring","pitch-coaching"]`;

    const classifyStart = Date.now();
    const assistantMessage = await completeSimple(
      getModel(provider as any, model as any),
      {
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
      },
      {
        apiKey,
        signal: AbortSignal.timeout(timeoutMs),
        maxTokens: 120,
        temperature: 0,
      },
    );

    // Log classifier token usage — small but adds up across every chat turn.
    recordUsage({
      project_id: project.id,
      step: 'skill-relevance.classify',
      provider,
      model,
      usage: assistantMessage.usage,
      latency_ms: Date.now() - classifyStart,
    }).catch((err) => console.warn('[skill-relevance] recordUsage failed:', err));

    const raw = assistantMessage.content
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('')
      .trim();

    // Strip any accidental markdown fence.
    const json = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error('classifier did not return array');

    const validIds = new Set(skills.map((s) => s.id));
    const pickedIds = (parsed as unknown[])
      .filter((x): x is string => typeof x === 'string')
      .filter((id) => validIds.has(id))
      .slice(0, topN);

    if (pickedIds.length === 0) throw new Error('classifier returned no valid ids');

    // Cache + return.
    rankCache.set(key, { ids: pickedIds, expiresAt: Date.now() + CACHE_MS });
    const byId = new Map(skills.map((s) => [s.id, s]));
    return pickedIds
      .map((id) => byId.get(id))
      .filter((s): s is SkillManifestEntry => !!s);
  } catch (err) {
    console.warn(
      '[skill-relevance] Haiku classifier failed, falling back to all skills:',
      (err as Error).message,
    );
    return skills; // Graceful degradation.
  }
}
