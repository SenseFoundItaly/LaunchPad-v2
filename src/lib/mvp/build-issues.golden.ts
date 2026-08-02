// ============================================================================
// Golden set for the feedback-intake classifier (build-issues.classifyFeedback).
//
// The classifier's match-or-spawn decision is a REAL LLM judgment that drives
// founder-visible behaviour and spend:
//   - over-merging  → unrelated complaints collapse; the roadmap lies, and the
//                     evidence counter (which gates iteration spend) inflates.
//   - under-merging → the backlog fragments into near-duplicates; evidence
//                     never accumulates, so nothing ever clears the threshold.
// The dangerous direction is OVER-merging (a wrong merge is invisible to the
// founder), which is why the prompt says "be conservative" and why the eval
// scores false-merges separately with a tighter floor.
//
// Cases are grouped by failure mode, not by feature, so a regression points at
// a behaviour rather than a topic.
// ============================================================================

export interface GoldenIssue {
  id: string;
  feature: string;
  title: string;
}

export interface GoldenCase {
  /** Stable name — shows up in the eval scorecard. */
  name: string;
  /** Failure mode this case guards. */
  mode: 'synonym-merge' | 'same-area-different-request' | 'fresh-spawn' | 'adversarial' | 'noise';
  /** Feedback text as a founder/interview/watcher would phrase it. */
  body: string;
  /** Open issues visible to the classifier at decision time. */
  open: GoldenIssue[];
  /** 'match' + the id it must pick, or 'spawn' (must NOT match anything). */
  expect: { type: 'match'; id: string } | { type: 'spawn' };
}

const PRICING: GoldenIssue = { id: 'i_pricing_find', feature: 'Pricing', title: 'Make the pricing page easy to find' };
const SIGNUP: GoldenIssue = { id: 'i_signup_fields', feature: 'Onboarding', title: 'Reduce the number of signup fields' };
const MOBILE: GoldenIssue = { id: 'i_mobile_nav', feature: 'Navigation', title: 'Fix the mobile navigation menu' };
const SPEED: GoldenIssue = { id: 'i_dashboard_slow', feature: 'Performance', title: 'Speed up the dashboard load' };
const BASE = [PRICING, SIGNUP, MOBILE, SPEED];

export const GOLDEN_CASES: GoldenCase[] = [
  // ── SYNONYM MERGE: same underlying request, different words. Must match. ──
  { name: 'pricing hidden — plain restatement', mode: 'synonym-merge', open: BASE, expect: { type: 'match', id: PRICING.id },
    body: "Users can't find the pricing page anywhere on the site." },
  { name: 'pricing hidden — user-reported', mode: 'synonym-merge', open: BASE, expect: { type: 'match', id: PRICING.id },
    body: 'Three testers asked me how much it costs — they never found the pricing.' },
  { name: 'pricing hidden — navigation framing', mode: 'synonym-merge', open: BASE, expect: { type: 'match', id: PRICING.id },
    body: 'There is no link to pricing from the homepage nav, people give up looking.' },
  { name: 'signup friction — restatement', mode: 'synonym-merge', open: BASE, expect: { type: 'match', id: SIGNUP.id },
    body: 'The signup form asks for way too much information up front.' },
  { name: 'signup friction — drop-off framing', mode: 'synonym-merge', open: BASE, expect: { type: 'match', id: SIGNUP.id },
    body: 'People abandon registration halfway — too many boxes to fill in.' },
  { name: 'mobile nav — restatement', mode: 'synonym-merge', open: BASE, expect: { type: 'match', id: MOBILE.id },
    body: "The hamburger menu doesn't open properly on my phone." },
  { name: 'dashboard slow — restatement', mode: 'synonym-merge', open: BASE, expect: { type: 'match', id: SPEED.id },
    body: 'The dashboard takes forever to load, like 8 seconds.' },
  { name: 'interview-sourced phrasing', mode: 'synonym-merge', open: BASE, expect: { type: 'match', id: PRICING.id },
    body: 'Interview pain (SMB owner): could not locate pricing information on the site.' },

  // ── SAME AREA, DIFFERENT REQUEST: the dangerous over-merge. Must spawn. ──
  { name: 'pricing TOO HIGH ≠ pricing hidden', mode: 'same-area-different-request', open: BASE, expect: { type: 'spawn' },
    body: 'The pricing is way too expensive for small teams — we need a cheaper tier.' },
  { name: 'annual billing ≠ pricing hidden', mode: 'same-area-different-request', open: BASE, expect: { type: 'spawn' },
    body: 'Add an annual billing option with a discount.' },
  { name: 'social login ≠ fewer signup fields', mode: 'same-area-different-request', open: BASE, expect: { type: 'spawn' },
    body: 'Let people sign up with Google instead of email and password.' },
  { name: 'email verification ≠ fewer signup fields', mode: 'same-area-different-request', open: BASE, expect: { type: 'spawn' },
    body: 'Nobody confirms their email — we should send a verification link after signup.' },
  { name: 'desktop layout ≠ mobile nav', mode: 'same-area-different-request', open: BASE, expect: { type: 'spawn' },
    body: 'On a wide desktop screen the content is squeezed into a narrow column.' },
  { name: 'search ≠ mobile nav', mode: 'same-area-different-request', open: BASE, expect: { type: 'spawn' },
    body: 'There is no way to search — I want a search bar in the header.' },
  { name: 'export slow ≠ dashboard slow', mode: 'same-area-different-request', open: BASE, expect: { type: 'spawn' },
    body: 'Exporting a CSV report times out when there are many rows.' },

  // ── FRESH SPAWN: nothing related is open. Must spawn. ──
  { name: 'dark mode (empty backlog)', mode: 'fresh-spawn', open: [], expect: { type: 'spawn' },
    body: 'Please add a dark mode.' },
  { name: 'waitlist (empty backlog)', mode: 'fresh-spawn', open: [], expect: { type: 'spawn' },
    body: 'I want a waitlist signup instead of a checkout for now.' },
  { name: 'unrelated area with backlog present', mode: 'fresh-spawn', open: BASE, expect: { type: 'spawn' },
    body: 'We need a way to invite teammates to a shared workspace.' },
  { name: 'accessibility request', mode: 'fresh-spawn', open: BASE, expect: { type: 'spawn' },
    body: 'The contrast is too low, a colour-blind tester could not read the buttons.' },
  { name: 'legal/compliance request', mode: 'fresh-spawn', open: BASE, expect: { type: 'spawn' },
    body: 'We need a cookie consent banner for EU visitors.' },
  { name: 'watcher-sourced change', mode: 'fresh-spawn', open: BASE, expect: { type: 'spawn' },
    body: 'Live app monitor detected a high-significance change: the checkout page now returns a 500 error.' },

  // ── ADVERSARIAL: superficially similar wording, different intent. Spawn. ──
  { name: 'the word "pricing" but about copy', mode: 'adversarial', open: BASE, expect: { type: 'spawn' },
    body: 'The pricing page wording is confusing — rewrite the plan descriptions in plainer language.' },
  { name: 'the word "signup" but about email', mode: 'adversarial', open: BASE, expect: { type: 'spawn' },
    body: 'After signup nobody gets a welcome email — add an onboarding email sequence.' },
  { name: 'the word "mobile" but about performance', mode: 'adversarial', open: BASE, expect: { type: 'spawn' },
    body: 'On mobile data the app takes ages to load the first screen.' },
  { name: 'the word "dashboard" but about content', mode: 'adversarial', open: BASE, expect: { type: 'spawn' },
    body: 'The dashboard shows the wrong currency for European users.' },

  // ── NOISE: vague praise/telemetry with no actionable request. Spawn is the
  //    acceptable outcome (a wrong MERGE would corrupt an existing issue's
  //    evidence count, which is the failure we actually care about here). ──
  { name: 'vague praise', mode: 'noise', open: BASE, expect: { type: 'spawn' },
    body: 'Looks great overall, nice work!' },
  { name: 'ambiguous one-liner', mode: 'noise', open: BASE, expect: { type: 'spawn' },
    body: 'It feels a bit clunky.' },
];

/** Cases where a WRONG MERGE is the failure we most need to prevent. */
export const FALSE_MERGE_MODES = new Set(['same-area-different-request', 'adversarial']);
