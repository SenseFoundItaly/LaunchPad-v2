import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards for the 6 confirmed findings from the 2026-08-08 loop-hygiene audit
 * (ephemeral wirings + first-session UX + loop history), verified by hand
 * before fixing since the workflow's adversarial verifier hit a session limit
 * mid-run. Pinning file:line-level regressions rather than behavior, matching
 * this repo's convention for UI-adjacent fixes with no component test harness.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('FinancialModelPanel: draft survives the tab-switch remount', () => {
  it('setField mirrors edits into a project-scoped draft query cache', () => {
    const src = read('src/components/financial/FinancialModelPanel.tsx');
    expect(src).toMatch(/qc\.setQueryData\(\['financial-draft', projectId\], next\)/);
  });
  it('the seed effect prefers the draft over the last-saved model', () => {
    const src = read('src/components/financial/FinancialModelPanel.tsx');
    expect(src).toMatch(/qc\.getQueryData<FinancialAssumptions>\(\['financial-draft', projectId\]\)/);
  });
  it('a successful save clears the draft (no stale draft outliving a save)', () => {
    const src = read('src/components/financial/FinancialModelPanel.tsx');
    expect(src).toMatch(/qc\.removeQueries\(\{ queryKey: \['financial-draft', projectId\], exact: true \}\)/);
  });
});

describe('notes route: the chat-card delivery is retried, not silently swallowed', () => {
  it('retries once and logs loudly (not console.warn) on a second failure', () => {
    const src = read('src/app/api/projects/[projectId]/notes/route.ts');
    expect(src.match(/INSERT INTO chat_messages/g)?.length).toBe(2);
    expect(src).toContain('console.error(\'[notes] chat card persist failed twice');
  });
});

describe('IdeaShapingQuickReplies: go-back needs prior history to make sense', () => {
  it('the go-back reply is gated on hasHistory', () => {
    const src = read('src/components/chat/IdeaShapingQuickReplies.tsx');
    expect(src).toMatch(/\.\.\.\(hasHistory \? \[\{ key: 'go-back'/);
  });
  it('chat/page.tsx passes the real message count', () => {
    const src = read('src/app/project/[projectId]/chat/page.tsx');
    expect(src).toMatch(/hasHistory=\{messages\.length > 0\}/);
  });
});

describe('Today StatusBar: the heartbeat does not claim a cadence with zero watchers', () => {
  it('heartbeatLabel/Kind branch on whether any watcher exists', () => {
    const src = read('src/app/project/[projectId]/today/page.tsx');
    expect(src).toMatch(/heartbeatLabel: hasWatchers \? t\('today\.watchers-cadence'\) : t\('today\.watchers-none'\)/);
    expect(src).toMatch(/heartbeatKind: hasWatchers \? 'healthy' : 'stale'/);
  });
});

describe('Inbox subhead: copy matches the default-landing (Watchers) tab', () => {
  it('InboxSubhead branches its copy on the active tab', () => {
    const src = read('src/app/project/[projectId]/actions/page.tsx');
    expect(src).toMatch(/function InboxSubhead\(\{ active \}: \{ active: DisplayTab \}\)/);
    expect(src).toContain("active === 'monitor' ? 'actions.subhead-title-monitor' : 'actions.subhead-title'");
  });
});

describe('LoopHistoryCard: reuses the shared loop-display formatters (no re-drift)', () => {
  it('imports loopNameKey/signalLabelKey/formatSignal instead of local duplicate maps', () => {
    const src = read('src/components/journey/LoopHistoryCard.tsx');
    expect(src).toContain("import { loopNameKey, signalLabelKey, formatSignal } from '@/lib/loops/loop-display';");
    expect(src).not.toContain('LOOP_LABEL_KEY');
    expect(src).not.toContain('SIGNAL_LABEL_KEY');
  });
  it('the threshold column direction respects months-is-a-maximum', () => {
    const src = read('src/components/journey/LoopHistoryCard.tsx');
    expect(src).toMatch(/thresholdOp = \(signal: string\) => \(signal\.includes\('months'\) \? '≤' : '≥'\)/);
  });
});
