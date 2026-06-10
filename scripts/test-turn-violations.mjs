#!/usr/bin/env node
/**
 * Unit tests for iteration-3 spine fix (WS-A) — analyzeTurnViolations +
 * renderNudgeForNextTurn + findMatchingSkill. Run via:
 *
 *   node --experimental-strip-types scripts/test-turn-violations.mjs
 *   (or)
 *   npx tsx scripts/test-turn-violations.mjs
 *
 * Pure-function tests — no DB, no dev server, no LLM. Fast. Deterministic.
 * 6 cases for analyzeTurnViolations, 1 for renderNudgeForNextTurn, 4 for
 * findMatchingSkill. Exit 0 on PASS, 1 on any failure.
 *
 * Run during the iter-3 verification pass (2026-06-08). Lands as a script
 * so future iterations can re-run before touching turn-violations.ts.
 *
 * Source of truth: src/lib/llm/turn-violations.ts +
 *                  src/lib/llm/content-mapping.ts
 */

import { analyzeTurnViolations, renderNudgeForNextTurn } from '../src/lib/llm/turn-violations.ts';
import { findMatchingSkill } from '../src/lib/llm/content-mapping.ts';

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        got      ${JSON.stringify(actual)}`);
    failed += 1;
  }
}

console.log('--- analyzeTurnViolations ---');

check(
  'clean turn (skill proposed cleanly, no outcome prose)',
  analyzeTurnViolations(
    [{ name: 'get_project_summary' }, { name: 'skill_market_research' }],
    'Skill queued for approval — 8 credits.',
    'what is my TAM?',
  ),
  { skill_first_violation: false, prose_fabrication: false },
);

check(
  'skill_first violation (web before skill on mapped topic)',
  analyzeTurnViolations(
    [{ name: 'web_search' }, { name: 'skill_market_research' }],
    'Queued the market research skill for your approval.',
    'what is my TAM?',
  ),
  { skill_first_violation: true, prose_fabrication: false },
);

check(
  'prose_fabrication (skill called + outcome-claim in prose)',
  analyzeTurnViolations(
    [{ name: 'skill_market_research' }],
    'The research shows TAM is approximately $24B with three key segments.',
    'what is my TAM?',
  ),
  { skill_first_violation: false, prose_fabrication: true },
);

check(
  'both violations co-fire',
  analyzeTurnViolations(
    [{ name: 'web_search' }, { name: 'skill_market_research' }],
    'The research shows TAM is approximately $24B.',
    'what is my TAM?',
  ),
  { skill_first_violation: true, prose_fabrication: true },
);

check(
  'no content-mapping match → web_search is legitimate',
  analyzeTurnViolations(
    [{ name: 'web_search' }, { name: 'skill_idea_shaping' }],
    'Queued for approval.',
    'tell me a fun fact about banana farming',
  ),
  { skill_first_violation: false, prose_fabrication: false },
);

check(
  'skill_* called but prose stays in queue-language → no fabrication',
  analyzeTurnViolations(
    [{ name: 'skill_market_research' }],
    'Market research skill is queued — 8 credits. Approve to start.',
    'what is my TAM?',
  ),
  { skill_first_violation: false, prose_fabrication: false },
);

console.log('--- renderNudgeForNextTurn ---');

const both = renderNudgeForNextTurn({ skill_first_violation: true, prose_fabrication: true });
check(
  'both violations → prose-fabrication nudge appears first (severity ordering)',
  both.indexOf('claimed skill outcomes') < both.indexOf('web_searched before'),
  true,
);
check(
  'no violations → empty string',
  renderNudgeForNextTurn({ skill_first_violation: false, prose_fabrication: false }),
  '',
);

console.log('--- findMatchingSkill ---');
check('TAM → market-research', findMatchingSkill('what is my TAM?')?.skill_id ?? null, 'market-research');
check('burn rate → financial-model', findMatchingSkill('running low on cash, what is my burn rate?')?.skill_id ?? null, 'financial-model');
check('banana farming → null', findMatchingSkill('tell me about banana farming')?.skill_id ?? null, null);
check('seed round → investment-readiness', findMatchingSkill('how do I raise a seed round?')?.skill_id ?? null, 'investment-readiness');

console.log('');
if (failed === 0) {
  console.log('ALL TESTS PASS');
  process.exit(0);
} else {
  console.log(`FAIL — ${failed} test(s) failed`);
  process.exit(1);
}
