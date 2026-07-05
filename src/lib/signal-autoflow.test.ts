import { describe, it, expect } from 'vitest';
import { decideAutoflowRoute, AUTOFLOW_JUNK_FLOOR, AUTOFLOW_NEW_ENTITY_MIN } from './signal-autoflow';

describe('decideAutoflowRoute', () => {
  const applied = { id: 'gnode_1', reviewed_state: 'applied' };
  const rejected = { id: 'gnode_2', reviewed_state: 'rejected' };

  it('drops below the junk floor regardless of entity/match', () => {
    expect(decideAutoflowRoute({ relevance_score: 0.3, entity: 'Slack' }, applied).verdict).toBe('drop');
    expect(decideAutoflowRoute({ relevance_score: 0.49, entity: null }, null).verdict).toBe('drop');
  });

  it('falls back to inbox when no entity is resolvable', () => {
    expect(decideAutoflowRoute({ relevance_score: 0.95, entity: null }, null).verdict).toBe('inbox');
    expect(decideAutoflowRoute({ relevance_score: 0.95, entity: '   ' }, null).verdict).toBe('inbox');
  });

  it('drops when the matched node is a founder-rejected tombstone', () => {
    const d = decideAutoflowRoute({ relevance_score: 0.9, entity: 'DeadRival' }, rejected);
    expect(d.verdict).toBe('drop');
    expect(d.reason).toMatch(/tombstone/);
  });

  it('enriches an existing APPLIED node at any relevance above the floor', () => {
    const d = decideAutoflowRoute({ relevance_score: 0.55, entity: 'Slack' }, applied);
    expect(d.verdict).toBe('enrich');
    expect(d.nodeId).toBe('gnode_1');
  });

  it('routes a PENDING-proposal match to the inbox (never auto-approves unreviewed knowledge)', () => {
    const d = decideAutoflowRoute({ relevance_score: 0.9, entity: 'Slack' }, { id: 'g', reviewed_state: 'pending' });
    expect(d.verdict).toBe('inbox');
  });

  it('auto-creates a new entity only at high relevance', () => {
    expect(decideAutoflowRoute({ relevance_score: 0.85, entity: 'NewCo' }, null).verdict).toBe('new_entity');
    expect(decideAutoflowRoute({ relevance_score: AUTOFLOW_NEW_ENTITY_MIN, entity: 'NewCo' }, null).verdict).toBe('new_entity');
  });

  it('sends mid-confidence new entities to the inbox for human review', () => {
    const d = decideAutoflowRoute({ relevance_score: 0.7, entity: 'MaybeCo' }, null);
    expect(d.verdict).toBe('inbox');
  });

  it('boundary: exactly at the junk floor is NOT junk', () => {
    expect(decideAutoflowRoute({ relevance_score: AUTOFLOW_JUNK_FLOOR, entity: 'Slack' }, applied).verdict).toBe('enrich');
  });
});
