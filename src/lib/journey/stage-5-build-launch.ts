/**
 * Stage 5 — Build & Launch.
 * Build → ship → first users. Workflow is active, scope is defined, tasks
 * are moving, something is published, early users are in.
 *
 * Re-bucketing note (2026-06 taxonomy unification): all of legacy "MVP"'s
 * checks, unchanged ids and evaluator logic. (The 'spark'/'idea' strings in
 * scope_defined are persisted workflow.current_step values, not stage ids.)
 */

import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';
import { countMemoryFactsMatching } from './snapshot';

export const stageBuildLaunch: Stage = {
  ...CANONICAL_BY_ID.build_launch,
  tagline: 'Build, ship, first users.',
  checks: [
    {
      id: 'workflow_active',
      label: 'Workflow active',
      source: 'workflow.status',
      evaluate: (s) => {
        const ok = s.workflow?.status === 'active';
        return ok
          ? { passed: true, evidence: `Workflow stage: ${s.workflow?.current_step ?? '?'}` }
          : { passed: false, gap: 'Start a workflow with Co-pilot' };
      },
    },
    {
      id: 'scope_defined',
      label: 'MVP scope defined',
      source: 'workflow.current_step',
      evaluate: (s) => {
        const step = s.workflow?.current_step ?? '';
        const ok = step.length > 0 && !['unknown', 'spark', 'idea'].includes(step.toLowerCase());
        return ok
          ? { passed: true, evidence: `Stage: ${step}` }
          : { passed: false, gap: 'Define MVP scope and advance workflow' };
      },
    },
    {
      id: 'something_shipped',
      label: 'Something shipped',
      source: 'published_assets',
      evaluate: (s) => {
        const n = s.counts.published_assets;
        const ok = n > 0;
        return ok
          ? { passed: true, evidence: `${n} published asset${n === 1 ? '' : 's'}` }
          : { passed: false, gap: 'Ship the smallest publishable thing' };
      },
    },
    {
      id: 'early_users',
      label: 'Early users in',
      source: 'memory_facts (users)',
      evaluate: (s) => {
        const n = countMemoryFactsMatching(s, ['signup', 'first user', 'beta user', 'onboarded', 'trial']);
        const ok = n >= 3;
        return ok
          ? { passed: true, evidence: `${n} user-evidence fact${n === 1 ? '' : 's'}` }
          : { passed: false, gap: `${n} of 3 — log first signups in chat` };
      },
    },
  ],
};
