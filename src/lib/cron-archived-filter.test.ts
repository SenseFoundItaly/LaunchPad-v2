import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Archived projects must not consume scheduled watcher work (2026-08-08).
 *
 * Archiving is the reversible cleanup path (52 synthetic projects hold cost
 * history behind ON DELETE CASCADE, so they are archived, never deleted). The
 * pulse queries always filtered `p.status != 'archived'`, but BOTH watcher due
 * queries did not — 10 monitors + 8 watch_sources on archived projects kept
 * scraping (~$3/mo measured on prod). Pin the filter on both.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('cron due queries exclude archived projects', () => {
  it('the due-monitors query joins projects and filters archived', () => {
    const cron = read('src/app/api/cron/route.ts');
    expect(cron).toMatch(
      /SELECT m\.id FROM monitors m\s*\n\s*JOIN projects p ON p\.id = m\.project_id AND p\.status != 'archived'/,
    );
  });

  it('the due watch_sources query joins projects and filters archived', () => {
    const proc = read('src/lib/watch-source-processor.ts');
    expect(proc).toMatch(
      /SELECT ws\.\* FROM watch_sources ws\s*\n\s*JOIN projects p ON p\.id = ws\.project_id AND p\.status != 'archived'/,
    );
  });
});
