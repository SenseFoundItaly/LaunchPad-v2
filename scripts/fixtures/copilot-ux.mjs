/** Synthetic founder content: deterministic UI examples, not market evidence. */
export function artifactBlock(artifact) {
  return `:::artifact${JSON.stringify({ type: artifact.type, id: artifact.id, department: artifact.department })}\n${JSON.stringify(artifact)}\n:::`;
}
const fields = [
  ['problem', 'Problem', 'problem_defined', 'One florist found unsold stems at closing; we do not yet know how often this happens.'],
  ['target_market', 'Target market', 'target_icp_defined', 'Independent florists in Turin.'],
  ['solution', 'Solution', 'solution_sketched', 'A shared manual checklist for stock updates during the day.'],
  ['value_proposition', 'Value proposition', 'value_prop', 'Hypothesis: a shared checklist may help florists notice unsold stock before closing.'],
];
const source = (quote) => ({ type: 'user', title: 'Synthetic founder statement for UI testing', quote });
export function proposal(id) {
  return {
    type: 'validation-proposal', id, pending_action_id: `pa_${id}`, origin: 'chat', combined_credits: 0,
    items: fields.map(([field, label, check, value], i) => ({
      id: `${id}_${i}`, kind: 'canvas_field', field, label, value, credits: 0, sources: [source(value)],
      targets: [{ check_id: check, stage_id: 'idea_validation', check_label: label, stage_label: 'Idea Canvas', stage_number: 1 }],
      validates: `${label} — Stage 1`,
    })),
  };
}
export function comparison(id, italian = false) {
  return {
    type: 'comparison-table', id, department: 'product',
    title: italian ? 'Confronto delle modalità di aggiornamento delle scorte' : 'Two checklist workflows to test',
    columns: italian ? ['Opzione', 'Ipotesi da verificare', 'Prossimo esperimento'] : ['Option', 'Hypothesis to test', 'Next experiment'],
    rows: [
      { label: italian ? 'Checklist condivisa' : 'Shared checklist', values: italian ? ['Il personale potrebbe aggiornare le scorte durante la giornata.', 'Osservare un turno senza modificare il processo di vendita.'] : ['Staff may be able to update stock during the day.', 'Observe one shift without changing the sales process.'] },
      { label: italian ? 'Riepilogo a fine giornata' : 'End-of-day summary', values: italian ? ['Un riepilogo potrebbe essere più semplice, ma arrivare troppo tardi per intervenire.', 'Chiedere al titolare quando consulta effettivamente il riepilogo.'] : ['A summary may be simpler but arrive too late for action.', 'Ask when the owner actually reads the summary.'] },
    ],
    sources: [source(italian ? 'Vorrei confrontare una checklist condivisa e un riepilogo a fine giornata.' : 'Compare a shared checklist with an end-of-day summary.')],
  };
}
const message = (role, content) => ({ role, content });
/**
 * @typedef {{ key: string, locale: string, name: string, description: string,
 * messages: Array<{role: string, content: string}>,
 * actions: Array<{artifact: ReturnType<typeof proposal>, status: string}>,
 * canvas: Record<string, string> | null }} UXScenario
 */
/** @returns {UXScenario[]} */
export function createScenarios() {
  const base = (key, locale = 'en') => ({ key, locale, name: `[UX fixture] ${key}`, description: 'Synthetic UI test: manual stock checklist for independent florists in Turin.', messages: [], actions: [], canvas: null });
  const review = (key, status = 'pending') => {
    const s = base(key);
    const p = proposal(key);
    s.actions = [{ artifact: p, status }];
    s.messages = [message('user', 'Propose four canvas fields for review. Do not apply them yet.'), message('assistant', `Review these four drafts before applying them.\n\n${artifactBlock(p)}`)];
    return s;
  };
  const empty = base('empty');
  const pending = review('pending');
  const revision = review('revision');
  revision.canvas = Object.fromEntries(fields.map(([field, , , value]) => [field, value]));
  revision.canvas.target_market = 'Flower shops throughout Italy — earlier approved scope.';
  revision.messages[0].content = 'Narrow the target to independent florists in Turin. Propose this correction before applying it.';
  const approved = review('approved', 'applied');
  approved.canvas = Object.fromEntries(fields.map(([field, , , value]) => [field, value]));
  approved.messages.push(message('user', 'I approve these four fields.'));
  const rejected = review('rejected', 'rejected');
  rejected.messages.push(message('user', 'Skip these drafts; I want to revisit the problem.'));
  const discussion = base('discussion');
  discussion.messages = [message('user', 'Compare the two checklist workflows. Discussion only; do not save anything.'), message('assistant', `These are hypotheses to test, not verified outcomes.\n\n${artifactBlock(comparison('discussion-table'))}`)];
  const long = base('long-it', 'it');
  long.name = '[UX fixture] Conversazione lunga — una checklist condivisa per fioristi indipendenti a Torino';
  for (let i = 0; i < 60; i++) {
    long.messages.push(message('user', `Nota ${i + 1}: stiamo studiando una checklist manuale per un singolo negozio. Non generalizzare questa osservazione.`));
    long.messages.push(message('assistant', `Nota ${i + 1} ricevuta. Resta un’osservazione su un negozio; frequenza e impatto sono ancora da verificare.${i % 20 === 0 ? '\n\n' + artifactBlock(comparison(`history-${i}`, true)) : ''}`));
  }
  long.messages.push(message('user', 'Correzione finale: il negozio è a Torino, non a Milano. Non salvare ancora.'));
  long.messages.push(message('assistant', `Userò Torino in questa discussione.\n\n${artifactBlock(comparison('latest-it', true))}`));
  return [empty, pending, revision, approved, rejected, discussion, long];
}
