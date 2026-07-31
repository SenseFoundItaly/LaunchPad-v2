import { describe, it, expect } from 'vitest';
import { extractResolvedMap } from './resolved-action-status';

// The reload-guard hook seeds proposal cards from resolved action statuses.
// This extractor reads the /actions response; its shape bit us once (the route
// nests the array under data.actions, and reading `data` as the array silently
// yielded {} → no seed → card stayed clickable after refresh — live-caught).
describe('extractResolvedMap', () => {
  it('reads the canonical { data: { actions } } shape', () => {
    const body = { success: true, data: { actions: [
      { id: 'pa_1', status: 'sent' },
      { id: 'pa_2', status: 'rejected' },
    ], summary: null } };
    expect(extractResolvedMap(body)).toEqual({ pa_1: 'sent', pa_2: 'rejected' });
  });

  it('tolerates the flat { actions } and bare-array shapes', () => {
    expect(extractResolvedMap({ actions: [{ id: 'a', status: 'applied' }] })).toEqual({ a: 'applied' });
    expect(extractResolvedMap([{ id: 'b', status: 'failed' }])).toEqual({ b: 'failed' });
  });

  it('returns {} for null / malformed / rows missing id or status', () => {
    expect(extractResolvedMap(null)).toEqual({});
    expect(extractResolvedMap({ data: {} })).toEqual({});
    expect(extractResolvedMap({ data: { actions: [{ status: 'sent' }, { id: 'x' }] } })).toEqual({});
  });
});
