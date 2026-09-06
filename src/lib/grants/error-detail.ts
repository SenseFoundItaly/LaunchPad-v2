/**
 * Unwrap an error into something a human can act on.
 *
 * Node's fetch reports every transport failure as the bare string "fetch
 * failed" and hides the real reason on `cause` — often nested twice. On
 * 2026-09-04 that cost a full debugging round: incentivi.gov.it started
 * failing from Netlify while working from a laptop, and all funding_source_state
 * could say was "fetch failed", which distinguishes a DNS failure from a TLS
 * rejection from a refused connection not at all.
 *
 * The output goes into last_error, which the founder-facing freshness row
 * renders, so it stays short and free of stack traces.
 */

interface Errnoish {
  message?: unknown;
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
  hostname?: unknown;
  cause?: unknown;
}

const MAX = 500;

export function describeError(err: unknown, maxLength: number = MAX): string {
  const parts: string[] = [];
  let current: unknown = err;
  const seen = new Set<unknown>();

  // Three levels is enough for undici (Error → AggregateError → Errno) and
  // stops a self-referential cause chain from looping.
  for (let depth = 0; depth < 3 && current && !seen.has(current); depth++) {
    seen.add(current);
    const e = current as Errnoish;
    const bits: string[] = [];
    const message = typeof e.message === 'string' ? e.message.trim() : '';
    if (message && !parts.some((p) => p.includes(message))) bits.push(message);
    for (const key of ['code', 'errno', 'syscall', 'hostname'] as const) {
      const v = e[key];
      if (v !== undefined && v !== null && v !== '') bits.push(`${key}=${String(v)}`);
    }
    if (bits.length > 0) parts.push(bits.join(' '));
    // AggregateError carries the real failures in .errors, not .cause.
    const aggregate = (current as { errors?: unknown }).errors;
    current = e.cause ?? (Array.isArray(aggregate) ? aggregate[0] : undefined);
  }

  const out = parts.join(' ← ') || String(err);
  return out.length > maxLength ? `${out.slice(0, maxLength - 1)}…` : out;
}
