#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
function loadDotEnv() {
  const p = path.join(process.cwd(), '.env.local');
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('='); if (eq<0) continue;
    const k = line.slice(0,eq).trim(); const v = line.slice(eq+1).trim().replace(/^['"]|['"]$/g,'');
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv();
const projectId = process.argv[2];
if (!projectId) { console.error('usage: node marketing-sim-side-effects.mjs <project_id>'); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const [memFacts, memEvents, plans, pending, monitors, alerts, skillCompl, sectionScores, chatMessages] = await Promise.all([
  sql`SELECT kind, fact FROM memory_facts WHERE project_id = ${projectId}`,
  sql`SELECT event_type FROM memory_events WHERE project_id = ${projectId}`,
  sql`SELECT id, name, status, jsonb_array_length(steps) AS step_count FROM workflow_plans WHERE project_id = ${projectId}`,
  sql`SELECT action_type, status FROM pending_actions WHERE project_id = ${projectId}`,
  sql`SELECT id, type, name, status FROM monitors WHERE project_id = ${projectId}`,
  sql`SELECT id FROM ecosystem_alerts WHERE project_id = ${projectId}`,
  sql`SELECT skill_id, status FROM skill_completions WHERE project_id = ${projectId}`,
  sql`SELECT 1 LIMIT 0`,
  sql`SELECT role FROM chat_messages WHERE project_id = ${projectId}`,
]);
console.log(`=== DB side effects for ${projectId} ===`);
console.log(`memory_facts: ${memFacts.length}  (kinds: ${[...new Set(memFacts.map(f=>f.kind))].join(',') || '-'})`);
memFacts.slice(0,8).forEach(f => console.log(`  [${f.kind}] ${f.fact.slice(0,150)}`));
console.log(`memory_events: ${memEvents.length}  (types: ${[...new Set(memEvents.map(e=>e.event_type))].join(',') || '-'})`);
console.log(`workflow_plans: ${plans.length}  ${plans.map(p=>`"${p.name}"(${p.step_count}st,${p.status})`).join(', ')}`);
console.log(`pending_actions: ${pending.length}  (types: ${[...new Set(pending.map(p=>p.action_type))].join(',') || '-'})`);
console.log(`monitors: ${monitors.length}  ${monitors.map(m=>`${m.type}:"${m.name}"(${m.status})`).join(', ')}`);
console.log(`ecosystem_alerts: ${alerts.length}`);
console.log(`skill_completions: ${skillCompl.length}  ${skillCompl.map(s=>`${s.skill_id}(${s.status})`).join(', ')}`);
console.log(`section_scores: (table absent; skill_completions.section_scores jsonb embeds them)`);
console.log(`chat_messages: ${chatMessages.length}  (roles: ${[...new Set(chatMessages.map(c=>c.role))].join(',')})`);
await sql.end({ timeout: 5 });
