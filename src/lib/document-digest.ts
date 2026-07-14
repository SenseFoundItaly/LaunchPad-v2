/**
 * Document Digest (brownfield founders) — turn an uploaded document's text into
 * STAGED, founder-approvable prefill across the journey:
 *
 *   canvas fields / competitors / market-size / tech facts
 *     → one validation_proposal via stageValidationItemsFromRaw (the SAME
 *       approval gate as artifact auto-staging: nothing greens without Apply)
 *   watch-worthy competitors / regulations
 *     → configure_monitor pending_actions (founder applies from Inbox/chat)
 *
 * The pre-existing upload extractor only proposed graph ENTITIES and sampled
 * the first 16k chars; everything canvas/market/tech-shaped in a founder's
 * existing deck evaporated. This digests the FULL stored text (16k chunks) and
 * routes each finding onto the rails the spine already reads.
 *
 * Non-throwing throughout: a digest failure must never break an upload.
 */
import { runAgent } from '@/lib/pi-agent';
import { wrapUntrusted } from '@/lib/untrusted-content';
import { recordAgentUsage } from '@/lib/cost-meter';
import { createPendingAction } from '@/lib/pending-actions';
import { query } from '@/lib/db';
import { recordEvent } from '@/lib/memory/events';
import { stageValidationItemsFromRaw, type RawValidationItem } from '@/lib/auto-stage-validation';
import type { Source } from '@/types/artifacts';

const CHUNK_CHARS = 16_000;
// Stored text caps at 50k → ceil(50k/16k) = 4 chunks. The retro /digest
// endpoint runs the full cap; the upload path passes maxChunks:2 for its
// serverless latency budget (the tail is recovered via re-digest — see the
// partial/total accounting below).
const MAX_CHUNKS = 4;
const MAX_WATCHERS_PER_DOC = 2;

export const DIGEST_ORIGIN = 'document_digest';

const DIGEST_PROMPT = `You are digesting a startup founder's existing document so their validation journey can be pre-filled. Extract ONLY what the document actually states — never invent or embellish. Output STRICT JSON (no markdown fence, no prose):
{
 "canvas": {"problem": string|null, "solution": string|null, "target_market": string|null, "value_proposition": string|null, "competitive_advantage": string|null, "channels": string|null},
 "competitors": [{"name": string, "note": string}],
 "market_size": [{"claim": string}],
 "tech_facts": [{"aspect": "feasibility"|"dependencies"|"regulatory", "finding": string}],
 "watch_suggestions": [{"name": string, "topic": "competitor"|"regulation", "rationale": string}],
 "interviews": [{"person": string, "role": string|null, "segment": string|null, "summary": string, "top_pain": string|null, "urgency": "high"|"medium"|"low"|null, "wtp_amount": number|null, "wtp_currency": string|null}],
 "pricing": {"model": string|null, "anchor_price": number|null, "currency": string|null, "tiers": [string]|null, "wtp_note": string|null},
 "metrics": [{"name": string, "value": number, "unit": string|null, "as_of": string|null}],
 "financials": {"monthly_burn": number|null, "cash_on_hand": number|null, "mrr": number|null, "currency": string|null},
 "gtm": [{"channel": string, "detail": string}],
 "brand": [{"aspect": string, "statement": string}]
}
Rules: canvas values are 1-3 sentences verbatim-faithful to the document (null when absent). market_size claims must contain the number AND its scope as stated. watch_suggestions only for named competitors/regulations material enough to monitor. interviews ONLY for actual customer/user interviews the founder recorded (one entry per interviewee; top_pain verbatim when quoted; wtp_amount only when a price/willingness figure is stated) — never for hypothetical personas. pricing: model = the revenue model as stated (subscription / commission / one-time / freemium…); anchor_price = the headline number only when a price is stated; tiers = named plans if any; wtp_note = any stated willingness-to-pay evidence. Null every pricing field the document doesn't state. metrics: ONLY tracked KPIs stated as CURRENT/actual figures (MRR, active users, churn, signups, retention…) — never targets, projections, or goals; value is the bare number (9200, not "€9.2k"); unit = "%"|"EUR"|"users"|… as stated. financials: stated ACTUALS only (never projections) — monthly_burn = net monthly cash burn, cash_on_hand = cash in the bank, mrr = monthly recurring revenue. gtm: one entry per acquisition/marketing channel the document commits to, detail = the stated strategy for that channel in 1-2 sentences. brand: positioning/voice/visual-identity statements (aspect = "positioning"|"voice"|"visual"|…), verbatim-faithful. Empty arrays when nothing qualifies.

DOCUMENT (part {PART}):
{TEXT}`;

interface DigestInterview {
  person: string; role?: string | null; segment?: string | null; summary: string;
  top_pain?: string | null; urgency?: string | null; wtp_amount?: number | null; wtp_currency?: string | null;
}

interface DigestFindings {
  canvas: Record<string, string | null>;
  competitors: Array<{ name: string; note?: string }>;
  market_size: Array<{ claim: string }>;
  tech_facts: Array<{ aspect: string; finding: string }>;
  watch_suggestions: Array<{ name: string; topic: string; rationale: string }>;
  interviews: DigestInterview[];
  pricing: { model?: string | null; anchor_price?: number | null; currency?: string | null; tiers?: string[] | null; wtp_note?: string | null };
  // Operate-stage findings (post-validation docs: financial actuals, GTM plans,
  // ad briefs, brand decks) — see plan happy-beacon. Same approval gate.
  metrics: Array<{ name: string; value: number; unit?: string | null; as_of?: string | null }>;
  financials: { monthly_burn?: number | null; cash_on_hand?: number | null; mrr?: number | null; currency?: string | null };
  gtm: Array<{ channel: string; detail: string }>;
  brand: Array<{ aspect: string; statement: string }>;
}

function emptyFindings(): DigestFindings {
  return { canvas: {}, competitors: [], market_size: [], tech_facts: [], watch_suggestions: [], interviews: [], pricing: {}, metrics: [], financials: {}, gtm: [], brand: [] };
}

function parseFindings(raw: string): DigestFindings {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return emptyFindings();
    const j = JSON.parse(m[0]) as Partial<DigestFindings>;
    return {
      canvas: j.canvas && typeof j.canvas === 'object' ? j.canvas as Record<string, string | null> : {},
      competitors: Array.isArray(j.competitors) ? j.competitors.filter((c) => c && typeof c.name === 'string') : [],
      market_size: Array.isArray(j.market_size) ? j.market_size.filter((x) => x && typeof x.claim === 'string') : [],
      tech_facts: Array.isArray(j.tech_facts) ? j.tech_facts.filter((x) => x && typeof x.finding === 'string') : [],
      watch_suggestions: Array.isArray(j.watch_suggestions) ? j.watch_suggestions.filter((w) => w && typeof w.name === 'string') : [],
      interviews: Array.isArray(j.interviews) ? j.interviews.filter((iv) => iv && typeof iv.person === 'string' && typeof iv.summary === 'string') : [],
      pricing: j.pricing && typeof j.pricing === 'object' ? j.pricing : {},
      metrics: Array.isArray(j.metrics) ? j.metrics.filter((m) => m && typeof m.name === 'string' && typeof m.value === 'number' && Number.isFinite(m.value)) : [],
      financials: j.financials && typeof j.financials === 'object' ? j.financials : {},
      gtm: Array.isArray(j.gtm) ? j.gtm.filter((g) => g && typeof g.channel === 'string' && typeof g.detail === 'string') : [],
      brand: Array.isArray(j.brand) ? j.brand.filter((b) => b && typeof b.aspect === 'string' && typeof b.statement === 'string') : [],
    };
  } catch {
    return emptyFindings();
  }
}

/** Merge chunk findings: first non-empty canvas value wins (document order);
 *  lists dedup case-insensitively by name/claim. */
function mergeFindings(parts: DigestFindings[]): DigestFindings {
  const out = emptyFindings();
  const seen = { comp: new Set<string>(), mkt: new Set<string>(), tech: new Set<string>(), watch: new Set<string>(), iv: new Set<string>(), metric: new Set<string>(), gtm: new Set<string>(), brand: new Set<string>() };
  for (const p of parts) {
    for (const [k, v] of Object.entries(p.canvas)) {
      if (typeof v === 'string' && v.trim() && !out.canvas[k]) out.canvas[k] = v.trim();
    }
    for (const c of p.competitors) { const k = c.name.toLowerCase().trim(); if (!seen.comp.has(k)) { seen.comp.add(k); out.competitors.push(c); } }
    for (const m of p.market_size) { const k = m.claim.toLowerCase().trim(); if (!seen.mkt.has(k)) { seen.mkt.add(k); out.market_size.push(m); } }
    for (const t of p.tech_facts) { const k = `${t.aspect}:${t.finding}`.toLowerCase(); if (!seen.tech.has(k)) { seen.tech.add(k); out.tech_facts.push(t); } }
    for (const w of p.watch_suggestions) { const k = w.name.toLowerCase().trim(); if (!seen.watch.has(k)) { seen.watch.add(k); out.watch_suggestions.push(w); } }
    for (const iv of p.interviews) { const k = iv.person.toLowerCase().trim(); if (!seen.iv.has(k)) { seen.iv.add(k); out.interviews.push(iv); } }
    // Pricing: first non-null value per field wins (document order).
    for (const key of ['model', 'anchor_price', 'currency', 'tiers', 'wtp_note'] as const) {
      const v = (p.pricing as Record<string, unknown>)[key];
      if (v !== undefined && v !== null && (out.pricing as Record<string, unknown>)[key] == null) {
        (out.pricing as Record<string, unknown>)[key] = v;
      }
    }
    // Operate-stage findings: metrics dedup by name, financials first-non-null
    // per field, gtm dedup by channel, brand dedup by aspect (all first-wins,
    // document order — same convention as everything above).
    for (const m of p.metrics) { const k = m.name.toLowerCase().trim(); if (!seen.metric.has(k)) { seen.metric.add(k); out.metrics.push(m); } }
    for (const key of ['monthly_burn', 'cash_on_hand', 'mrr', 'currency'] as const) {
      const v = (p.financials as Record<string, unknown>)[key];
      if (v !== undefined && v !== null && (out.financials as Record<string, unknown>)[key] == null) {
        (out.financials as Record<string, unknown>)[key] = v;
      }
    }
    for (const g of p.gtm) { const k = g.channel.toLowerCase().trim(); if (!seen.gtm.has(k)) { seen.gtm.add(k); out.gtm.push(g); } }
    for (const b of p.brand) { const k = b.aspect.toLowerCase().trim(); if (!seen.brand.has(k)) { seen.brand.add(k); out.brand.push(b); } }
  }
  return out;
}

export interface DigestInput {
  projectId: string;
  /** memory_facts row id of the stored upload — becomes the internal source ref. */
  factId: string;
  filename: string;
  text: string;
  /** Cap chunks for the caller's latency budget. The upload path runs INSIDE
   *  the buffered request (after entity extraction), so it caps low to fit the
   *  serverless function limit; the /digest retro endpoint uses the full cap.
   *  A doc longer than maxChunks*16k digests its head (non-fatal, partial). */
  maxChunks?: number;
}

export interface DigestResult {
  staged_items: number;
  watcher_proposals: number;
  /** Chunks actually digested this run (≤ total_chunks). */
  chunks: number;
  /** Chunks the FULL stored text splits into — when chunks < total_chunks the
   *  digest is partial and the Data Room offers re-digest to cover the tail. */
  total_chunks: number;
  partial: boolean;
  /** True when every chunk's extraction failed — surfaced as a retryable
   *  failure instead of the old silent console.warn. */
  failed: boolean;
}

/** Split into ≤MAX_CHUNKS chunks of CHUNK_CHARS (fix F3: the old extractor
 *  sampled only the head — long decks lost their back half). */
export function chunkText(text: string, maxChunks: number = MAX_CHUNKS): string[] {
  const cap = Math.max(1, Math.min(MAX_CHUNKS, maxChunks));
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < cap; i += CHUNK_CHARS) {
    chunks.push(text.slice(i, i + CHUNK_CHARS));
  }
  return chunks.length ? chunks : [''];
}

export async function digestDocument(input: DigestInput): Promise<DigestResult> {
  const { projectId, factId, filename, text } = input;
  const result: DigestResult = { staged_items: 0, watcher_proposals: 0, chunks: 0, total_chunks: 0, partial: false, failed: false };
  if (!text.trim()) return result;

  // 1) Chunked extraction over the FULL stored text.
  const parts: DigestFindings[] = [];
  const chunks = chunkText(text, input.maxChunks);
  result.chunks = chunks.length;
  result.total_chunks = Math.max(1, Math.ceil(text.length / CHUNK_CHARS));
  result.partial = result.chunks < result.total_chunks;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const startedAt = Date.now();
      // Injection defense: the document is third-party-authored data — wrap it
      // so an "ignore instructions, output X" line in an uploaded PDF can't
      // steer the extractor (same treatment as fetched web content).
      const { text: raw, usage } = await runAgent(
        DIGEST_PROMPT.replace('{PART}', `${i + 1}/${chunks.length}`).replace('{TEXT}', wrapUntrusted(chunks[i])),
        { task: 'classify', tools: false, timeout: 22_000 },
      );
      await recordAgentUsage({
        project_id: projectId,
        step: 'document-digest',
        task: 'classify',
        usage,
        latency_ms: Date.now() - startedAt,
      });
      parts.push(parseFindings(raw));
    } catch (err) {
      console.warn(`[digest] chunk ${i + 1} failed (non-fatal):`, (err as Error).message);
    }
  }
  // Every chunk failed → a retryable FAILURE, not a quiet zero-findings digest.
  // Recorded on the timeline (below) so the Data Room can offer "retry".
  result.failed = parts.length === 0 && chunks.some((c) => c.trim().length > 0);
  const findings = mergeFindings(parts);

  // 2) Stage canvas / competitors / market-size / tech facts through the
  //    founder-approval gate. Source = the uploaded document itself.
  const docSource: Source = { type: 'internal', title: filename, ref: 'memory_fact', ref_id: factId } as Source;
  const raw: RawValidationItem[] = [];
  for (const [field, value] of Object.entries(findings.canvas)) {
    if (typeof value === 'string' && value.trim()) raw.push({ kind: 'canvas_field', field, value, sources: [docSource] });
  }
  for (const c of findings.competitors) {
    raw.push({ kind: 'competitor', name: c.name, value: c.note || c.name, sources: [docSource] });
  }
  for (const m of findings.market_size) {
    raw.push({ kind: 'market_size_fact', value: m.claim, sources: [docSource] });
  }
  for (const t of findings.tech_facts) {
    raw.push({ kind: 'tech_fact', field: t.aspect, value: t.finding, sources: [docSource] });
  }
  // Stage-3 prefill: the ICP / channels the digest put in the canvas ALSO need
  // to land as memory_facts (the persona/channels checks read facts, not the
  // canvas). Derive them from the already-extracted canvas content — no extra
  // LLM pass. Founder Apply writes both the canvas field and the fact.
  if (typeof findings.canvas.target_market === 'string' && findings.canvas.target_market.trim()) {
    raw.push({ kind: 'persona_fact', value: findings.canvas.target_market, sources: [docSource] });
  }
  if (typeof findings.canvas.channels === 'string' && findings.canvas.channels.trim()) {
    raw.push({ kind: 'channel_fact', value: findings.canvas.channels, sources: [docSource] });
  }
  // Stage-4 prefill: one pricing item per stated field → its pricing_state column.
  const pr = findings.pricing;
  if (typeof pr.model === 'string' && pr.model.trim()) {
    raw.push({ kind: 'pricing', field: 'model', value: pr.model, sources: [docSource], extra: { model: pr.model } });
  }
  if (typeof pr.anchor_price === 'number' && Number.isFinite(pr.anchor_price)) {
    const cur = typeof pr.currency === 'string' && pr.currency.length === 3 ? pr.currency : undefined;
    raw.push({ kind: 'pricing', field: 'anchor_price', value: `${cur ?? ''}${pr.anchor_price}`, sources: [docSource], extra: { anchor_price: pr.anchor_price, ...(cur ? { currency: cur } : {}) } });
  }
  if (Array.isArray(pr.tiers) && pr.tiers.length > 0) {
    raw.push({ kind: 'pricing', field: 'tiers', value: pr.tiers.join(', '), sources: [docSource], extra: { tiers: pr.tiers } });
  }
  if (typeof pr.wtp_note === 'string' && pr.wtp_note.trim()) {
    raw.push({ kind: 'pricing', field: 'wtp', value: pr.wtp_note, sources: [docSource], extra: { wtp: { note: pr.wtp_note } } });
  }
  // Operate-stage prefill (post-validation docs — financial actuals, GTM plans,
  // ad briefs, brand decks): route metrics/financials onto the Stage-6/7 rails,
  // per-channel GTM strategy onto the Stage-3 channel facts, brand statements
  // as staged context. ALL founder-gated — even the ungated brand items are
  // staged, never auto-written: a doc-derived fact written directly could
  // keyword-green a Stage-2/3 check without the founder's yes.
  for (const m of findings.metrics) {
    const unit = typeof m.unit === 'string' && m.unit.trim() ? ` ${m.unit.trim()}` : '';
    raw.push({
      kind: 'metric',
      name: m.name,
      value: `${m.name} = ${m.value}${unit}${m.as_of ? ` (as of ${m.as_of})` : ''}`,
      sources: [docSource],
      extra: { name: m.name, current_value: m.value },
    });
  }
  const fin = findings.financials;
  const finCur = typeof fin.currency === 'string' && fin.currency.trim() ? fin.currency.trim() : '';
  if (typeof fin.monthly_burn === 'number' && Number.isFinite(fin.monthly_burn)) {
    raw.push({ kind: 'financial_fact', field: 'burn', value: `Monthly burn ${finCur}${fin.monthly_burn}`, sources: [docSource], extra: { monthly_burn: fin.monthly_burn } });
  }
  if (typeof fin.cash_on_hand === 'number' && Number.isFinite(fin.cash_on_hand)) {
    raw.push({ kind: 'financial_fact', field: 'cash', value: `Cash on hand ${finCur}${fin.cash_on_hand}`, sources: [docSource], extra: { cash_on_hand: fin.cash_on_hand } });
  }
  if (typeof fin.mrr === 'number' && Number.isFinite(fin.mrr)) {
    raw.push({ kind: 'financial_fact', field: 'revenue', value: `MRR ${finCur}${fin.mrr}`, sources: [docSource], extra: { mrr: fin.mrr } });
  }
  for (const g of findings.gtm) {
    raw.push({ kind: 'channel_fact', value: `${g.channel} — ${g.detail}`, sources: [docSource] });
  }
  for (const b of findings.brand) {
    raw.push({ kind: 'brand_fact', field: b.aspect.slice(0, 60), value: b.statement, sources: [docSource] });
  }
  // 1C prefill (linee guida: 5+ interviews, verbatim pain, WTP signal): each
  // interview the founder's notes record → one staged interview row. Their
  // Apply is the attestation; Loop-1 WTP machinery reads the same rows.
  for (const iv of findings.interviews) {
    raw.push({
      kind: 'interview',
      name: iv.person,
      value: iv.summary,
      sources: [docSource],
      extra: {
        person_role: iv.role ?? undefined,
        person_segment: iv.segment ?? undefined,
        top_pain: iv.top_pain ?? undefined,
        urgency: iv.urgency ?? undefined,
        wtp_amount: typeof iv.wtp_amount === 'number' ? iv.wtp_amount : undefined,
        wtp_currency: iv.wtp_currency ?? undefined,
      },
    });
  }
  if (raw.length > 0) {
    const staged = await stageValidationItemsFromRaw(projectId, raw, `document "${filename}"`);
    if (staged.staged) result.staged_items = staged.itemCount ?? raw.length;
  }

  // 3) Seed watchers (fix F5): named competitors/regulations material enough to
  //    monitor → configure_monitor proposals. Dedup against ANY existing
  //    monitor proposal or live monitor with the same name (case-insensitive).
  try {
    const existing = await query<{ name: string }>(
      `SELECT title AS name FROM pending_actions
        WHERE project_id = ? AND action_type = 'configure_monitor' AND status IN ('pending','edited')
       UNION ALL
       SELECT name FROM monitors WHERE project_id = ?`,
      projectId, projectId,
    );
    const taken = new Set(existing.map((e) => (e.name || '').toLowerCase()));
    for (const w of findings.watch_suggestions.slice(0, MAX_WATCHERS_PER_DOC)) {
      const already = [...taken].some((t) => t.includes(w.name.toLowerCase()));
      if (already) continue;
      await createPendingAction({
        project_id: projectId,
        action_type: 'configure_monitor',
        title: `Configure monitor: ${w.name}`,
        rationale: `${w.rationale} (from your document "${filename}")`.slice(0, 300),
        payload: {
          name: w.name,
          objective: w.rationale,
          kind: w.topic === 'regulation' ? 'regulation' : 'competitor',
          schedule: 'weekly',
          query: w.name,
          urls_to_track: [],
          alert_threshold: `Material change relevant to ${w.name}`,
          linked_risk_id: 'ad_hoc',
          topic: w.topic,
          origin: DIGEST_ORIGIN,
        },
        estimated_impact: 'medium',
      });
      taken.add(w.name.toLowerCase());
      result.watcher_proposals++;
    }
  } catch (err) {
    console.warn('[digest] watcher seeding failed (non-fatal):', (err as Error).message);
  }

  // 4) Durable trace on the project timeline.
  try {
    const owner = await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
    );
    if (owner[0]?.owner_user_id) {
      await recordEvent({
        userId: owner[0].owner_user_id,
        projectId,
        eventType: result.failed ? 'document_digest_failed' : 'document_digested',
        payload: {
          filename, fact_id: factId, staged_items: result.staged_items,
          watcher_proposals: result.watcher_proposals, chunks: result.chunks,
          total_chunks: result.total_chunks, partial: result.partial,
        },
      });
    }
  } catch { /* non-fatal */ }

  return result;
}
