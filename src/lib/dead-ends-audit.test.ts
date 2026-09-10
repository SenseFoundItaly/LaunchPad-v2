import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { INTEL_INBOX_TYPES } from './action-lanes';
import { PROPOSER_OUTPUT_CHECK_IDS } from './journey/stage-2-market-validation';
import { en } from './i18n/messages/en';
import { it as itMessages } from './i18n/messages/it';

/**
 * Dead-end audit, 2026-09-10 — the class behind changelog 05/09 item 11.
 *
 * A dead end is a place where the product tells the founder to do something
 * and provides nowhere to do it: a gap that names a run nothing can run, a
 * proposal type nothing can show, an error the server explains and the client
 * discards. Each pin below is a specific one found on prod, written so the
 * shape cannot come back — not just the instance.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('every error the skills route explains reaches the founder', () => {
  it('the client handles every 4xx code the server emits', () => {
    // Measured: loop1_gate_open / loop2_gate_open were sent with a localized
    // sentence, the client list did not know them, and the fall-through
    // re-read a consumed body — the founder saw "HTTP 422".
    const route = read('src/app/api/projects/[projectId]/skills/route.ts');
    const page = read('src/app/project/[projectId]/chat/page.tsx');
    const emitted = [...new Set(route.match(/error: '([a-z0-9_]+)'/g)!.map((m) => m.slice(8, -1)))];
    const handledBlock = page.slice(page.indexOf('const BLOCKED_BEFORE_SPEND'), page.indexOf('const BLOCKED_BEFORE_SPEND') + 400);
    for (const code of emitted) {
      if (code === 'out_of_credits') continue; // handled by the recharge modal, not a message
      expect(handledBlock, `client does not render server code "${code}"`).toContain(`'${code}'`);
    }
  });
});

describe('assumption proposals have a surface again', () => {
  it('the Inbox shows both assumption types', () => {
    // 179 assumption_review rows open across 10 projects, 8 ever applied — all
    // before the 2026-06-29 narrowing. /assumptions redirects to /actions
    // saying that is where they live; /actions filtered them out.
    expect(INTEL_INBOX_TYPES.has('assumption_review')).toBe(true);
    // 7 rows, 0 applied, and NO surface at all before this.
    expect(INTEL_INBOX_TYPES.has('propose_assumption_revision')).toBe(true);
  });

  it('but not the graph mirror — its node is approvable on the Knowledge page', () => {
    expect(INTEL_INBOX_TYPES.has('proposed_graph_update')).toBe(false);
  });

  it('the /assumptions redirect still points somewhere that shows them', () => {
    expect(read('src/app/project/[projectId]/assumptions/page.tsx')).toMatch(/redirect\(`\/project\/\$\{projectId\}\/actions`\)/);
  });
});

describe('no proposer waits for another proposer', () => {
  it('both "work done?" predicates exclude BOTH proposer-closed checks', () => {
    // With each excluding only itself, the watcher proposer waited for the
    // score and the auto-scorer waited for the watcher. 0 of 124 prod projects
    // were inside the cycle; the shape is what is pinned.
    const src = read('src/lib/journey/stage-2-market-validation.ts');
    expect([...PROPOSER_OUTPUT_CHECK_IDS].sort()).toEqual(['monitors_set', 'startup_score_1b']);
    const uses = src.match(/PROPOSER_OUTPUT_CHECK_IDS\.has\(c\.id\)/g) ?? [];
    expect(uses.length, 'both predicates must filter through the shared set').toBe(2);
    expect(src).not.toMatch(/\.filter\(\(c\) => c\.id !== 'startup_score_1b'\)/);
    expect(src).not.toMatch(/\.filter\(\(c\) => c\.id !== WATCHER_EXCLUDED_CHECK_ID\)/);
  });
});

describe('a URL watcher can be removed', () => {
  it('the panel calls the DELETE route that had no caller', () => {
    const panel = read('src/components/monitors/MonitorListPanel.tsx');
    expect(panel).toMatch(/watch-sources\/\$\{w\._origin_id\}`, \{\s*method: 'DELETE'/);
    // Two-click confirm — same idiom as archiving a monitor.
    expect(panel).toMatch(/confirmRemove \? t\('monitors\.remove-source-confirm'\)/);
  });
});

describe('copy that names a surface names a real one', () => {
  it('the WTP gap no longer tells the founder to "run" something that cannot run', () => {
    // van Westendorp is a value in update_pricing's wtp blob, not a skill.
    expect(en['journey-gap.wtp_researched']).not.toMatch(/^Run /);
    expect(itMessages['journey-gap.wtp_researched']).not.toMatch(/^Esegui /);
  });

  it('the prerequisite hint names the Inbox tab by its actual label, in both languages', () => {
    expect(en['skills.prereq-pending']).toContain(`Watchers → ${en['actions.tab-inbox']}`);
    expect(itMessages['skills.prereq-pending']).toContain(`→ ${itMessages['actions.tab-inbox']}`);
  });

  it('the 1B score row explains its own lock, not the 1C one', () => {
    // It opens as soon as there is technical work to score — "until 1A + 1B
    // are complete" was the wrong sentence on that row.
    expect(read('src/components/canvas/SpineSection.tsx'))
      .toMatch(/r\.check\.id === 'startup_score_1b' \? t\('canvas\.score-locked'\)/);
    expect(en['canvas.score-locked']).toBeTruthy();
    expect(itMessages['canvas.score-locked']).toBeTruthy();
  });
});
