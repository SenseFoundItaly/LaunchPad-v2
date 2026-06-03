/**
 * One-shot backfill: re-runs the artifact pipeline over already-stored
 * chat_messages so historical sessions that were rejected by the strict
 * source-validation gate now persist into pending_actions, graph_nodes,
 * memory_facts, and research. Idempotent — persistArtifact dedupes by
 * (project_id, name) on graph_nodes and (project_id) on research.
 *
 * Usage:
 *   npx tsx scripts/backfill-chat-artifacts.mts <project_id>
 *   npx tsx scripts/backfill-chat-artifacts.mts --all
 */
import fs from 'node:fs';
import path from 'node:path';
// Inline .env.local loader (mirrors db/migrate.ts) — must run BEFORE @/lib/db.
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* non-fatal */ }

import { query } from '../src/lib/db';
import { parseMessageContent } from '../src/lib/artifact-parser';
import { persistArtifact } from '../src/lib/artifact-persistence';
import { captureWorkflow } from '../src/lib/workflow-capture';
import { recordFact } from '../src/lib/memory/facts';
import type { FactArtifact, WorkflowCard } from '../src/types/artifacts';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npx tsx scripts/backfill-chat-artifacts.mts <project_id> | --all');
  process.exit(1);
}

const projectFilter = arg === '--all' ? null : arg;

interface Row {
  id: string;
  project_id: string;
  user_id: string;
  content: string;
}

const sql = projectFilter
  ? 'SELECT id, project_id, user_id, content FROM chat_messages WHERE role = ? AND project_id = ? ORDER BY "timestamp" ASC'
  : 'SELECT id, project_id, user_id, content FROM chat_messages WHERE role = ? ORDER BY "timestamp" ASC';

const args = projectFilter ? ['assistant', projectFilter] : ['assistant'];
const rows = await query<Row>(sql, ...args);

console.log(`Backfilling ${rows.length} assistant messages${projectFilter ? ` for ${projectFilter}` : ' across all projects'}…\n`);

let stats = { messages: 0, persisted: 0, skipped: 0, errored: 0 };
for (const m of rows) {
  if (!m.user_id) { stats.skipped++; continue; }
  const segments = parseMessageContent(m.content);
  let perMsg = 0;
  for (const seg of segments) {
    if (seg.type !== 'artifact') continue;
    const a = seg.artifact;
    try {
      if (a.type === 'fact') {
        const f = a as FactArtifact;
        if (f.fact) {
          await recordFact({
            userId: m.user_id,
            projectId: m.project_id,
            fact: f.fact,
            kind: f.kind ?? 'fact',
            sourceType: 'chat',
            confidence: f.confidence ?? 0.8,
          });
          perMsg++;
        }
      } else if (a.type === 'workflow-card') {
        await captureWorkflow({
          userId: m.user_id,
          projectId: m.project_id,
          artifact: a as WorkflowCard,
          chatTurnPreview: '(backfill)',
        });
        perMsg++;
      } else {
        const r = await persistArtifact({ userId: m.user_id, projectId: m.project_id }, a);
        if (r.persisted) perMsg++;
      }
    } catch (err) {
      console.warn(`  ${m.id} ${a.type}: ${(err as Error).message}`);
      stats.errored++;
    }
  }
  stats.messages++;
  stats.persisted += perMsg;
  if (perMsg > 0) console.log(`  ${m.id} (project=${m.project_id}): +${perMsg} artifacts`);
}

console.log(`\nDone. ${stats.persisted} artifacts persisted across ${stats.messages} messages. Skipped=${stats.skipped}, errors=${stats.errored}.`);
process.exit(0);
