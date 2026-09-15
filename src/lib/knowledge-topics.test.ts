import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildKnowledgeTopics,
  KNOWLEDGE_TOPICS,
  TOPIC_FACT_KINDS,
  TOPIC_NODE_TYPES,
  type TopicFactRow,
  type TopicNodeRow,
} from './knowledge-topics';
import { en } from './i18n/messages/en';
import { it as itMessages } from './i18n/messages/it';

/**
 * The 05/09 proposta's remaining ad-hoc sections — Go to market, market
 * trends, tech trends, brainstorming — built only where evidence exists
 * (measured on prod 2026-09-15), as one tabbed panel on Knowledge.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

const fact = (id: string, kind: string, text: string, day: string): TopicFactRow =>
  ({ id, kind, fact: text, created_at: `2026-09-${day}T00:00:00.000Z` });
const node = (id: string, node_type: string, name: string, summary: string | null, day: string, attributes: unknown = null): TopicNodeRow =>
  ({ id, node_type, name, summary, attributes, created_at: `2026-09-${day}T00:00:00.000Z` });

describe('the topics read the sources that actually hold data', () => {
  it('GTM reads the approved gate kinds and the gtm graph wedge', () => {
    const gtm = KNOWLEDGE_TOPICS.find((t) => t.id === 'gtm')!;
    expect(gtm.factKinds).toEqual(['gtm_fact', 'channel_fact']);
    expect(gtm.nodeTypes).toContain('gtm_strategy');
  });

  it('node types are derived from MACRO_CATEGORY, so trend signals are market trends', () => {
    const market = KNOWLEDGE_TOPICS.find((t) => t.id === 'market_trends')!;
    expect(market.nodeTypes).toEqual(expect.arrayContaining(['trend', 'signal']));
    expect(KNOWLEDGE_TOPICS.find((t) => t.id === 'tech_trends')!.nodeTypes).toEqual(['technology']);
  });

  it('never duplicates MVP architecture: 1B tech facts stay in that panel', () => {
    for (const k of ['tech_feasibility_fact', 'tech_risk_fact', 'tech_dependency_fact', 'regulatory_fact', 'ip_fact', 'data_fact']) {
      expect(TOPIC_FACT_KINDS, k).not.toContain(k);
    }
  });

  it('has no Branding topic: zero brand_asset rows exist, so it would never populate', () => {
    expect(KNOWLEDGE_TOPICS.map((t) => t.id)).not.toContain('branding');
    expect(TOPIC_NODE_TYPES).not.toContain('brand_asset');
  });

  it('never surfaces stakeholder nodes — those belong to the graph', () => {
    for (const t of ['competitor', 'partner', 'persona', 'supplier', 'funding_source', 'hr_collaborator']) {
      expect(TOPIC_NODE_TYPES, t).not.toContain(t);
    }
  });
});

describe('buildKnowledgeTopics', () => {
  it('groups facts and nodes by topic, newest first', () => {
    const r = buildKnowledgeTopics(
      [fact('f1', 'gtm_fact', 'Opportunità GTM — farmacie', '01'), fact('f2', 'channel_fact', 'Canale di acquisizione — SEO', '03')],
      [node('n1', 'gtm_strategy', 'Channels', 'Outbound; SEO', '02'), node('n2', 'technology', 'WebRTC', 'Video in-browser', '01')],
    );
    const gtm = r.sections.find((s) => s.id === 'gtm')!;
    expect(gtm.items.map((i) => i.id)).toEqual(['f2', 'n1', 'f1']);
    expect(gtm.items.find((i) => i.id === 'n1')).toMatchObject({ title: 'Channels', text: 'Outbound; SEO' });
    expect(r.sections.find((s) => s.id === 'tech_trends')!.items).toHaveLength(1);
    expect(r.total).toBe(4);
  });

  it('turns each Brainstorming note into its own item, not the bucket boilerplate', () => {
    const r = buildKnowledgeTopics([], [
      node('b1', 'brainstorming', 'Brainstorming', 'Your quick notes…', '01', {
        notes: [{ text: 'Newsletter per fisioterapisti?', at: '2026-09-05T00:00:00.000Z' }, { text: '  ' }],
        timeline: [],
      }),
    ]);
    const brain = r.sections.find((s) => s.id === 'brainstorming')!;
    expect(brain.items).toEqual([{ id: 'b1:0', title: null, text: 'Newsletter per fisioterapisti?', created_at: '2026-09-05T00:00:00.000Z' }]);
  });

  it('tolerates double-encoded attributes', () => {
    const r = buildKnowledgeTopics([], [node('b1', 'brainstorming', 'Brainstorming', null, '01', JSON.stringify({ notes: [{ text: 'idea' }] }))]);
    expect(r.sections.find((s) => s.id === 'brainstorming')!.items).toHaveLength(1);
  });

  it('keeps the full text — nothing is shortened', () => {
    const long = 'x'.repeat(2500);
    const r = buildKnowledgeTopics([fact('f1', 'trend_fact', long, '01')], []);
    expect(r.sections.find((s) => s.id === 'market_trends')!.items[0].text).toHaveLength(2500);
  });

  it('empty input gives empty sections and a zero total', () => {
    const r = buildKnowledgeTopics([], []);
    expect(r.total).toBe(0);
    expect(r.sections.every((s) => s.items.length === 0)).toBe(true);
  });
});

describe('the route and panel keep the MvpArchitecturePanel contract', () => {
  const route = read('src/app/api/projects/[projectId]/knowledge-topics/route.ts');
  const panel = read('src/components/knowledge/KnowledgeTopicsPanel.tsx');

  it('shows APPROVED evidence only, from both stores', () => {
    expect(route.match(/reviewed_state = 'applied'/g)).toHaveLength(2);
  });

  it('is read-only', () => {
    expect(route).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/);
  });

  it('is mounted on the Knowledge page', () => {
    expect(read('src/app/project/[projectId]/knowledge/page.tsx'))
      .toMatch(/<KnowledgeTopicsPanel projectId=\{projectId\} \/>/);
  });

  it('renders nothing until some topic has evidence', () => {
    expect(panel).toMatch(/if \(sections\.length === 0\) return null/);
  });

  it('never clips a finding', () => {
    expect(panel).toMatch(/whiteSpace: 'pre-wrap'/);
    expect(panel).not.toMatch(/\.slice\(0, \d+\)/);
  });

  it('sits under the knowledge query prefix, so the event bridge refreshes it', () => {
    expect(panel).toMatch(/queryKey: \['knowledge', projectId, 'topics'\]/);
  });

  it('reads its remembered open state in the initialiser, not an effect', () => {
    expect(panel).toMatch(/useState<boolean>\(\(\) => \{[\s\S]*localStorage\.getItem/);
    expect(panel).not.toMatch(/useEffect\([^)]*\{[^}]*setOpen/);
  });

  it('is translated in both languages', () => {
    for (const k of ['topics.title', 'topics.subtitle', 'topics.section-gtm', 'topics.section-market-trends',
      'topics.section-tech-trends', 'topics.section-brainstorming'] as const) {
      expect(en[k], `${k} en`).toBeTruthy();
      expect(itMessages[k], `${k} it`).toBeTruthy();
    }
  });
});
