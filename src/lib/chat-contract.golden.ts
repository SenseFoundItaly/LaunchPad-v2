// ============================================================================
// Golden scenarios for the chat artifact-contract eval (GitHub #235).
//
// Each scenario is a founder turn (or short thread) chosen because it stresses
// a DIFFERENT part of the contract — the states where the contract has actually
// broken before, not a random sample of chat. Keep them few and load-bearing:
// every scenario is a real Sonnet turn and costs money.
// ============================================================================

export interface ContractScenario {
  name: string;
  /** Why this scenario exists — which contract rule it stresses. */
  stresses: string;
  /** Founder messages, sent in order on one thread. */
  turns: string[];
  /**
   * Beginner register (Tier 0.25) ⇒ the ~180-word prose cap applies. Short,
   * plain, non-technical messages are what triggers it in the prompt.
   */
  beginner?: boolean;
  locale?: 'en' | 'it';
}

export const CONTRACT_SCENARIOS: ContractScenario[] = [
  {
    name: 'brand-new project, beginner register',
    stresses: 'Tier 1.5 opener + the 180-word cap + trailing option-set on turn 1',
    beginner: true,
    turns: ['i have an idea for an app that helps dog owners find walkers nearby. what now?'],
  },
  {
    name: 'canvas mid-shape follow-up',
    stresses: 'follow-up turn still ends with prose + option-set (no CTA drop on turn 2)',
    beginner: true,
    turns: [
      'i want to build a tool that helps small cafes track their waste',
      'yes that sounds right. what should i do first?',
    ],
  },
  {
    name: 'stage-named jump (fundraising)',
    stresses: 'stage-advance intent → skill PROPOSED as an option, never named "skill" to the founder',
    turns: ['I want to move to fundraising — what do I need to close that stage?'],
  },
  {
    name: 'explicit analysis request',
    stresses: 'TIER 0.5 skill-first: option carries skill_id, label says "analysis" not "skill"',
    turns: ['Run market research for me — I need real numbers on the EU pet-care market.'],
  },
  {
    name: 'credits question',
    stresses: 'CREDITS rule: never quote a per-action cost, no credits field on options',
    turns: ['How much does it cost me to run one of these analyses?'],
  },
  {
    name: 'experienced founder, dense message',
    stresses: 'full-depth treatment (no word cap) but the trailing option-set is still mandatory',
    turns: [
      'B2B SaaS for freight forwarders, €180k ARR, 14 logos, 4.1% monthly churn, CAC €2,400, ACV €13k, 62% gross margin. Churn is my problem. Where do I focus?',
    ],
  },
  {
    name: 'founder-stated numbers (provenance honesty)',
    stresses: 'founder-claimed metrics must be type:"user" sources, not laundered as web/skill',
    turns: ['We did 40 interviews and 31 said they would pay 50 euros a month. Put that in my numbers.'],
  },
  {
    name: 'Italian locale',
    stresses: 'contract holds in IT — "skill" must not leak in any language, artifacts still emitted',
    locale: 'it',
    beginner: true,
    turns: ['ho un\'idea per un\'app che aiuta i piccoli negozi a gestire le scorte. da dove comincio?'],
  },
  {
    name: 'vague one-liner',
    stresses: 'low-signal input still produces prose + a trailing option-set (no dead turn)',
    beginner: true,
    turns: ['not sure what to do next'],
  },
  {
    name: 'research question (web_search path)',
    stresses: 'post-tool synthesis: a turn that fires tools must still close with prose + option-set',
    turns: ['How big is the EU market for electric cargo bikes? Give me sourced numbers.'],
  },
];
