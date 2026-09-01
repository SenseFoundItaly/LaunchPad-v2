/**
 * Next.js server instrumentation — runs once per server process start.
 *
 * Outbound keep-alive tune (round-2 velocity audit): Node's global fetch uses
 * undici, whose default keep-alive idle timeout (~4s) closes the OpenRouter
 * connection during every tool phase longer than that — so the LLM sub-call
 * AFTER a research batch pays a fresh TCP+TLS handshake (~100-300ms) on top of
 * TTFT, on every turn's first call and after every long tool wait. A 60s idle
 * keeps the connection warm across tool phases within a turn and across the
 * sub-calls of the agent loop.
 *
 * setGlobalDispatcher from the npm `undici` package reaches Node's built-in
 * fetch through the shared global-dispatcher symbol registry; on a Node where
 * the symbol version ever diverged this degrades to a no-op, never a break.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { setGlobalDispatcher, Agent } = await import('undici');
      setGlobalDispatcher(
        new Agent({
          keepAliveTimeout: 60_000,
          keepAliveMaxTimeout: 60_000,
        }),
      );
    } catch (err) {
      console.warn('[instrumentation] keep-alive tune skipped (non-fatal):', (err as Error).message);
    }
  }
}
