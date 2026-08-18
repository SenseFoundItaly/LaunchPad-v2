import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';

/**
 * Migration numbers must be unique in the tree.
 *
 * "Take the next number from `db/migrations/`" has produced FIVE collisions —
 * 008, 009, 020, 040, and 037 (whose twin, `037_mvp_build_issues`, is applied
 * in prod but has never been in this tree, so the file listing could not warn
 * anyone). The runner keys on the FILENAME, so a duplicate number breaks
 * nothing at apply time — it breaks the human reading the directory and
 * choosing what to call the next one, which is how the collisions compound.
 *
 * The rule this enforces: the number comes from `_migrations` in the live DB,
 * never from the file tree. This test cannot see the DB, so it enforces the
 * observable half — no two files may share a prefix — which is enough to stop
 * the next one being added.
 *
 * The four existing pairs are grandfathered BY NAME. Renaming an applied
 * migration would orphan its ledger row, which is worse than the collision;
 * they are recorded here so the list can only shrink.
 */
const GRANDFATHERED = new Set([
  '008_interviews.sql', '008_unify_proposal_surface.sql',
  '009_allow_run_skill_action_type.sql', '009_drop_dead_tables.sql',
  '020_allow_validation_proposal_action_type.sql', '020_user_locale.sql',
  '040_gate_fact_provenance.sql', '040_interview_status.sql',
]);

describe('db/migrations numbering', () => {
  const files = readdirSync(join(process.cwd(), 'db/migrations')).filter((f) => f.endsWith('.sql')).sort();

  it('has migrations to check (guard against an empty read)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('every file starts with a 3-digit number', () => {
    for (const f of files) expect(f, f).toMatch(/^\d{3}_/);
  });

  it('no NEW duplicate numbers — pick the next one from _migrations, not this directory', () => {
    const byNumber = new Map<string, string[]>();
    for (const f of files) {
      const n = f.slice(0, 3);
      byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
    }
    const offenders = [...byNumber.entries()]
      .filter(([, group]) => group.length > 1)
      .flatMap(([, group]) => group)
      .filter((f) => !GRANDFATHERED.has(f));
    expect(offenders, `duplicate migration number(s): ${offenders.join(', ')}`).toEqual([]);
  });

  it('the grandfathered list only shrinks — a removed collision must be removed here too', () => {
    const present = files.filter((f) => GRANDFATHERED.has(f));
    expect(present.length, 'GRANDFATHERED names a file that no longer exists').toBe(GRANDFATHERED.size);
  });
});
