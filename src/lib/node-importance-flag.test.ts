import { describe, it, expect, afterEach } from 'vitest';
import { nodeImportanceEnabled } from './node-importance-flag';

afterEach(() => {
  delete process.env.NODE_IMPORTANCE_AI;
  delete process.env.NODE_IMPORTANCE_AI_PROJECTS;
});

describe('nodeImportanceEnabled', () => {
  it('is off by default (no env)', () => {
    expect(nodeImportanceEnabled('proj_x')).toBe(false);
  });

  it('global NODE_IMPORTANCE_AI=1 enables every project', () => {
    process.env.NODE_IMPORTANCE_AI = '1';
    expect(nodeImportanceEnabled('proj_anything')).toBe(true);
  });

  it('per-project list enables only the listed projects (trims whitespace)', () => {
    process.env.NODE_IMPORTANCE_AI_PROJECTS = 'proj_a, proj_b';
    expect(nodeImportanceEnabled('proj_a')).toBe(true);
    expect(nodeImportanceEnabled('proj_b')).toBe(true);
    expect(nodeImportanceEnabled('proj_c')).toBe(false); // control
  });

  it('ignores empty/blank list entries', () => {
    process.env.NODE_IMPORTANCE_AI_PROJECTS = ' , ,';
    expect(nodeImportanceEnabled('proj_a')).toBe(false);
  });
});
