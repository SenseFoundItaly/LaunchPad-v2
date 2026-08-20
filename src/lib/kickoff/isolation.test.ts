import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The North Star store may be written by the agent with NO approval card. That
 * is only safe while it is a DRAFT DOCUMENT rather than evidence — i.e. while
 * no gate check can read it.
 *
 * The product's headline invariant, stated to the agent in chat/route.ts:
 *
 *   "any evidence YOU produce that would satisfy a validation substep MUST be
 *    staged for approval — you can NEVER write it silently"
 *
 * These tests are that invariant, mechanised. If one fails, `north_star` has
 * quietly become evidence and the guarantee is gone.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf-8');

/**
 * Source with COMMENTS STRIPPED.
 *
 * These files explain the boundary in prose — store.ts says "promotion goes to
 * idea_canvas", page.tsx says "no Canvas, no spine". A raw substring check
 * flags its own documentation, which is how the first version of this test
 * failed. Assert against code, never against comments.
 */
const codeOf = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(rel);
  }
  return out;
}

describe('north_star is a draft document, never evidence', () => {
  it('no journey/gate file references the table or its store', () => {
    // The journey module is the evidence engine. If it learns about
    // north_star, an ungated write becomes a gated check's input.
    const offenders = walk('src/lib/journey')
      .filter((f) => /north_star|north-star|kickoff\/store/.test(codeOf(f)));
    expect(offenders).toEqual([]);
  });

  it('the project snapshot does not select it', () => {
    // buildProjectSnapshot is what every check evaluates against.
    expect(codeOf('src/lib/journey/snapshot.ts')).not.toMatch(/north_star/);
  });

  it('no gate fact family, item kind or source map mentions it', () => {
    for (const f of ['src/lib/gate-fact-families.ts', 'src/lib/gate-fact-kinds.ts', 'src/lib/journey/validation-targets.ts']) {
      expect(codeOf(f), f).not.toMatch(/north_star|north-star/);
    }
  });

  it('the write tool never calls an evidence writer', () => {
    const store = codeOf('src/lib/kickoff/store.ts');
    for (const forbidden of ['recordFact', 'stageValidationProposal', 'createPendingAction', 'idea_canvas']) {
      expect(store, forbidden).not.toContain(forbidden);
    }
  });

  it('write_north_star is NOT in the main co-pilot tool set', () => {
    // It is passed explicitly to the lite route. Registering it in
    // makeProjectTools would hand the main agent an ungated write.
    expect(codeOf('src/lib/project-tools.ts')).not.toMatch(/write_north_star|makeNorthStarTool/);
  });
});

describe('the lite surface is isolated from the main app', () => {
  const liteFiles = [...walk('src/app/lite'), ...walk('src/app/api/lite'), ...walk('src/lib/kickoff')];

  it('has files to check (guard against an empty walk)', () => {
    expect(liteFiles.length).toBeGreaterThan(4);
  });

  it('lite imports nothing from the project surface', () => {
    for (const f of liteFiles) {
      expect(codeOf(f), f).not.toMatch(/from '@\/components\/canvas|from '@\/components\/journey|app\/project\//);
    }
  });

  it('nothing in the main app imports the lite surface', () => {
    const main = [...walk('src/components'), ...walk('src/app/project'), ...walk('src/app/api/projects')];
    const offenders = main.filter((f) => /@\/lib\/kickoff|app\/lite|api\/lite/.test(codeOf(f)));
    expect(offenders).toEqual([]);
  });

  it('the lite kickoff does not reuse the 88k main chat prompt', () => {
    const route = codeOf('src/app/api/lite/[projectId]/kickoff/route.ts');
    expect(route).not.toMatch(/ARTIFACT_INSTRUCTIONS|JOURNEY_RULES|buildMemoryContext|formatStageContextForPrompt/);
  });

  it('but it IS behind the same authorisation as everything else', () => {
    // Isolation is about coupling, never about auth. A workspace id must not
    // be enough to read someone's plan — the exact hole the teardown found in
    // the product this flow is modelled on.
    for (const f of walk('src/app/api/lite')) {
      expect(read(f), f).toContain('tryProjectAccess');
    }
  });
});
