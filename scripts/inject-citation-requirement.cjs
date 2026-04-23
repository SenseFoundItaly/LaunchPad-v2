#!/usr/bin/env node
/**
 * One-shot: inject a "Source Requirements" block into every SKILL.md +
 * SKILL.it.md file under launchpad-skills/.
 *
 * The block is inserted between the YAML frontmatter and the first heading.
 * Idempotent — if a file already contains the anchor comment
 * `<!-- sources-required-block -->`, it's skipped.
 *
 * Rationale: Phase C of the mandatory-sources plan. Every skill output
 * carries factual claims (risks, scores, market data, competitor analysis)
 * that MUST cite sources. Rather than rewriting each skill's JSON schema
 * individually (they vary), we append the universal rule and let the
 * per-skill schemas pick it up via the shared Source type.
 */
const fs = require('fs');
const path = require('path');

const EN_BLOCK = `<!-- sources-required-block -->
## Source Requirements (MANDATORY)

Every factual claim in the output of this skill MUST cite at least one source. This applies to:

- Numbers (market sizes, percentages, timelines, costs, benchmarks)
- Named entities (competitors, regulations, tools, companies, people)
- External-world claims (trends, dates, events, expert opinions)
- Every risk, score dimension, recommendation, and workflow step

**Source schema** (include as a \`sources: Source[]\` field at every factual level of the output JSON, not just the top):

\`\`\`ts
type Source =
  | { type: 'web'; title: string; url: string; accessed_at?: string; quote?: string }
  | { type: 'skill'; title: string; skill_id: string; run_id?: string; quote?: string }
  | { type: 'internal'; title: string; ref: 'graph_node'|'score'|'research'|'memory_fact'|'chat_turn'; ref_id: string; quote?: string }
  | { type: 'user'; title: string; chat_turn_id?: string; quote: string }
  | { type: 'inference'; title: string; based_on: Source[]; reasoning: string };
\`\`\`

**Rules:**
1. No invented numbers, URLs, or company names. If you don't have a source, say so plainly — never fabricate.
2. Web sources must carry the verbatim URL — don't paraphrase.
3. Use \`type: 'internal'\` when citing the founder's own project data (scores, research rows, memory facts).
4. Use \`type: 'user'\` when quoting the founder verbatim from chat.
5. \`type: 'inference'\` is allowed ONLY when \`based_on\` is non-empty; \`reasoning\` must explain the synthesis chain.
6. Attach sources at BOTH the top level (skill-wide provenance) AND at each nested factual entry (per-risk, per-dimension, per-competitor).
7. A claim without a source is a rejected claim. The UI will display it as "UNSOURCED — discarded" and the parser will drop it from persistence.

`;

const IT_BLOCK = `<!-- sources-required-block -->
## Requisiti delle Fonti (OBBLIGATORIO)

Ogni affermazione fattuale nell'output di questa skill DEVE citare almeno una fonte. Si applica a:

- Numeri (dimensioni di mercato, percentuali, tempistiche, costi, benchmark)
- Entità nominate (concorrenti, regolamenti, strumenti, aziende, persone)
- Affermazioni sul mondo esterno (tendenze, date, eventi, opinioni di esperti)
- Ogni rischio, dimensione di punteggio, raccomandazione e passo di workflow

**Schema della fonte** (includere come campo \`sources: Source[]\` a ogni livello fattuale del JSON di output, non solo al top):

\`\`\`ts
type Source =
  | { type: 'web'; title: string; url: string; accessed_at?: string; quote?: string }
  | { type: 'skill'; title: string; skill_id: string; run_id?: string; quote?: string }
  | { type: 'internal'; title: string; ref: 'graph_node'|'score'|'research'|'memory_fact'|'chat_turn'; ref_id: string; quote?: string }
  | { type: 'user'; title: string; chat_turn_id?: string; quote: string }
  | { type: 'inference'; title: string; based_on: Source[]; reasoning: string };
\`\`\`

**Regole:**
1. Nessun numero, URL o nome di azienda inventato. Se non hai una fonte, dillo apertamente — non inventare mai.
2. Le fonti web devono riportare l'URL verbatim — non parafrasare.
3. Usa \`type: 'internal'\` quando citi dati del progetto del founder (punteggi, righe di ricerca, fatti in memoria).
4. Usa \`type: 'user'\` quando citi il founder verbatim dalla chat.
5. \`type: 'inference'\` è consentito SOLO quando \`based_on\` è non vuoto; \`reasoning\` deve spiegare la catena di sintesi.
6. Allega le fonti sia al livello principale (provenienza della skill) sia a ogni elemento fattuale annidato (per rischio, per dimensione, per concorrente).
7. Un'affermazione senza fonte è un'affermazione rifiutata. La UI la mostrerà come "SENZA FONTE — scartato" e il parser la rimuoverà dalla persistenza.

`;

const ROOT = path.join(__dirname, '..', 'launchpad-skills');
const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(ROOT, e.name));

let updated = 0;
let skipped = 0;
for (const dir of dirs) {
  for (const [filename, block] of [
    ['SKILL.md', EN_BLOCK],
    ['SKILL.it.md', IT_BLOCK],
  ]) {
    const full = path.join(dir, filename);
    if (!fs.existsSync(full)) {
      console.warn(`[skip] ${path.relative(ROOT, full)} not found`);
      continue;
    }
    const raw = fs.readFileSync(full, 'utf-8');
    if (raw.includes('<!-- sources-required-block -->')) {
      skipped++;
      continue;
    }
    // Frontmatter ends with `---\n` on its own line; insert the block right
    // after that, before any existing H1/H2 heading. The file starts with
    // `---\n...\n---\n`, so we want the first `\n---\n` (which is the
    // CLOSING marker — the opening `---` is at offset 0 with no leading \n).
    const fmEnd = raw.indexOf('\n---\n');
    if (fmEnd === -1) {
      console.warn(`[skip] ${path.relative(ROOT, full)} has no closing frontmatter`);
      continue;
    }
    const headEnd = fmEnd + 5; // past '\n---\n'
    const before = raw.slice(0, headEnd);
    const after = raw.slice(headEnd);
    const out = `${before}\n${block}${after}`;
    fs.writeFileSync(full, out);
    updated++;
    console.log(`[updated] ${path.relative(ROOT, full)}`);
  }
}
console.log(`\nDone: ${updated} files updated, ${skipped} already had the block.`);
