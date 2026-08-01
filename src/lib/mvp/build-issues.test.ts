import { describe, it, expect } from 'vitest';
import { pickTopCluster, clusterReady, type MvpBuildIssue } from './build-issues';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000; // fixed epoch for determinism

function issue(over: Partial<MvpBuildIssue>): MvpBuildIssue {
  return {
    id: over.id ?? `i_${Math.abs(JSON.stringify(over).length)}_${over.title ?? ''}`,
    project_id: 'p',
    feature: 'General',
    title: 'do a thing',
    severity: null,
    status: 'open',
    evidence_count: 1,
    shipped_in_iteration: null,
    created_at: new Date(NOW - DAY).toISOString(),
    updated_at: new Date(NOW - DAY).toISOString(),
    ...over,
  };
}

describe('pickTopCluster', () => {
  it('returns null with no issues', () => {
    expect(pickTopCluster([])).toBeNull();
  });

  it('groups by feature and prefers the cluster with any high severity', () => {
    const top = pickTopCluster([
      issue({ id: 'a', feature: 'Pricing', evidence_count: 5 }),
      issue({ id: 'b', feature: 'Pricing', evidence_count: 4 }),
      issue({ id: 'c', feature: 'Auth', severity: 'high', evidence_count: 1 }),
    ]);
    expect(top?.feature).toBe('Auth'); // high severity outranks raw evidence
    expect(top?.anyHigh).toBe(true);
  });

  it('falls back to total evidence when no cluster has high severity', () => {
    const top = pickTopCluster([
      issue({ id: 'a', feature: 'Pricing', evidence_count: 3 }),
      issue({ id: 'b', feature: 'Pricing', evidence_count: 2 }),
      issue({ id: 'c', feature: 'Design', evidence_count: 4 }),
    ]);
    expect(top?.feature).toBe('Pricing'); // 5 total beats 4
    expect(top?.issues.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });
});

describe('clusterReady (batching threshold — an iteration costs a credit)', () => {
  it('ready with ≥2 issues', () => {
    const c = pickTopCluster([issue({ id: 'a', feature: 'X' }), issue({ id: 'b', feature: 'X' })])!;
    expect(clusterReady(c, NOW)).toBe(true);
  });

  it('ready with a single HIGH issue', () => {
    const c = pickTopCluster([issue({ id: 'a', severity: 'high' })])!;
    expect(clusterReady(c, NOW)).toBe(true);
  });

  it('NOT ready with one fresh low/medium issue (batch instead)', () => {
    const c = pickTopCluster([issue({ id: 'a', severity: 'medium' })])!;
    expect(clusterReady(c, NOW)).toBe(false);
  });

  it('ready when the single issue has waited a week', () => {
    const c = pickTopCluster([
      issue({ id: 'a', severity: 'low', created_at: new Date(NOW - 8 * DAY).toISOString() }),
    ])!;
    expect(clusterReady(c, NOW)).toBe(true);
  });
});
