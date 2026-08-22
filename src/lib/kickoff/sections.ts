/**
 * The seven sections — and the audit that makes them worth reading.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The competitor teardown (docs/audos-teardown.md) captured a real workspace
 * after a full kickoff interview: of seven sections, TWO had content. The other
 * five said "Nothing here yet — this section fills in as you and Otto work".
 * The founder had answered every question and still faced five empty boxes.
 *
 * So the gap is not the interview. It is that nobody dares fill a section they
 * were not explicitly told about. We fill all seven from one or two answers —
 * and the reason we can do that honestly is `confidence`: a section derived
 * from an assumption says so, in the founder's face, next to the text.
 *
 * A filled section with a named risk beats an empty box. An unmarked guess does
 * not — which is why `confidence` is required, not optional.
 */

/** The canvas column a section promotes into, if the founder clicks. */
export type CanvasField =
  | 'problem' | 'solution' | 'target_market'
  | 'business_model' | 'channels' | 'competitive_advantage';

/**
 * Where a section's content actually came from. This is the audit.
 *
 * Deliberately three rungs, not a 0-100 score. A percentage invites the reader
 * to average it away ("78% confident overall") — the whole point is that ONE
 * assumed section can sink the idea, and averaging hides exactly that.
 */
export type Confidence =
  /** The founder said it. Traceable to their own words. */
  | 'grounded'
  /** Derived from what the founder said — a defensible step, not a fact. */
  | 'inferred'
  /** Filled to keep the plan whole. Nothing the founder said supports it. */
  | 'assumed';

export const CONFIDENCE_ORDER: readonly Confidence[] = ['grounded', 'inferred', 'assumed'];

export interface SectionDef {
  id: string;
  label: string;
  labelIt: string;
  /** One line under the heading — what this section is for. */
  blurb: string;
  blurbIt: string;
  promotesTo?: CanvasField;
}

export const SECTIONS: readonly SectionDef[] = [
  {
    id: 'founder_fit',
    label: 'Founder fit',
    labelIt: 'Perché tu',
    blurb: 'Why you, for this customer.',
    blurbIt: 'Perché proprio tu, per questo cliente.',
  },
  {
    id: 'customer',
    label: 'Customer',
    labelIt: 'Il cliente',
    blurb: 'Who you serve — and who pays.',
    blurbIt: 'Chi servi — e chi paga.',
    promotesTo: 'target_market',
  },
  {
    id: 'problem',
    label: 'Problem',
    labelIt: 'Il problema',
    blurb: 'The "it sucks that…" — in their words.',
    blurbIt: 'Il "che palle che…" — con parole loro.',
    promotesTo: 'problem',
  },
  {
    id: 'service_system',
    label: 'Service system',
    labelIt: 'Il servizio',
    blurb: 'Your offering as a system, not a feature list.',
    blurbIt: 'La tua offerta come sistema, non un elenco di funzioni.',
    promotesTo: 'solution',
  },
  {
    id: 'business_model',
    label: 'Business model',
    labelIt: 'Modello di business',
    blurb: 'Value capture, pricing, when charging starts.',
    blurbIt: 'Come catturi valore, prezzo, quando inizi a far pagare.',
    promotesTo: 'business_model',
  },
  {
    id: 'gtm',
    label: 'Go-to-market',
    labelIt: 'Go-to-market',
    blurb: 'Channels, message, and the alternative you beat.',
    blurbIt: 'Canali, messaggio, e l\'alternativa che batti.',
    promotesTo: 'channels',
  },
  {
    id: 'relationship_capital',
    label: 'Relationship capital',
    labelIt: 'Capitale relazionale',
    blurb: 'The compounding moat: intimacy, community, trust.',
    blurbIt: 'Il fossato che si accumula: intimità, community, fiducia.',
    promotesTo: 'competitive_advantage',
  },
] as const;

export const SECTION_IDS: readonly string[] = SECTIONS.map((s) => s.id);

export interface Section {
  text: string;
  /** The single thing that would make this section WRONG. Required. */
  risk: string;
  confidence: Confidence;
  updatedAt: string;
}

export type Sections = Record<string, Section>;

export function sectionById(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}

/** Normalise whatever came out of JSONB, dropping junk keys and bad shapes. */
export function coerceSections(raw: unknown): Sections {
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const out: Sections = {};
  for (const id of SECTION_IDS) {
    const v = src[id];
    if (!v || typeof v !== 'object') continue;
    const s = v as Record<string, unknown>;
    const text = typeof s.text === 'string' ? s.text.trim() : '';
    if (text.length < 3) continue;
    const confidence = CONFIDENCE_ORDER.includes(s.confidence as Confidence)
      ? (s.confidence as Confidence)
      // An unreadable confidence must degrade DOWNWARD. Reading a corrupt row
      // as 'grounded' would launder a guess into a fact — the exact failure
      // this column exists to prevent.
      : 'assumed';
    out[id] = {
      text: text.slice(0, 4000),
      risk: typeof s.risk === 'string' ? s.risk.trim().slice(0, 600) : '',
      confidence,
      updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '',
    };
  }
  return out;
}

export interface AuditSummary {
  filled: number;
  total: number;
  grounded: number;
  inferred: number;
  assumed: number;
  /** Sections carrying a named risk — the ones worth opening first. */
  risks: { id: string; label: string; risk: string; confidence: Confidence }[];
  /** True once every section has content. Not a claim that they are RIGHT. */
  complete: boolean;
}

/**
 * The audit, DERIVED — no stored status, for the same reason as `kickoffProgress`.
 *
 * Note what this deliberately does NOT produce: a single score. Seven sections
 * where six are grounded and one is assumed is not "86% validated" — it is one
 * unexamined assumption holding up a plan, and the founder needs to see THAT,
 * not an average that buries it.
 */
export function auditSummary(sections: Sections): AuditSummary {
  const filled = SECTIONS.filter((s) => sections[s.id]?.text);
  const count = (c: Confidence) => filled.filter((s) => sections[s.id].confidence === c).length;
  return {
    filled: filled.length,
    total: SECTIONS.length,
    grounded: count('grounded'),
    inferred: count('inferred'),
    assumed: count('assumed'),
    risks: filled
      .filter((s) => sections[s.id].risk)
      .map((s) => ({
        id: s.id,
        label: s.label,
        risk: sections[s.id].risk,
        confidence: sections[s.id].confidence,
      }))
      // Riskiest first: assumed before inferred before grounded. The founder
      // reads top-down and should meet the weakest link first.
      .sort((a, b) => CONFIDENCE_ORDER.indexOf(b.confidence) - CONFIDENCE_ORDER.indexOf(a.confidence)),
    complete: filled.length === SECTIONS.length,
  };
}
