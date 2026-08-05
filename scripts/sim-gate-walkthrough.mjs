#!/usr/bin/env node
/**
 * Validation Gate walkthrough — does FOLLOWING the product close the gate?
 *
 * The spine routing audit (#399) proved every check now offers a real prompt.
 * This asks the next question, which nothing has ever tested end-to-end: if a
 * founder clicks each unmet substep and says exactly what the product puts in
 * their mouth, does the check actually go green?
 *
 * So it drives the REAL loop, no shortcuts:
 *   1. click the substep  -> send `checkActionPrompt(label)` verbatim to /api/chat
 *   2. approve what comes back -> apply every pending action (the founder's yes)
 *   3. re-read GET /stages     -> did THAT check flip, and did anything else?
 *
 * A check that needs two turns gets two turns; one that needs three is recorded
 * as stuck and the walk moves on. What it measures is the write path in
 * SEQUENCE — each check's writer is unit-tested, the chain is not.
 *
 * Run: E2E_AUTH_ENABLED=1 dev server on :3005, then
 *      node scripts/sim-gate-walkthrough.mjs
 * Writes /tmp/gate-walk.json for the caller to read.
 *
 * NOTE: dev == prod (one Supabase). This creates a throwaway user + project
 * named so it is obvious in the projects list. It never touches an existing one.
 */
import fs from 'node:fs';
import postgres from 'postgres';

const BASE = 'http://localhost:3005';
const ENV = '/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local';
for (const raw of fs.readFileSync(ENV, 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const userId = 'gatewalk-' + Math.random().toString(36).slice(2, 10);
const out = { userId, startedAt: new Date().toISOString(), steps: [], gate: {} };
// One file per run. Two overlapping runs sharing /tmp/gate-walk.json clobbered
// each other and produced an interleaved log that read like a failed fix.
const OUT = process.env.GATE_WALK_OUT || `/tmp/gate-walk-${userId}.json`;
const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

async function stream(path, body, timeoutMs = 240_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) return { error: `${res.status}: ${(await res.text()).slice(0, 300)}` };
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try { const p = JSON.parse(line.slice(6)); if (typeof p.content === 'string') full += p.content; } catch { /* partial */ }
      }
    }
    return { full };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  } finally { clearTimeout(timer); }
}

/** The gate as the founder sees it: every check with its verdict + prompt. */
async function gate(projectId) {
  const r = await api('GET', `/api/projects/${projectId}/stages`);
  const ev = r.json?.data?.evaluations ?? r.json?.evaluations ?? [];
  const g = ev.find((e) => e.stage.id === 'market_validation');
  if (!g) return null;
  return g.results.map((x) => ({
    id: x.check.id, label: x.check.label, track: x.check.track,
    passed: !!x.result.passed, locked: !!x.result.locked, gap: x.result.gap ?? null,
  }));
}

/** The founder's yes: apply every pending action waiting on them. */
async function applyPending(projectId) {
  const rows = await sql`
    SELECT id, title, action_type FROM pending_actions
     WHERE project_id = ${projectId} AND status IN ('pending','edited')
     ORDER BY created_at ASC LIMIT 12`;
  const applied = [];
  for (const a of rows) {
    const r = await api('POST', `/api/projects/${projectId}/actions/${a.id}`, { transition: 'apply' });
    applied.push({ title: a.title, type: a.action_type, status: r.status });
    await sleep(400);
  }
  return applied;
}

(async () => {
  console.log(`gate walkthrough  user=${userId}`);
  await sql`INSERT INTO users (id, email, locale) VALUES (${userId}, ${userId + '@sim.local'}, 'it')`;

  // ── Stage 1: get to the gate. NOT what we're testing, so it's set up
  //    directly rather than walked — a realistic IT founder past Phase 0.
  const pr = await api('POST', '/api/projects', {
    name: 'SIM Gate Walkthrough (cancellabile)', locale: 'it',
    description: 'RipetiBene è un\'app per fisioterapisti italiani che assegna esercizi a casa ai pazienti con video personalizzati e verifica l\'esecuzione tramite la fotocamera del telefono. Il problema: il 70% dei pazienti abbandona gli esercizi a casa e il fisioterapista non ha modo di sapere se e come li fanno. Modello SaaS mensile per studio.',
  });
  const projectId = pr.json?.data?.project_id || pr.json?.project_id || pr.json?.id;
  out.projectId = projectId;
  console.log('  project', projectId);
  await sleep(3000);
  await applyPending(projectId);
  // UPSERT, not UPDATE. The original UPDATE matched ZERO rows — a brand-new
  // project has no idea_canvas row yet — so every walkthrough ran against a
  // COMPLETELY EMPTY canvas while reporting that it had seeded one. The model
  // was right to refuse 1B work on it ("Stage 1 a 0/9"), and every number this
  // harness produced described a scenario that should not exist.
  //
  // This is the project's own documented footgun (CLAUDE.md: a bare UPDATE that
  // matches no row returns success and writes nothing) — the same one that made
  // gate-verdict a silent no-op on 65 of 94 projects. Written into the harness
  // by the person who had just read the warning.
  await sql`INSERT INTO idea_canvas (id, project_id) VALUES (${'ic_' + userId}, ${projectId})
              ON CONFLICT (project_id) DO NOTHING`;
  // Bound parameters, not inline literals — an apostrophe in the Italian copy
  // ("dell'esecuzione") terminates a hand-written SQL string.
  await sql`
    UPDATE idea_canvas SET
      problem = COALESCE(NULLIF(problem,''), ${'Il 70% dei pazienti abbandona gli esercizi a casa e il fisioterapista non sa se li eseguono correttamente.'}),
      solution = COALESCE(NULLIF(solution,''), ${"App con video di esercizi personalizzati e verifica dell'esecuzione tramite fotocamera."}),
      target_market = COALESCE(NULLIF(target_market,''), ${'Studi di fisioterapia privati italiani, 1-5 professionisti.'}),
      value_proposition = COALESCE(NULLIF(value_proposition,''), ${'Il fisioterapista vede davvero cosa fa il paziente a casa, senza chiamarlo.'}),
      competitive_advantage = COALESCE(NULLIF(competitive_advantage,''), ${'Verifica del movimento on-device, nessun wearable da comprare.'}),
      unfair_advantage = COALESCE(NULLIF(unfair_advantage,''), ${'Dataset di esecuzioni reali annotate da fisioterapisti partner.'}),
      business_model = COALESCE(NULLIF(business_model,''), ${'Abbonamento mensile per studio, prezzo per numero di pazienti attivi.'}),
      channels = COALESCE(NULLIF(channels,''), ${'Ordini professionali, congressi di fisioterapia, passaparola tra studi.'})
    WHERE project_id = ${projectId}`;
  await sql`UPDATE idea_canvas SET key_metrics = ${['Aderenza agli esercizi', 'Studi attivi']},
              revenue_streams = ${['Abbonamento mensile per studio']},
              cost_structure = ${['Inferenza on-device', 'Supporto clinico']}
            WHERE project_id = ${projectId}`;

  // Assert the seed actually landed. A harness that silently measures the wrong
  // scenario is worse than one that crashes: it produces numbers people act on.
  const seeded = (await sql`SELECT problem, solution, value_proposition FROM idea_canvas WHERE project_id = ${projectId}`)[0];
  if (!seeded?.problem || !seeded?.solution || !seeded?.value_proposition) {
    throw new Error('seed del canvas FALLITO — il walkthrough misurerebbe un founder senza Stage 1');
  }

  const before = await gate(projectId);
  out.gate.initial = before;
  console.log(`  gate iniziale: ${before.filter((c) => c.passed).length}/${before.length} verdi`);
  save();

  // ── The walk. Always take the FIRST unmet unlocked check — the same order a
  //    founder reading top to bottom would.
  const attempts = {};        // check id -> turns spent
  const MAX_PER_CHECK = 2;    // a third turn is a stuck check, not a slow one
  for (let turn = 1; turn <= 34; turn++) {
    const state = await gate(projectId);
    const open = state.filter((c) => !c.passed && !c.locked);
    if (open.length === 0) {
      console.log('  nessun check aperto e sbloccato — fine');
      break;
    }
    const target = open.find((c) => (attempts[c.id] ?? 0) < MAX_PER_CHECK);
    if (!target) { console.log('  tutti i check aperti hanno esaurito i tentativi'); break; }
    attempts[target.id] = (attempts[target.id] ?? 0) + 1;

    // The prompt the spine pre-fills when the founder clicks this substep.
    const promptRes = await api('POST', `/api/projects/${projectId}/context`, {}).catch(() => null);
    void promptRes;
    const prompt = PROMPTS[target.id] ?? `Aiutami con: ${target.label}`;

    console.log(`  [${turn}] ${target.id} (t${attempts[target.id]}) → "${prompt.slice(0, 60)}…"`);
    const t0 = Date.now();
    const chat = await stream('/api/chat', {
      project_id: projectId, step: 'chat',
      messages: [{ role: 'user', content: prompt }],
      // The real UI now carries the pressed substep alongside the sentence;
      // sending only the text would measure the OLD behaviour.
      target_check: target.id,
    });
    const applied = await applyPending(projectId);
    await sleep(1200);
    const after = await gate(projectId);
    const flipped = after.filter((c) => c.passed && !state.find((b) => b.id === c.id)?.passed).map((c) => c.id);

    out.steps.push({
      turn, check: target.id, label: target.label, attempt: attempts[target.id], prompt,
      ms: Date.now() - t0,
      chatError: chat.error ?? null,
      replyHead: (chat.full ?? '').replace(/:::artifact\{[\s\S]*?\}:::/g, '[ARTIFACT]').slice(0, 400),
      appliedActions: applied,
      flipped,
      targetWentGreen: flipped.includes(target.id),
      greenTotal: after.filter((c) => c.passed).length,
    });
    console.log(`      → ${flipped.length ? 'VERDE: ' + flipped.join(', ') : 'nessun cambiamento'}  (${after.filter((c) => c.passed).length}/${after.length})`);
    save();
  }

  out.gate.final = await gate(projectId);
  out.finishedAt = new Date().toISOString();
  save();
  const f = out.gate.final;
  console.log(`\nFINALE: ${f.filter((c) => c.passed).length}/${f.length} verdi`);
  for (const c of f) console.log(`  ${c.passed ? '✅' : c.locked ? '🔒' : '❌'} ${c.track} ${c.id}`);
  await sql.end();
})().catch(async (e) => { console.error('FATAL', e); out.fatal = String(e); save(); await sql.end(); process.exit(1); });

/** Verbatim output of checkActionPrompt(label, it) — what the spine pre-fills.
 *  Hardcoded rather than imported: this script is plain node and the module is
 *  TS. Regenerate if the prompts change (journey-prompts.test.ts guards them). */
const PROMPTS = {
  market_size: 'Aiutami a stimare la dimensione del mio mercato (TAM / SAM / SOM).',
  competitors_mapped: 'Aiutami a cercare e mappare i miei principali concorrenti.',
  gtm_opportunities: 'Aiutami a individuare le opportunità e gli ostacoli di go-to-market per arrivare ai primi clienti.',
  partners_identified: 'Aiutami a individuare partner, rivenditori o distributori che potrebbero portarmi ai clienti.',
  monitors_set: 'Imposta un watcher sui miei principali concorrenti o sui trend di mercato.',
  build_approach: 'Aiutami a definire lo scope del mio MVP.',
  technical_risk_named: 'Aiutami a valutare la fattibilità tecnica.',
  key_dependencies: 'Aiutami a individuare le mie dipendenze tecniche principali.',
  regulatory_check: 'Aiutami a verificare i vincoli normativi e di conformità (es. GDPR).',
  ip_analysis: 'Aiutami a valutare la proprietà intellettuale — brevetti, marchi e libertà di operare.',
  data_availability: 'Aiutami a capire quali dati mi servono, se sono disponibili e con che qualità.',
  validation_strategy: 'Aiutami a definire la strategia di validazione — cosa testo, con chi, e cosa lo dimostrerebbe.',
  jtbd_mapping: 'Aiutami a mappare i Jobs-to-be-Done — il lavoro per cui il cliente mi assume.',
  interviews_logged: 'Aiutami a registrare le interviste ai clienti — ti dirò con chi ho parlato e cosa mi ha detto.',
  pain_validated: 'Aiutami a individuare il singolo pain point più importante.',
  differentiation_evidence: 'Aiutami a spiegare cosa mi distingue dai concorrenti.',
  wtp_signal: 'Aiutami a registrare un segnale di disponibilità a pagare — ti dico cosa hanno detto gli intervistati.',
  solution_in_depth: 'Aiutami a descrivere la mia soluzione in modo più approfondito.',
  value_prop_sharpened: 'Aiutami a rendere più incisiva la mia value proposition.',
  scoring_review: 'Rilancia lo Startup Scoring ora che ho le evidenze dalle interviste, e confrontalo con il punteggio di partenza.',
  gate_verdict: 'Rivediamo le prove del Validation Gate e aiutami a decidere: GO, PIVOT o STOP.',
};
