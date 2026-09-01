import { describe, it, expect } from 'vitest';
import { parseChipCommit, buildCommitFastPathContent, type ChipCommit } from './commit-fast-path';
import { CANVAS_COMMIT_FIELD_KEYS } from '@/lib/canvas-commit';
import type { NextBestAction } from '@/lib/direction';

// Commit-guard regexes copied VERBATIM from src/app/api/chat/route.ts
// (claimedCanvasCommit and the two claimedPaidCommit patterns in the
// [COMMIT GUARD] block). If the route's guards change, update these copies —
// the whole point of this test is that the fast path's canned prose can
// never trip the next turn's guard into nagging about a commit that DID land.
const GUARD_CANVAS = /(committed|locked in|saved to (?:your )?canvas|added to (?:your )?canvas|registrat\w+ nel canvas|salvat\w+ nel canvas|aggiornat\w+ il canvas|inserit\w+ nel canvas|bloccat\w+ (?:nel|sul) canvas)/i;
const GUARD_PAID_1 = /(added|saved|recorded|logged|captured|aggiunt\w+|salvat\w+|registrat\w+|inserit\w+)[^.\n]{0,40}(competitors?|to (?:your )?graph|to (?:your )?intelligence|market siz\w*|TAM\b|al grafo|all'intelligence|dimension\w+ di mercato)/i;
const GUARD_PAID_2 = /(competitors?|market siz\w*)[^.\n]{0,40}(added|saved|recorded|logged|aggiunt\w+|salvat\w+|registrat\w+)/i;

const USER_MSG = [{ role: 'user', content: 'Scelgo: Conferma — commit nel canvas' }];

function nba(overrides: Partial<NextBestAction> = {}): NextBestAction {
  return {
    cold_start: false,
    stage_number: 1,
    stage_label: 'Idea Canvas',
    progress: { passed: 3, total: 9 },
    top_gap: 'Value proposition is written down',
    top_gap_source: null,
    recommended_skill: {
      id: 'startup-scoring',
      label: 'Run the baseline score',
      kickoff: 'Score my startup across the 10 dimensions.',
      stage_number: 1,
    },
    action: 'Close the next Stage 1 check',
    rationale: 'Stage 1 — 3/9 checks passed',
    fresh_signals: [],
    pending_signals: [],
    risk_overrides: [],
    ...overrides,
  } as NextBestAction;
}

describe('parseChipCommit — strict trigger predicate', () => {
  it('accepts the exact commit:apply shape', () => {
    expect(parseChipCommit({ canvas_fields: ['problem'], item_kinds: [] }, 'chat', USER_MSG))
      .toEqual({ canvas_fields: ['problem'], item_kinds: [] });
    expect(parseChipCommit({ canvas_fields: [], item_kinds: ['competitor'] }, 'chat', USER_MSG))
      .toEqual({ canvas_fields: [], item_kinds: ['competitor'] });
  });

  it('accepts every canonical canvas key', () => {
    for (const key of CANVAS_COMMIT_FIELD_KEYS) {
      expect(parseChipCommit({ canvas_fields: [key], item_kinds: [] }, 'chat', USER_MSG)).not.toBeNull();
    }
  });

  it('rejects aliased/unknown field names', () => {
    expect(parseChipCommit({ canvas_fields: ['costi'], item_kinds: [] }, 'chat', USER_MSG)).toBeNull();
    expect(parseChipCommit({ canvas_fields: ['Problem'], item_kinds: [] }, 'chat', USER_MSG)).toBeNull();
  });

  it('rejects both-empty arrays, non-objects, and malformed shapes', () => {
    expect(parseChipCommit({ canvas_fields: [], item_kinds: [] }, 'chat', USER_MSG)).toBeNull();
    expect(parseChipCommit(null, 'chat', USER_MSG)).toBeNull();
    expect(parseChipCommit('chip', 'chat', USER_MSG)).toBeNull();
    expect(parseChipCommit(['problem'], 'chat', USER_MSG)).toBeNull();
    expect(parseChipCommit({ canvas_fields: 'problem', item_kinds: [] }, 'chat', USER_MSG)).toBeNull();
    expect(parseChipCommit({ canvas_fields: ['problem'], item_kinds: [''] }, 'chat', USER_MSG)).toBeNull();
  });

  it('rejects node side-thread steps', () => {
    expect(parseChipCommit({ canvas_fields: ['problem'], item_kinds: [] }, 'node:abc123', USER_MSG)).toBeNull();
  });

  it('rejects when the last message is not a non-empty user message', () => {
    expect(parseChipCommit({ canvas_fields: ['problem'], item_kinds: [] }, 'chat', [])).toBeNull();
    expect(parseChipCommit({ canvas_fields: ['problem'], item_kinds: [] }, 'chat', [{ role: 'assistant', content: 'x' }])).toBeNull();
    expect(parseChipCommit({ canvas_fields: ['problem'], item_kinds: [] }, 'chat', [{ role: 'user', content: '   ' }])).toBeNull();
  });
});

describe('buildCommitFastPathContent — guard-regex safety + contract', () => {
  const chips: ChipCommit[] = [
    { canvas_fields: ['problem'], item_kinds: [] },
    { canvas_fields: [...CANVAS_COMMIT_FIELD_KEYS], item_kinds: [] },
    { canvas_fields: [], item_kinds: ['competitor', 'market_size'] },
    { canvas_fields: ['solution', 'value_proposition'], item_kinds: ['competitor'] },
  ];

  it('composed prose never matches the route commit-guard regexes (both locales, all combos)', () => {
    for (const locale of ['en', 'it'] as const) {
      for (const chip of chips) {
        for (const n of [nba(), nba({ top_gap: null, recommended_skill: null })]) {
          const full = buildCommitFastPathContent({ locale, chip, nba: n, skillAllowed: true });
          const prose = full.replace(/:::artifact[\s\S]*$/, '');
          expect(prose, `${locale} ${JSON.stringify(chip)}`).not.toMatch(GUARD_CANVAS);
          expect(prose, `${locale} ${JSON.stringify(chip)}`).not.toMatch(GUARD_PAID_1);
          expect(prose, `${locale} ${JSON.stringify(chip)}`).not.toMatch(GUARD_PAID_2);
        }
      }
    }
  });

  it('always ends with a non-empty option-set artifact (never-dead-end)', () => {
    const full = buildCommitFastPathContent({
      locale: 'en',
      chip: { canvas_fields: ['problem'], item_kinds: [] },
      nba: nba({ top_gap: null, recommended_skill: null }),
      skillAllowed: false,
    });
    const m = full.match(/:::artifact\{"type":"option-set","id":"opt_chip_\d+"\}\n([\s\S]+)\n:::$/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1]);
    expect(parsed.options.length).toBeGreaterThan(0);
    expect(parsed.options[parsed.options.length - 1].id).toBe('continue');
  });

  it('offers the recommended skill only when allowed, with kickoff verbatim; never idea-shaping', () => {
    const chip: ChipCommit = { canvas_fields: ['problem'], item_kinds: [] };
    const withSkill = buildCommitFastPathContent({ locale: 'en', chip, nba: nba(), skillAllowed: true });
    expect(withSkill).toContain('"skill_id":"startup-scoring"');
    expect(withSkill).toContain('Score my startup across the 10 dimensions.');
    const gated = buildCommitFastPathContent({ locale: 'en', chip, nba: nba(), skillAllowed: false });
    expect(gated).not.toContain('skill_id');
    const shaping = buildCommitFastPathContent({
      locale: 'en', chip,
      nba: nba({ recommended_skill: { id: 'idea-shaping', label: 'Shape', kickoff: 'k', stage_number: 1 } }),
      skillAllowed: true,
    });
    expect(shaping).not.toContain('idea-shaping');
  });

  it('renders localized field labels', () => {
    const en = buildCommitFastPathContent({
      locale: 'en',
      chip: { canvas_fields: ['target_market', 'unfair_advantage'], item_kinds: [] },
      nba: nba(), skillAllowed: false,
    });
    expect(en).toContain('Target market');
    expect(en).toContain('Unfair advantage');
    const it_ = buildCommitFastPathContent({
      locale: 'it',
      chip: { canvas_fields: ['problem'], item_kinds: [] },
      nba: nba(), skillAllowed: false,
    });
    expect(it_).toContain('il canvas ora include');
  });
});
