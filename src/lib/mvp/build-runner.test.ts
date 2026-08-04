import { describe, it, expect, afterEach } from 'vitest';
import { assertBuildAllowed } from './build-runner';
import type { BuilderAdapter } from '@/lib/builders/types';

// Minimal fake adapters — assertBuildAllowed only reads id + supportsAsync.
const sync = { id: 'e2b', supportsAsync: false } as unknown as BuilderAdapter;
const asyncDriver = { id: 'v0', supportsAsync: true } as unknown as BuilderAdapter;
const stub = { id: 'stub' } as unknown as BuilderAdapter;

const KEYS = ['NETLIFY', 'VERCEL', 'AWS_LAMBDA_FUNCTION_NAME', 'BUILD_KILL_SWITCH', 'BUILD_ALLOW_SYNC'];

describe('assertBuildAllowed guards (pre-DB branches)', () => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('exempts the free stub driver even on a serverless host', async () => {
    process.env.NETLIFY = '1';
    await expect(assertBuildAllowed('p', stub)).resolves.toBeUndefined();
  });

  it('kill-switch pauses paid builds before anything else', async () => {
    process.env.BUILD_KILL_SWITCH = '1';
    await expect(assertBuildAllowed('p', asyncDriver)).rejects.toThrow(/BUILD_CAPPED/);
  });

  it('refuses a sync-only driver on a serverless host (would exceed the function limit)', async () => {
    delete process.env.BUILD_KILL_SWITCH;
    delete process.env.BUILD_ALLOW_SYNC;
    process.env.NETLIFY = '1';
    await expect(assertBuildAllowed('p', sync)).rejects.toThrow(/BUILD_UNSUPPORTED/);
  });
});
