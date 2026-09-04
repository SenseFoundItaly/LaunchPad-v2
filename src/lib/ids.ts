/**
 * Id generation, deliberately free of any Next.js import.
 *
 * This lived in api-helpers.ts, which imports NextResponse. That was invisible
 * until the grants sync ran as a standalone Netlify function: the bundle pulled
 * `next/server`, and the deployed function died on every invocation with
 * ERR_MODULE_NOT_FOUND (measured on prod 2026-09-04). Anything reachable from a
 * plain function must not drag the Next runtime in behind it.
 */
export function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = `${prefix}_`;
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
