import { describe, it, expect } from 'vitest';
import {
  MACRO_CATEGORY,
  MACRO_CATEGORY_COLOR,
  MACRO_CATEGORY_LABEL,
  MACRO_CATEGORY_ORDER,
  LEGACY_TYPE_CATEGORY,
  NODE_COLORS,
  NODE_TYPE_LABEL,
  macroCategoryFor,
  nodeTypeLabel,
  type GraphNodeType,
  type MacroCategory,
} from './graph';

// MACRO_CATEGORY and NODE_TYPE_LABEL are Record<GraphNodeType, …> so the
// compiler already guarantees they're exhaustive; iterating MACRO_CATEGORY's
// keys therefore enumerates every node type. NODE_COLORS is Record<string,
// string> — NOT type-checked — so its coverage is the real runtime assertion
// here (a missing entry = anonymous grey dot outside the legend).
const ALL_NODE_TYPES = Object.keys(MACRO_CATEGORY) as GraphNodeType[];

describe('graph taxonomy — 12-satellite hub-and-spoke', () => {
  it('has exactly 12 macro-categories in the mockup clockwise order', () => {
    expect(MACRO_CATEGORY_ORDER).toEqual([
      'fornitori', 'clienti', 'hr_collabs', 'concorrenza', 'business_essentials', 'prodotto',
      'branding', 'partner', 'trend_tech', 'investitori', 'gtm', 'trend_mercato',
    ]);
    expect(new Set(MACRO_CATEGORY_ORDER).size).toBe(12);
  });

  it('every node type has a NODE_COLORS entry', () => {
    for (const type of ALL_NODE_TYPES) {
      expect(NODE_COLORS[type], `NODE_COLORS missing '${type}'`).toBeTruthy();
    }
  });

  it('every node type has a bilingual label', () => {
    for (const type of ALL_NODE_TYPES) {
      expect(NODE_TYPE_LABEL[type]?.en, `en label missing for '${type}'`).toBeTruthy();
      expect(NODE_TYPE_LABEL[type]?.it, `it label missing for '${type}'`).toBeTruthy();
    }
  });

  it('every node type maps into an ordered category (root excepted)', () => {
    for (const type of ALL_NODE_TYPES) {
      const cat = MACRO_CATEGORY[type];
      if (type === 'your_startup') {
        expect(cat).toBeNull();
        continue;
      }
      expect(cat, `'${type}' has no category`).not.toBeNull();
      expect(MACRO_CATEGORY_ORDER).toContain(cat as MacroCategory);
    }
  });

  it('every satellite has a colour, a bilingual label, and at least one resident type', () => {
    const residents = new Set(Object.values(MACRO_CATEGORY).filter(Boolean));
    for (const cat of MACRO_CATEGORY_ORDER) {
      expect(MACRO_CATEGORY_COLOR[cat], `colour missing for '${cat}'`).toBeTruthy();
      expect(MACRO_CATEGORY_LABEL[cat]?.en, `en label missing for '${cat}'`).toBeTruthy();
      expect(MACRO_CATEGORY_LABEL[cat]?.it, `it label missing for '${cat}'`).toBeTruthy();
      expect(residents.has(cat), `no node type lands in '${cat}'`).toBe(true);
    }
  });

  it('routes the product-analysis types into prodotto (the 12th satellite)', () => {
    for (const type of ['feature', 'metric', 'metrics', 'benchmark', 'comparison', 'research_metric']) {
      expect(macroCategoryFor(type)).toBe('prodotto');
    }
  });

  it('routes the 2026-07 named roles into their satellites', () => {
    expect(macroCategoryFor('supplier')).toBe('fornitori');
    expect(macroCategoryFor('hr_collaborator')).toBe('hr_collabs');
    expect(macroCategoryFor('brand_asset')).toBe('branding');
    expect(macroCategoryFor('gtm_strategy')).toBe('gtm');
    expect(macroCategoryFor('business_essential')).toBe('business_essentials');
    expect(macroCategoryFor('technology')).toBe('trend_tech');
    expect(macroCategoryFor('trend')).toBe('trend_mercato');
    expect(macroCategoryFor('signal')).toBe('trend_mercato');
    expect(macroCategoryFor('risk')).toBe('business_essentials');
    expect(macroCategoryFor('compliance')).toBe('business_essentials');
    expect(macroCategoryFor('regulation')).toBe('business_essentials');
  });

  it('maps legacy prod row types via the alias map', () => {
    expect(macroCategoryFor('customer')).toBe('clienti');
    expect(macroCategoryFor('investor')).toBe('investitori');
    expect(macroCategoryFor('entity')).toBe('business_essentials');
    for (const legacy of Object.keys(LEGACY_TYPE_CATEGORY)) {
      expect(MACRO_CATEGORY_ORDER).toContain(LEGACY_TYPE_CATEGORY[legacy]);
    }
  });

  it('falls back unknown types to business_essentials, root to null', () => {
    expect(macroCategoryFor('some_future_type')).toBe('business_essentials');
    expect(macroCategoryFor('your_startup')).toBeNull();
  });

  it('keeps technology dots distinct from partner (legend collision fix)', () => {
    expect(NODE_COLORS.technology).toBe('var(--sky)');
    expect(NODE_COLORS.technology).not.toBe(NODE_COLORS.partner);
  });

  it('nodeTypeLabel resolves per-locale and humanizes unknowns', () => {
    expect(nodeTypeLabel('funding_source', 'it')).toBe('Investitore');
    expect(nodeTypeLabel('funding_source', 'en')).toBe('Investor');
    expect(nodeTypeLabel('mystery_type', 'en')).toBe('mystery type');
  });
});
