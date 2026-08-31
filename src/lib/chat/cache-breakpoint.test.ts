import { describe, it, expect, vi } from 'vitest';
import {
  CACHE_BREAKPOINT,
  joinSystemForModel,
  splitSystemForProvider,
  stripCacheBreakpoints,
} from '@/lib/chat/cache-breakpoint';
import { buildSystemPromptString } from '@/lib/agent-prompt';

// The entire safety claim of this change is "the model receives byte-identical
// content in identical order; only the cache marker moves". These tests are
// that claim. If the round-trip below ever fails, the change stops being
// behaviour-neutral and inherits the risk that dropped the Validation Gate from
// 8/8/8 to 1/1/6 the last time the prompt was restructured.

const STATIC = 'SOUL\n\n---\n\nAGENTS\n\n---\n\nARTIFACT_INSTRUCTIONS\n\nJOURNEY_RULES';
const VOLATILE = '\n\n[MEMORY CONTEXT]\nturns: 3\n[STEER]\nclose check X';

describe('cache breakpoint — content preservation', () => {
  it('round-trips to the exact original bytes', () => {
    const joined = STATIC + CACHE_BREAKPOINT + VOLATILE;
    const parts = splitSystemForProvider(joined);
    expect(parts).not.toBeNull();
    expect(parts!.staticHalf + parts!.volatileHalf).toBe(STATIC + VOLATILE);
  });

  it('what the model sees is identical with and without the marker', () => {
    const withMarker = splitSystemForProvider(STATIC + CACHE_BREAKPOINT + VOLATILE)!;
    expect(withMarker.staticHalf + withMarker.volatileHalf).toBe(
      joinSystemForModel(STATIC, VOLATILE).replace(CACHE_BREAKPOINT, ''),
    );
  });

  it('puts the boundary exactly where the static half ends', () => {
    const p = splitSystemForProvider(STATIC + CACHE_BREAKPOINT + VOLATILE)!;
    expect(p.staticHalf).toBe(STATIC);
    expect(p.volatileHalf).toBe(VOLATILE);
  });
});

describe('cache breakpoint — fail-safe behaviour', () => {
  it('returns null for an unmarked prompt so callers keep their single-block path', () => {
    expect(splitSystemForProvider(STATIC + VOLATILE)).toBeNull();
    expect(splitSystemForProvider('')).toBeNull();
  });

  it('never leaves a sentinel where the model could read it', () => {
    const joined = STATIC + CACHE_BREAKPOINT + VOLATILE;
    expect(stripCacheBreakpoints(joined)).toBe(STATIC + VOLATILE);
    expect(stripCacheBreakpoints(joined)).not.toContain(CACHE_BREAKPOINT);
    // Multiple markers (upstream bug) must all be removed, not just the first.
    const doubled = `${STATIC}${CACHE_BREAKPOINT}mid${CACHE_BREAKPOINT}${VOLATILE}`;
    expect(stripCacheBreakpoints(doubled)).not.toContain(CACHE_BREAKPOINT);
  });

  it('emits no marker when there is no volatile half to separate', () => {
    expect(joinSystemForModel(STATIC, '')).toBe(STATIC);
    expect(joinSystemForModel(STATIC, '')).not.toContain(CACHE_BREAKPOINT);
  });

  it('is byte-identical to plain concatenation when the split is inactive', () => {
    // The split now defaults ON, but ONLY on the patched OpenRouter path:
    // CHAT_CACHE_SPLIT hard-disables itself when OPENROUTER_API_KEY is unset
    // (LLM_PROVIDER === 'anthropic'), which is the test environment. So this
    // asserts the direct-Anthropic guarantee: no marker can ever be emitted
    // toward the one provider that does not know how to strip it.
    expect(process.env.OPENROUTER_API_KEY).toBeFalsy();
    expect(joinSystemForModel(STATIC, VOLATILE)).toBe(STATIC + VOLATILE);
    expect(joinSystemForModel(STATIC, VOLATILE)).not.toContain(CACHE_BREAKPOINT);
  });

  it('emits exactly one strippable marker when the split is active (OpenRouter)', async () => {
    // Re-import the module graph with OPENROUTER_API_KEY present so the
    // module-load constants (router.LLM_PROVIDER → CHAT_CACHE_SPLIT) resolve
    // the way they do in prod. The shipped-default claim: marker present,
    // and stripping it restores plain concatenation byte-for-byte.
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.resetModules();
    try {
      const fresh = await import('@/lib/chat/cache-breakpoint');
      const joined = fresh.joinSystemForModel(STATIC, VOLATILE);
      expect(joined).toBe(STATIC + fresh.CACHE_BREAKPOINT + VOLATILE);
      expect(fresh.stripCacheBreakpoints(joined)).toBe(STATIC + VOLATILE);
      // Opt-out escape hatch still works without a code change.
      vi.stubEnv('CHAT_CACHE_SPLIT', '0');
      vi.resetModules();
      const optOut = await import('@/lib/chat/cache-breakpoint');
      expect(optOut.joinSystemForModel(STATIC, VOLATILE)).toBe(STATIC + VOLATILE);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('the route\'s two-half assembly is byte-identical to the old one-call build', () => {
    // THE regression guard. The route used to call buildSystemPromptString with
    // projectContext = dynamicContext; it now builds the static half with
    // projectContext: '' and appends '\n\n' + dynamicContext. Those must
    // produce the same string, or the "no content change" claim is false and
    // the gate risk comes back. Uses the REAL builder, not a stand-in.
    const tail = 'ARTIFACT_INSTRUCTIONS\n\nJOURNEY_RULES';
    const dynamicContext = '[JOURNEY STAGE] 3 open\n[MEMORY CONTEXT] ...';

    const before = buildSystemPromptString({ locale: 'en', context: 'chat', tail, projectContext: dynamicContext });
    const staticHalf = buildSystemPromptString({ locale: 'en', context: 'chat', tail, projectContext: '' });
    const after = joinSystemForModel(staticHalf, `\n\n${dynamicContext}`);

    expect(after).toBe(before);
  });

  it('holds for the empty-dynamic-context case too', () => {
    const tail = 'ARTIFACT_INSTRUCTIONS';
    const before = buildSystemPromptString({ locale: 'en', context: 'chat', tail, projectContext: '' });
    const after = joinSystemForModel(before, '');
    expect(after).toBe(before);
  });

  it('uses a sentinel that cannot collide with real prompt content', () => {
    // Angle-bracketed, screaming, package-prefixed, ASCII-only.
    expect(CACHE_BREAKPOINT).toMatch(/^<{3}[A-Z_]+>{3}$/);
    expect(CACHE_BREAKPOINT).not.toMatch(/[^\x20-\x7E]/);
  });
});
