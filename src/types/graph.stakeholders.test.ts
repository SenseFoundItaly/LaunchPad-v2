import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MACRO_CATEGORY, STAKEHOLDER_MACRO_CATEGORIES, isStakeholderNode, isDerivedAnalysisNode,
  type GraphNodeType, type MacroCategory,
} from './graph';
import { it as itMessages } from '@/lib/i18n/messages/it';
import { en } from '@/lib/i18n/messages/en';

/**
 * Changelog 05/09 item 7c + the PROPOSTA — "Quando 'applico' le analisi al mio
 * backbone, poi non ritrovo le info nel graph ma solo nella knowledge testuale."
 *
 * Founder decision 2026-09-10: "Graph lo lascerei solo per stakeholders ma non
 * per analisi e output super dinamici."
 *
 * So the founder's reading was CORRECT — analyses belong in the list. It just
 * was not intentional, and nothing said so. Measured the same day: 400 of 785
 * prod nodes (51%) were analysis output, so half the "ecosystem map" was
 * findings rather than people.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('the graph is a stakeholder map', () => {
  it('keeps exactly the six roles the founder named, and no others', () => {
    // "concorrenti, partners, clienti, fornitori, ecc"
    expect([...STAKEHOLDER_MACRO_CATEGORIES].sort()).toEqual(
      ['clienti', 'concorrenza', 'fornitori', 'hr_collabs', 'investitori', 'partner'],
    );
  });

  it('drops exactly the six the founder asked to move into ad-hoc sections', () => {
    // "MVP architecture, branding, tech trends, market trends, Go to market,
    // brainstorming"
    const all = new Set(Object.values(MACRO_CATEGORY).filter(Boolean) as MacroCategory[]);
    const dropped = [...all].filter((c) => !STAKEHOLDER_MACRO_CATEGORIES.has(c)).sort();
    expect(dropped).toEqual(['branding', 'business_essentials', 'gtm', 'prodotto', 'trend_mercato', 'trend_tech']);
  });

  it('never drops the startup root — the centre the satellites hang from', () => {
    expect(isStakeholderNode('your_startup')).toBe(true);
    expect(MACRO_CATEGORY.your_startup).toBeNull();
  });

  it('classifies EVERY node type, so a new one cannot vanish silently', () => {
    // MACRO_CATEGORY is a Record<GraphNodeType, …>, so the compiler already
    // forces a category on every new type; this asserts the runtime follow-on
    // — each type lands on exactly one side of the split.
    for (const type of Object.keys(MACRO_CATEGORY) as GraphNodeType[]) {
      expect(typeof isStakeholderNode(type), type).toBe('boolean');
    }
    expect(isStakeholderNode('competitor')).toBe(true);
    expect(isStakeholderNode('supplier')).toBe(true);
    expect(isStakeholderNode('trend')).toBe(false);
    expect(isStakeholderNode('gtm_strategy')).toBe(false);
    expect(isStakeholderNode('risk')).toBe(false);
  });
});

describe('nothing is hidden — analyses move, they do not disappear', () => {
  it('the Knowledge list does NOT filter on the stakeholder split', () => {
    // This is the whole safety condition. The graph filters by stakeholder;
    // the list must not, or applying an analysis would make it unreachable
    // instead of merely elsewhere — which would be worse than item 7c.
    const unified = read('src/lib/knowledge/unified.ts');
    expect(unified).toMatch(/isDerivedAnalysisNode/);
    expect(unified, 'the list must keep showing analyses').not.toMatch(/isStakeholderNode/);
  });

  it('the graph route applies BOTH filters, for their two different reasons', () => {
    const route = read('src/app/api/graph/[projectId]/route.ts');
    expect(route).toMatch(/!isDerivedAnalysisNode\(n\.node_type as string\)/);
    expect(route).toMatch(/&& isStakeholderNode\(n\.node_type as string\)/);
  });

  it('scaffolding stays hidden from both surfaces — a title is not an entity', () => {
    for (const t of ['metrics', 'benchmark', 'comparison', 'competitor_set', 'research_metric']) {
      expect(isDerivedAnalysisNode(t), t).toBe(true);
    }
  });
});

describe('the surface says what it is for', () => {
  it('both languages explain the scope, and name where analyses live', () => {
    expect(en['knowledge.graph-scope']).toMatch(/Knowledge list/);
    expect(itMessages['knowledge.graph-scope']).toMatch(/Knowledge/);
    expect(en['knowledge.graph-will-populate']).toMatch(/stakeholder/i);
    expect(itMessages['knowledge.graph-will-populate']).toMatch(/stakeholder/i);
  });

  it('and the empty state renders it', () => {
    expect(read('src/components/graph/KnowledgeGraph.tsx')).toMatch(/knowledge\.graph-scope/);
  });
});

describe('the spine metaphor reads as Italian', () => {
  it('no string calls the validation tracker a spinal column', () => {
    // "spine" is the product's name for the validation tracker; translated
    // literally, "spina dorsale" is the anatomical spinal column, and the
    // approval card read "approve what ends up on your spinal column".
    // Luca's own word for it, in the changelog, is the English "backbone".
    const it = read('src/lib/i18n/messages/it.ts');
    expect(it).not.toMatch(/spina dorsale/);
    expect(it).toMatch(/percorso di validazione/);
  });
});
