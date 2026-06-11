#!/usr/bin/env node
/**
 * Backfill: heal pre-entity-wave competitor_profiles whose `name` is a full
 * alert HEADLINE ("Mama's Creations (Nasdaq: MAMA) expands to 10,000+
 * stores…") instead of the subject entity ("Mama's Creations").
 *
 * Why these rows exist: before the entity pipeline (migration 017 +
 * persistEcosystemAlerts passing the artifact's `entity` field), the
 * competitor-profile upsert was keyed on the raw alert headline — so every
 * news event minted a new "competitor" and the dossier list read like a news
 * ticker (StandSync: 18 rows with duplicates).
 *
 * What it does, for ALL projects:
 *   1. RENAME: where entityNameFromHeadline(name) returns non-null AND
 *      differs from the current name, re-derive name (+ slug).
 *      Also SLUG-FIX: rows whose slug drifted from slugify(name) (seen on a
 *      hand-healed NonnaBox row) get slug realigned — updateCompetitorProfile
 *      upserts BY SLUG, so a drifted slug mints duplicates on the next signal.
 *   2. MERGE: group rows by (project_id, slugify(final name)) and collapse
 *      each group to one row — keep the row with the newest
 *      last_activity_at (fallback created_at), sum total_signals, merge
 *      signal_counts key-wise, keep the newest last_activity_at, adopt a
 *      latest_brief_id if the keeper has none. Delete the rest.
 *
 *      NOTE on the merge key: the task spec says merge by
 *      (project_id, LOWER(name)), but competitor_profiles carries
 *      UNIQUE(project_id, slug) and slug is a pure function of
 *      LOWER(name) — equal LOWER(name) always implies equal slug, so
 *      grouping by slug subsumes the LOWER(name) grouping AND is the only
 *      grouping that cannot violate the unique constraint when the renamed
 *      slugs are written back. Distinct legit names with distinct slugs
 *      ("HelloFresh" vs "HelloFresh / Marley Spoon" → "hellofresh" vs
 *      "hellofresh-marley-spoon") are never merged.
 *
 * Usage:
 *   node scripts/backfill-entity-names.mjs              # dry-run (default)
 *   node scripts/backfill-entity-names.mjs --apply      # execute
 *
 * Loads .env.local itself (DATABASE_URL), like sibling sim scripts — no
 * --env-file flag needed.
 */

import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const STANDSYNC = 'proj_99dc8aaf-672'; // called out in the run report

// ---------------------------------------------------------------------------
// .env.local loader — resolve next to the repo root (parent of scripts/), so
// the script works from any cwd; falls back to process.cwd().
// ---------------------------------------------------------------------------
function loadDotEnvLocal() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.join(here, '..', '.env.local'), path.join(process.cwd(), '.env.local')]) {
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
    return;
  }
}
loadDotEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set (expected in .env.local).');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });

// ---------------------------------------------------------------------------
// DUPLICATED from src/lib/ecosystem-alert-parser.ts (entityNameFromHeadline +
// HEADLINE_EVENT_VERB) and src/lib/competitor-profiles.ts (slugify) — scripts
// are plain .mjs and can't import TS. Keep all three in sync with the TS
// sources.
// ---------------------------------------------------------------------------
const HEADLINE_EVENT_VERB =
  /\s+(launches|launched|launching|expands|expanded|announces|announced|ships|shipped|raises|raised|partners|partnered|acquires|acquired|introduces|introduced|debuts|debuted|unveils|unveiled|adds|added|opens|opened|rolls out|rolled out|releases|released|brings|brought|kills|killed|drops|dropped|reaches|reached|hits|hit|closes|closed|files|filed|wins|won|signs|signed|enters|entered|targets|targeting|joins|joined|selected|prepares|prepared|appoints|appointed|recruits|recruited|secures|secured|lands|landed|begins|began|starts|started|plans|planned|tests|testing|pilots|piloting|is |are |to )\b/i;

function entityNameFromHeadline(headline) {
  let name = headline.split(HEADLINE_EVENT_VERB)[0] ?? '';
  name = name
    .replace(/\s*\([^)]*\)\s*$/g, '')   // trailing "(Nasdaq: MAMA)" / "(June 2024)"
    .replace(/^["'‘’“”]+|["'‘’“”]+$/g, '')
    .replace(/[\s,:;—–-]+$/g, '')
    .trim();
  if (name.length < 2 || name.length > 80) return null;
  if (name.length > headline.trim().length * 0.8 && /\s/.test(name) && name.length > 40) return null;
  return name;
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

// ---------------------------------------------------------------------------

function asCounts(value) {
  if (value == null) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return value;
}

function recencyKey(row) {
  // Keeper choice: newest last_activity_at, fallback created_at; id as a
  // deterministic final tie-break.
  const t = row.last_activity_at ?? row.created_at;
  return t ? new Date(t).getTime() : 0;
}

async function main() {
  console.log(`backfill-entity-names — mode: ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to execute)'}\n`);

  const rows = await sql`
    SELECT id, project_id, name, slug, signal_counts, total_signals,
           latest_brief_id, last_activity_at, created_at
      FROM competitor_profiles
     ORDER BY project_id, created_at`;

  const projectNames = new Map(
    (await sql`SELECT id, name FROM projects`).map(p => [p.id, p.name]),
  );

  // ---- plan ---------------------------------------------------------------
  const byProject = new Map();
  for (const row of rows) {
    if (!byProject.has(row.project_id)) byProject.set(row.project_id, []);
    byProject.get(row.project_id).push(row);
  }

  const updates = [];   // { id, name, slug, signal_counts?, total_signals?, last_activity_at?, latest_brief_id? }
  const deletes = [];   // { id, project_id, name }
  let renameCount = 0;
  const beforeCounts = new Map();
  const afterCounts = new Map();

  for (const [projectId, profiles] of byProject) {
    beforeCounts.set(projectId, profiles.length);

    // 1. final name per row (re-derive only when the heuristic yields a
    //    DIFFERENT non-null name — clean names pass through untouched).
    const planned = profiles.map(row => {
      const derived = entityNameFromHeadline(row.name);
      const renamed = derived !== null && derived !== row.name;
      return { row, finalName: renamed ? derived : row.name, renamed };
    });

    // 2. group by final slug (see header note: subsumes LOWER(name) and is
    //    what the UNIQUE(project_id, slug) constraint actually requires).
    const groups = new Map();
    for (const p of planned) {
      const key = slugify(p.finalName);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    const projUpdates = [];
    const projDeletes = [];

    for (const [finalSlug, members] of groups) {
      if (!finalSlug) continue; // unsluggable names (shouldn't exist) — leave untouched

      if (members.length === 1) {
        const { row, finalName, renamed } = members[0];
        // Update on rename, AND on slug drift (slug != slugify(name), seen on
        // a NonnaBox row healed by hand: name="HelloFresh", slug still the old
        // headline). Drifted slugs break the upsert keying in
        // updateCompetitorProfile (keys by slug → next signal for the same
        // entity would mint a duplicate row).
        if (renamed || row.slug !== finalSlug) {
          projUpdates.push({ id: row.id, project_id: projectId, oldName: row.name, name: finalName, slug: finalSlug });
        }
        continue;
      }

      // merge group: keeper = newest by last_activity_at/created_at
      const sorted = [...members].sort((a, b) =>
        recencyKey(b.row) - recencyKey(a.row)
        || new Date(b.row.created_at ?? 0).getTime() - new Date(a.row.created_at ?? 0).getTime()
        || (a.row.id < b.row.id ? -1 : 1));
      const keeper = sorted[0];
      const doomed = sorted.slice(1);

      const mergedCounts = {};
      let mergedTotal = 0;
      let maxActivity = null;
      for (const m of members) {
        const counts = asCounts(m.row.signal_counts);
        for (const [k, v] of Object.entries(counts)) {
          mergedCounts[k] = (mergedCounts[k] || 0) + (Number(v) || 0);
        }
        mergedTotal += Number(m.row.total_signals) || 0;
        const act = m.row.last_activity_at ? new Date(m.row.last_activity_at) : null;
        if (act && (!maxActivity || act > maxActivity)) maxActivity = act;
      }
      // Adopt a brief link if the keeper has none (links from deleted dupes
      // would otherwise be silently lost).
      const adoptedBrief = keeper.row.latest_brief_id
        ?? doomed.map(d => d.row.latest_brief_id).find(Boolean)
        ?? null;

      projUpdates.push({
        id: keeper.row.id,
        project_id: projectId,
        oldName: keeper.row.name,
        name: keeper.finalName,
        slug: finalSlug,
        signal_counts: mergedCounts,
        total_signals: mergedTotal,
        last_activity_at: maxActivity ? maxActivity.toISOString() : keeper.row.last_activity_at,
        latest_brief_id: adoptedBrief,
        mergedFrom: doomed.map(d => d.row.name),
      });
      for (const d of doomed) {
        projDeletes.push({ id: d.row.id, project_id: projectId, name: d.row.name });
      }
    }

    // Post-apply slug uniqueness is structural: every surviving row's slug
    // equals its group key (groups are disjoint by key), so no collision
    // check is needed beyond the temp-slug parking in the apply phase.
    updates.push(...projUpdates);
    deletes.push(...projDeletes);
    renameCount += projUpdates.filter(u => u.name !== u.oldName).length;
    afterCounts.set(projectId, profiles.length - projDeletes.length);

    if (projUpdates.length > 0 || projDeletes.length > 0) {
      const pname = projectNames.get(projectId) ?? '?';
      console.log(`── ${projectId} (${pname}) — ${profiles.length} → ${profiles.length - projDeletes.length} profiles`);
      for (const u of projUpdates) {
        if (u.mergedFrom?.length) {
          console.log(`   MERGE  keep "${u.oldName}" → "${u.name}" (slug ${u.slug}, total_signals=${u.total_signals})`);
          for (const m of u.mergedFrom) console.log(`          absorb+delete "${m}"`);
        } else if (u.name !== u.oldName) {
          console.log(`   RENAME "${u.oldName}" → "${u.name}"`);
        } else {
          console.log(`   SLUG-FIX "${u.name}" → slug ${u.slug} (was drifted)`);
        }
      }
      console.log('');
    }
  }

  for (const [pid, n] of beforeCounts) {
    if (!afterCounts.has(pid)) afterCounts.set(pid, n);
  }

  // ---- summary ------------------------------------------------------------
  const totalBefore = rows.length;
  const totalAfter = totalBefore - deletes.length;
  console.log('── summary ──────────────────────────────────────────────');
  console.log(`profiles total:        ${totalBefore} → ${totalAfter} (${deletes.length} merged away)`);
  console.log(`rows renamed:          ${renameCount}`);
  console.log(`rows updated (all):    ${updates.length}`);
  console.log(`projects touched:      ${[...new Set(updates.map(u => u.project_id))].length}`);
  const ssBefore = beforeCounts.get(STANDSYNC) ?? 0;
  const ssAfter = afterCounts.get(STANDSYNC) ?? ssBefore;
  console.log(`StandSync ${STANDSYNC}: ${ssBefore} → ${ssAfter}`);

  if (!APPLY) {
    console.log('\nDry-run only — nothing written. Re-run with --apply to execute.');
    await sql.end({ timeout: 5 });
    return;
  }

  // ---- apply --------------------------------------------------------------
  // Single transaction. Order matters for UNIQUE(project_id, slug):
  //   (1) delete doomed rows (frees their slugs),
  //   (2) park every to-be-renamed row on a temp slug keyed by its id
  //       (ids are unique → no transient collisions),
  //   (3) write final names/slugs/merged stats.
  await sql.begin(async (tx) => {
    for (const d of deletes) {
      await tx`DELETE FROM competitor_profiles WHERE id = ${d.id}`;
    }
    const slugChanges = updates.filter(u => u.slug);
    for (const u of slugChanges) {
      await tx`UPDATE competitor_profiles SET slug = ${'tmpbf-' + u.id} WHERE id = ${u.id}`;
    }
    for (const u of updates) {
      if (u.signal_counts) {
        await tx`
          UPDATE competitor_profiles
             SET name = ${u.name}, slug = ${u.slug},
                 signal_counts = ${tx.json(u.signal_counts)},
                 total_signals = ${u.total_signals},
                 last_activity_at = ${u.last_activity_at},
                 latest_brief_id = ${u.latest_brief_id},
                 updated_at = ${new Date().toISOString()}
           WHERE id = ${u.id}`;
      } else {
        await tx`
          UPDATE competitor_profiles
             SET name = ${u.name}, slug = ${u.slug},
                 updated_at = ${new Date().toISOString()}
           WHERE id = ${u.id}`;
      }
    }
  });

  const verify = await sql`SELECT COUNT(*)::int AS n FROM competitor_profiles`;
  const verifySS = await sql`SELECT COUNT(*)::int AS n FROM competitor_profiles WHERE project_id = ${STANDSYNC}`;
  console.log(`\nAPPLIED. competitor_profiles now: ${verify[0].n} total, StandSync: ${verifySS[0].n}.`);
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
