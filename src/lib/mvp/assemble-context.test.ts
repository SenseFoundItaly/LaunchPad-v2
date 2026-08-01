import { describe, it, expect } from 'vitest';
import { renderBuildBrief, type MvpContext } from './assemble-context';

/** Minimal MvpContext fixture — only the fields renderBuildBrief reads matter. */
function ctx(over: Partial<MvpContext> = {}): MvpContext {
  return {
    projectId: 'p',
    ownerUserId: null,
    project: { name: 'HabitStreak', description: 'A habit tracker web app.' },
    snapshot: { idea_canvas: null, interviews: [] } as unknown as MvpContext['snapshot'],
    personas: [],
    openAssumptions: [],
    score: null,
    briefs: [],
    researchProse: '',
    priorSpec: null,
    currentIteration: 0,
    pendingFeedback: [],
    isDelta: false,
    activeStageNumber: 5,
    ...over,
  };
}

describe('renderBuildBrief', () => {
  it('is an imperative build instruction, not a [PROJECT INTELLIGENCE] dump', () => {
    const b = renderBuildBrief(ctx());
    expect(b.startsWith('Build a modern, responsive web app called "HabitStreak".')).toBe(true);
    expect(b).not.toContain('[PROJECT INTELLIGENCE');
    expect(b.toLowerCase()).toContain('working first version');
  });

  it('falls back to project.description when there is no idea canvas', () => {
    expect(renderBuildBrief(ctx())).toContain('A habit tracker web app.');
  });

  it('uses idea-canvas solution/problem/target + interview pains when present', () => {
    const snapshot = {
      idea_canvas: {
        solution: 'track daily habits with streaks',
        problem: 'people forget their habits',
        value_proposition: null,
        target_market: 'university students',
        business_model: null,
        channels: null,
      },
      interviews: [{ top_pain: 'no reminders', wtp_amount: null, urgency: null }],
    } as unknown as MvpContext['snapshot'];
    const b = renderBuildBrief(ctx({ snapshot }));
    expect(b).toContain('track daily habits with streaks — solving: people forget their habits');
    expect(b).toContain('Target users: university students.');
    expect(b).toContain('no reminders');
  });

  it('falls back to personas for target users when idea canvas has no target market', () => {
    const b = renderBuildBrief(ctx({ personas: ['Busy professionals', 'Students'] }));
    expect(b).toContain('Target users: Busy professionals, Students.');
  });

  // #269 — the journey stage decides WHAT the brief asks for.
  it('pre-stage-5 renders a waitlist smoke test, not the product', () => {
    const b = renderBuildBrief(ctx({ activeStageNumber: 2 }));
    expect(b).toContain('VALIDATION smoke test');
    expect(b).toContain('waitlist signup form');
    expect(b).not.toContain('working first version');
  });

  it('stage 5 renders the working-MVP brief without launch extras', () => {
    const b = renderBuildBrief(ctx({ activeStageNumber: 5 }));
    expect(b.toLowerCase()).toContain('working first version');
    expect(b).not.toContain('email-capture');
  });

  it('stage 6+ appends launch hardening (email capture + event hooks)', () => {
    const b = renderBuildBrief(ctx({ activeStageNumber: 6 }));
    expect(b.toLowerCase()).toContain('working first version');
    expect(b).toContain('email-capture');
  });

  it('unknown stage fails open to the full-MVP brief', () => {
    const b = renderBuildBrief(ctx({ activeStageNumber: null }));
    expect(b.toLowerCase()).toContain('working first version');
    expect(b).not.toContain('email-capture');
  });
});
