import postgres from 'postgres';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const m = env.match(/DATABASE_URL="?([^"\n]+)"?/);
const sql = postgres(m[1], { prepare: false, idle_timeout: 10, max: 2 });

const PROJ = 'proj_df00d72d-2b6'; // MediFlow

try {
  const msgs = await sql`
    SELECT id, role, content, step, created_at, meta
    FROM chat_messages
    WHERE project_id = ${PROJ}
    ORDER BY created_at ASC, id ASC
  `;
  let i = 0;
  for (const msg of msgs) {
    i++;
    console.log(`\n#${i} [${msg.role}] ${msg.created_at?.toISOString?.() ?? msg.created_at}  step=${msg.step}`);
    const content = msg.content ?? '';
    const optionSets = [...content.matchAll(/:::artifact\{"type":"option-set"[^}]*\}\s*([\s\S]*?):::/g)].map(x => x[1].trim());
    const prose = content.replace(/:::artifact[\s\S]*?:::/g, '[ARTIFACT]').slice(0, 1400);
    console.log('  PROSE:', prose.replace(/\n/g, '\n  '));
    optionSets.forEach((os, k) => {
      try {
        const parsed = JSON.parse(os);
        console.log(`  OPTION-SET[${k}] prompt: ${parsed.prompt}`);
        (parsed.options || []).forEach(o => {
          console.log(`     - id=${o.id} | label="${o.label}" | skill_id=${o.skill_id ?? ''} | credits=${o.credits ?? ''}`);
        });
      } catch {
        console.log(`  OPTION-SET[${k}] (unparseable):`, os.slice(0, 400));
      }
    });
  }
} catch (e) {
  console.error('ERROR:', e.message);
} finally {
  await sql.end();
}
