import { describe, expect, it } from 'vitest';
import { createScenarios } from '../../../scripts/fixtures/copilot-ux.mjs';
import { parseMessageContent } from '@/lib/artifact-parser';

describe('copilot UX fixture contract', () => {
  const scenarios = createScenarios();
  it.each(scenarios)('$key renders every complete artifact with the real parser', (scenario) => {
    const ids = new Set<string>();
    for (const message of scenario.messages) {
      const segments = parseMessageContent(message.content);
      expect(segments.filter(s => s.type === 'artifact-error' || s.type === 'artifact-pending')).toEqual([]);
      const artifacts = segments.filter(s => s.type === 'artifact');
      expect(artifacts).toHaveLength((message.content.match(/:::artifact/g) ?? []).length);
      for (const segment of artifacts) {
        expect(segment.artifact.id).toBeTruthy();
        expect(ids.has(segment.artifact.id!)).toBe(false);
        ids.add(segment.artifact.id!);
      }
    }
  });
  it('keeps the revision distinct from the saved scope, without changing other fields', () => {
    const revision = scenarios.find(s => s.key === 'revision')!;
    const differences = revision.actions[0].artifact.items.filter(item => revision.canvas![item.field] !== item.value);
    expect(differences.map(item => item.field)).toEqual(['target_market']);
  });
  it('keeps discussion and long-chat fixtures free of approval actions', () => {
    for (const key of ['discussion', 'long-it']) {
      const scenario = scenarios.find(s => s.key === key)!;
      expect(scenario.actions).toEqual([]);
      expect(scenario.canvas).toBeNull();
    }
    const long = scenarios.find(s => s.key === 'long-it')!;
    expect(long.locale).toBe('it');
    expect(long.messages.length).toBeGreaterThan(100);
    expect(long.messages.at(-2)!.content).toContain('Torino, non a Milano');
  });
});
