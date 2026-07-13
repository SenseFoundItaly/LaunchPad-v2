import { describe, it, expect, afterEach } from 'vitest';
import { getBuilder, listBuilders, getActiveBuilder, activeBuilderId } from './index';
import { stubAdapter } from './stub';

describe('builder registry', () => {
  const orig = process.env.BUILD_DRIVER;
  afterEach(() => {
    if (orig === undefined) delete process.env.BUILD_DRIVER;
    else process.env.BUILD_DRIVER = orig;
  });

  it('resolves the registered drivers', () => {
    expect(getBuilder('stub').id).toBe('stub');
    expect(getBuilder('v0').id).toBe('v0');
    expect(getBuilder('e2b').id).toBe('e2b');
  });

  it('throws on an unregistered driver id', () => {
    expect(() => getBuilder('lovable')).toThrow();
  });

  it('lists registered drivers including the stub', () => {
    expect(listBuilders().map((b) => b.id)).toContain('stub');
  });

  it('activeBuilderId honors BUILD_DRIVER and defaults to stub', () => {
    process.env.BUILD_DRIVER = 'v0';
    expect(activeBuilderId()).toBe('v0');
    expect(getActiveBuilder().id).toBe('v0');
    process.env.BUILD_DRIVER = 'stub';
    expect(getActiveBuilder().id).toBe('stub');
    delete process.env.BUILD_DRIVER;
    expect(activeBuilderId()).toBe('stub');
  });
});

describe('stub driver contract', () => {
  const ref = { projectId: 'p', buildId: 'b1' };

  it('create returns live with a self-contained data: preview', async () => {
    const r = await stubAdapter.create(ref, { prompt: 'hello' });
    expect(r.status).toBe('live');
    expect(r.previewUrl).toMatch(/^data:text\/html/);
    expect(r.builderRef).toContain('b1');
  });

  it('is async-capable and instant-live', async () => {
    expect(stubAdapter.supportsAsync).toBe(true);
    expect((await stubAdapter.createAsync!(ref, { prompt: 'x' })).status).toBe('live');
    expect((await stubAdapter.getStatus!(ref, 'x')).status).toBe('live');
  });

  it('iterate returns live with a diff', async () => {
    const r = await stubAdapter.iterate(ref, 'ref', 'make the header blue');
    expect(r.status).toBe('live');
    expect(r.diff?.files?.length ?? 0).toBeGreaterThan(0);
  });
});
