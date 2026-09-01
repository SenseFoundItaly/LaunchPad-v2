/**
 * Prompt-cache breakpoint for the chat system prompt.
 *
 * THE PROBLEM (measured on prod, 30d, 2026-08-10)
 * Chat is $74.55 of ~$84 total LLM spend, and cache WRITES alone are ~$55 —
 * 74% of chat cost. 84% of those writes land on turns that arrive within five
 * minutes of the previous one, i.e. while the cache entry is still alive. So
 * the prefix is being invalidated, not expiring, and no TTL change can help.
 * (On this stack the TTL cannot even be changed: pi-ai only emits ttl:"1h" when
 * the baseUrl is api.anthropic.com, and prod is 100% OpenRouter.)
 *
 * THE CAUSE
 * Per-section fingerprinting showed the system prompt is ~84,000 byte-identical
 * characters (SOUL + AGENTS + ARTIFACT_INSTRUCTIONS + JOURNEY_RULES, moved 0/5
 * turns) followed by ~3,800 characters that mutate every single turn (`memory`
 * 5/5, `steer` 4/5). On the OpenRouter path pi-ai emits the whole thing as ONE
 * plain string and puts its only cache_control on the last message
 * (openai-completions.js:388-436), so those 3,800 chars invalidate all 84,000.
 *
 * THE FIX
 * Split the system prompt into two content blocks and mark the first:
 *   [ static + cache_control ][ volatile tail ]
 * Anthropic allows 4 breakpoints and matches on prefix, so the static half
 * stays readable across tail changes.
 *
 * WHY THIS IS SAFE
 * The model receives BYTE-IDENTICAL CONTENT IN IDENTICAL ORDER — only the
 * cache marker moves. Nothing is relocated to the user turn, no directive is
 * demoted to "reference data". That distinction matters: the previous attempt
 * (CACHE_PREFIX_SPLIT) moved the dynamic block onto the user turn, saved 57%,
 * and dropped the Validation Gate from 8/8/8 to 1/1/6 because stageContext's
 * imperatives stopped being obeyed. This change cannot do that, because there
 * is no content change for the model to misread. `joinSystemForModel` is the
 * guarantee, and its round-trip is unit-tested.
 *
 * VERIFIED against the live provider before writing this (controlled A/B, same
 * content/model/provider, back to back):
 *   prod shape (system = plain string) → tail changes → reads 0
 *   split shape ([static+cc][tail])    → tail changes → reads 66,201 / 66,234
 * and again with BOTH markers live + 18 tools + growing history → 46,803 read.
 * So the existing last-message breakpoint is not cannibalised.
 */

/**
 * Marker placed at the static/volatile boundary of the system prompt.
 *
 * Never appears in real prompt content: the agent markdown, ARTIFACT_INSTRUCTIONS
 * and JOURNEY_RULES are all prose/markdown, and this is an angle-bracketed
 * SCREAMING token with a package prefix. Kept ASCII so it cannot interact with
 * pi-ai's surrogate sanitiser.
 *
 * The consumer (patched pi-ai) MUST remove it — whether it splits or not — so
 * the model never sees it.
 */
export const CACHE_BREAKPOINT = '<<<PI_CACHE_BREAKPOINT>>>';

import { LLM_PROVIDER } from '@/lib/llm/router';

/**
 * ON by default (set CHAT_CACHE_SPLIT=0 to fall back to the legacy single-block
 * shape without a code change).
 *
 * The original default-off guarded against the sentinel leaking into the
 * prompt as visible text on a path that doesn't know how to strip it. That
 * guard is now structural instead of a default: the marker is only ever
 * emitted when the active provider is OpenRouter — the one path the
 * patch-package hunk (patches/@earendil-works+pi-ai+0.84.4.patch, applied on
 * every install via postinstall) splits AND strips on. On a direct-Anthropic
 * deployment (OPENROUTER_API_KEY unset) the flag hard-disables itself, so the
 * unpatched anthropic.js provider can never see a sentinel.
 */
export const CHAT_CACHE_SPLIT =
  process.env.CHAT_CACHE_SPLIT !== '0' && LLM_PROVIDER === 'openrouter';

/**
 * Join the static and volatile halves into the single string pi-ai accepts.
 *
 * With the flag off this is plain concatenation — byte-for-byte what the route
 * built before. With it on, the only difference is the marker, which the
 * consumer strips. Either way the model sees the same prompt.
 */
export function joinSystemForModel(staticHalf: string, volatileHalf: string): string {
  if (!volatileHalf) return staticHalf;
  if (!CHAT_CACHE_SPLIT) return staticHalf + volatileHalf;
  return staticHalf + CACHE_BREAKPOINT + volatileHalf;
}

/**
 * Split a system prompt on the marker. Returns null when there is no marker,
 * so a caller can fall through to its existing single-block path.
 *
 * This is the function the pi-ai patch mirrors; keeping it here means the
 * logic is tested in our repo and the patch stays a thin adapter.
 */
export function splitSystemForProvider(
  systemPrompt: string,
): { staticHalf: string; volatileHalf: string } | null {
  const i = systemPrompt.indexOf(CACHE_BREAKPOINT);
  if (i < 0) return null;
  return {
    staticHalf: systemPrompt.slice(0, i),
    volatileHalf: systemPrompt.slice(i + CACHE_BREAKPOINT.length),
  };
}

/**
 * Defensive: strip every marker without splitting. Used by the patch when it
 * cannot split (e.g. the static half is too small to be worth caching), so a
 * sentinel can never reach the model even if something upstream misbehaves.
 */
export function stripCacheBreakpoints(systemPrompt: string): string {
  return systemPrompt.split(CACHE_BREAKPOINT).join('');
}
