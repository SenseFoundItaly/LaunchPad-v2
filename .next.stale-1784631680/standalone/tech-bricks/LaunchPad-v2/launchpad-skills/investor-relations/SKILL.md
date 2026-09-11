---
name: investor-relations
description: Manages fundraising pipeline, meeting prep, term sheet analysis, and investor communications
---

<!-- sources-required-block -->
## Source Requirements (MANDATORY)

Every factual claim in the output of this skill MUST cite at least one source. This applies to:

- Numbers (market sizes, percentages, timelines, costs, benchmarks)
- Named entities (competitors, regulations, tools, companies, people)
- External-world claims (trends, dates, events, expert opinions)
- Every risk, score dimension, recommendation, and workflow step

**Source schema** (include as a `sources: Source[]` field at every factual level of the output JSON, not just the top):

```ts
type Source =
  | { type: 'web'; title: string; url: string; accessed_at?: string; quote?: string }
  | { type: 'skill'; title: string; skill_id: string; run_id?: string; quote?: string }
  | { type: 'internal'; title: string; ref: 'graph_node'|'score'|'research'|'memory_fact'|'chat_turn'; ref_id: string; quote?: string }
  | { type: 'user'; title: string; chat_turn_id?: string; quote: string }
  | { type: 'inference'; title: string; based_on: Source[]; reasoning: string };
```

**Rules:**
1. No invented numbers, URLs, or company names. If you don't have a source, say so plainly — never fabricate.
2. Web sources must carry the verbatim URL — don't paraphrase.
3. Use `type: 'internal'` when citing the founder's own project data (scores, research rows, memory facts).
4. Use `type: 'user'` when quoting the founder verbatim from chat.
5. `type: 'inference'` is allowed ONLY when `based_on` is non-empty; `reasoning` must explain the synthesis chain.
6. Attach sources at BOTH the top level (skill-wide provenance) AND at each nested factual entry (per-risk, per-dimension, per-competitor).
7. A claim without a source is a rejected claim. The UI will display it as "UNSOURCED — discarded" and the parser will drop it from persistence.


# Investor Relations

Manage the full fundraising lifecycle: building an investor pipeline, preparing for meetings, analyzing term sheets, drafting updates, and maintaining relationships. This skill treats fundraising as a structured sales process, not a series of random conversations.

## When to Use

- Founder is planning or actively running a fundraising round
- Preparing for an investor meeting (first meeting, partner meeting, or follow-up)
- Received a term sheet and needs analysis
- Drafting monthly or quarterly investor updates
- Managing follow-ups and pipeline tracking
- Evaluating whether it is the right time to raise

## Instructions

### Fundraising Philosophy

1. **Fundraising is a means, not an end.** The goal is to get the capital needed to hit the next milestone, not to maximize valuation or collect logos. Help founders stay focused on what matters.

2. **Run it like a sales pipeline.** Track investors by stage, set next actions, follow up systematically. Founders who treat fundraising casually take twice as long to close.

3. **Optimize for speed once you start.** A fundraise should take 4-8 weeks, not 6 months. Create urgency through parallel conversations and clear timelines.

4. **Right investors matter more than any investors.** An investor who understands the space, adds strategic value, and moves quickly is worth more than a bigger check from a slow, disengaged firm.

### Pipeline Management

Track each investor contact through these stages:

1. **Identified** -- On the target list, no outreach yet
2. **Reached Out** -- Initial email or intro sent
3. **First Meeting** -- Meeting scheduled or completed
4. **Follow-Up** -- Additional meetings, due diligence, or information requests
5. **Term Sheet** -- Received a term sheet
6. **Committed** -- Verbal or written commitment
7. **Closed** -- Money wired
8. **Passed** -- Investor declined (track reason for pattern analysis)

For each investor, track:
- Name, firm, contact info
- Investment thesis (does it align?)
- Stage and check size range
- Warm intro path (who can introduce you?)
- Current status and last interaction date
- Next action and due date
- Notes from conversations
- Red flags or concerns raised

### Meeting Preparation

Before any investor meeting, prepare:

#### First Meeting Prep
- **Research the investor:** What have they invested in? What is their thesis? What do they care about? Have they invested in competitors or adjacent companies?
- **Tailor the pitch:** Emphasize aspects that align with their thesis. If they focus on technical moats, lead with technology. If they focus on market size, lead with TAM.
- **Prepare for likely questions:** Based on the investor's portfolio and public statements, anticipate their concerns.
- **Know your numbers cold:** Revenue, growth rate, burn, runway, CAC, LTV, retention. If you hesitate on any number, practice until you do not.
- **Have a clear ask:** Know how much you are raising, at what terms, and what the money will fund.

#### Partner Meeting Prep
- **Anticipate the skeptics:** At least one partner will play devil's advocate. Prepare for the hardest version of every question.
- **Prepare a deeper narrative:** Partner meetings are longer. Have the extended version of traction, market, and competitive analysis ready.
- **Reference check yourself:** Assume they will call your customers, former colleagues, and other investors. Alert your references.

#### Follow-Up Meeting Prep
- **Address concerns from previous meeting:** Do not wait for them to re-raise issues. Proactively show you have addressed their feedback.
- **Show progress since last meeting:** Even if it has only been a week, demonstrate momentum.
- **Move toward commitment:** Every follow-up should advance toward a decision. If it is not, the investor may be stringing you along.

### Term Sheet Analysis

When a founder receives a term sheet, analyze it for:

#### Standard SAFE Terms (Pre-Seed / Seed)
Flag anything that deviates from standard Y Combinator SAFE terms:
- **Valuation cap:** Is it reasonable for the stage and market?
- **Discount:** Standard is 20%. Flag if higher.
- **Pro-rata rights:** Standard for lead investors. Flag if requested by small checks.
- **MFN (Most Favored Nation):** Standard and founder-friendly.
- **Side letters:** Review any additional terms carefully.

#### Priced Round Terms (Seed / Series A+)
Review and flag unusual provisions:
- **Valuation and dilution:** Calculate post-money ownership for founders
- **Liquidation preference:** 1x non-participating is standard. Flag participating preferred, multiple liquidation preferences, or anything above 1x.
- **Anti-dilution:** Broad-based weighted average is standard. Flag full ratchet.
- **Board composition:** Founder-friendly at seed is 2 founders + 1 investor or 2 founders + 1 independent. Flag anything giving investors board control.
- **Protective provisions:** Standard provisions are normal. Flag unusually broad veto rights.
- **Option pool:** 10-15% is typical at seed. Flag if larger (dilutes founders more).
- **Drag-along / tag-along:** Standard. Flag unusual thresholds.
- **Information rights:** Quarterly financials is standard. Flag monthly board observer seats at seed.
- **Founder vesting:** If there is accelerated vesting on change of control, this is good. Flag reverse vesting that resets the clock.

For each flagged term, explain:
- What is standard
- What was offered
- Why it matters
- Recommended negotiating position

### Investor Update Drafting

Monthly or quarterly updates should follow this structure:

#### The Update Format
1. **TL;DR** (2-3 sentences): The single most important thing happening right now
2. **Highlights** (3-5 bullets): What went well this period
3. **Key Metrics** (table or list): Revenue, growth rate, users, burn, runway
4. **Challenges** (2-3 bullets): What is not going well and what you are doing about it
5. **Asks** (2-3 bullets): Specific ways investors can help (intros, advice, hiring)
6. **Looking Ahead** (2-3 bullets): What you are focused on next period

#### Update Principles
- Send consistently, even when news is bad. Especially when news is bad. Investors respect transparency.
- Keep it under 500 words. Investors read dozens of updates; respect their time.
- Make asks specific. Not "help with hiring" but "We are looking for a senior backend engineer with payment systems experience in the Bay Area. Know anyone?"
- Include a clear metric table that is consistent month to month so investors can track trends.

### Follow-Up Cadence

- **After first meeting (no response in 3 days):** Brief follow-up referencing something specific from the conversation
- **After sending materials (no response in 5 days):** Follow up with a new data point or milestone
- **After partner meeting (no response in 7 days):** Direct ask for timeline on decision
- **After term sheet sent to you (respond within 48 hours):** Even if just to acknowledge receipt and set a timeline for response
- **Passed investors (after 3 months):** Brief update on progress. Some investors who passed early re-engage when traction improves

### Timing Guidance

Help founders evaluate whether now is the right time to raise:

**Good signals to raise:**
- Strong growth trajectory (ideally 15%+ MoM for 3+ months)
- Clear use of funds that will drive growth
- Market timing advantage that requires capital now
- Less than 6 months of runway remaining (but more than 3)

**Bad signals to raise:**
- Raising to "figure things out" without clear milestones
- No traction and no differentiated insight
- Raising because other startups are raising
- Less than 3 months runway (desperation raises yield bad terms)

## Output Format

### Pipeline Status

```json
{
  "fundraising_pipeline": {
    "round": "Pre-Seed | Seed | Series A",
    "target_amount": "$X",
    "raised_to_date": "$X",
    "pipeline_summary": {
      "identified": 0,
      "reached_out": 0,
      "first_meeting": 0,
      "follow_up": 0,
      "term_sheet": 0,
      "committed": 0,
      "closed": 0,
      "passed": 0
    },
    "investors": [
      {
        "name": "Investor Name",
        "firm": "Firm Name",
        "stage": "identified | reached_out | first_meeting | follow_up | term_sheet | committed | closed | passed",
        "check_size": "$X",
        "thesis_fit": "strong | moderate | weak",
        "intro_path": "How to reach them",
        "last_interaction": "ISO date",
        "next_action": "What to do next",
        "next_action_due": "ISO date",
        "notes": "Key context",
        "pass_reason": "If applicable"
      }
    ],
    "pass_pattern_analysis": "Common themes from investors who passed",
    "momentum_assessment": "Are conversations accelerating or stalling?"
  }
}
```

### Term Sheet Analysis

```json
{
  "term_sheet_analysis": {
    "investor": "Firm Name",
    "round_type": "SAFE | Priced Round",
    "headline_terms": {
      "amount": "$X",
      "valuation_cap": "$X (SAFE) or pre-money $X (priced)",
      "dilution_to_founders": "X%"
    },
    "flags": [
      {
        "term": "Term name",
        "what_is_standard": "Normal market term",
        "what_was_offered": "What this term sheet says",
        "severity": "informational | caution | red_flag",
        "recommendation": "What to negotiate"
      }
    ],
    "overall_assessment": "founder-friendly | market-standard | investor-favorable | concerning",
    "negotiation_priorities": ["Most important terms to push back on"],
    "recommendation": "Accept | Negotiate specific terms | Walk away"
  }
}
```

### Investor Update Draft

```json
{
  "investor_update": {
    "period": "Month/Quarter Year",
    "tldr": "2-3 sentence summary",
    "highlights": ["Highlight 1", "Highlight 2"],
    "metrics": {
      "mrr": "$X (X% MoM growth)",
      "users": "X (X% MoM growth)",
      "burn": "$X/month",
      "runway": "X months",
      "other_metrics": {}
    },
    "challenges": [
      {"challenge": "Description", "action": "What we are doing about it"}
    ],
    "asks": [
      {"ask": "Specific request", "context": "Why this matters"}
    ],
    "looking_ahead": ["Focus area 1", "Focus area 2"],
    "word_count": 0
  }
}
```

## Examples

### Example: Term Sheet Red Flag

**Founder:** "We got a term sheet! $500K SAFE with a $4M cap and 2x liquidation preference."

**Agent response:** Congratulations on the term sheet. Let me flag something important.

A 2x liquidation preference on a SAFE is a significant red flag. Standard SAFEs (the Y Combinator template that is the market norm) do not have liquidation preferences at all. A SAFE converts into equity at the next priced round, and the liquidation preference is set at that point (standard is 1x non-participating).

What this means: if the company sells for $8M, this investor gets $1M back (2x their $500K) before anyone else sees a dollar. On a $500K check, this might seem small, but it sets a precedent. If every subsequent investor demands 2x, the preference stack becomes punishing in any exit below a home run.

**My recommendation:** Push back firmly. Ask for a standard YC SAFE with no liquidation preference language (it is not part of the template). If the investor insists on a preference, 1x non-participating is the maximum you should accept at this stage. If they will not budge, this is a signal about how they will behave as an investor going forward.

### Example: Follow-Up Reminder

**Agent:** Three investor follow-ups are overdue:

1. **Sarah Chen (Sequoia)** -- First meeting was 5 days ago. She asked for your retention cohort data. Send the data with a brief note: "Following up on our conversation Tuesday. Attached are the retention cohorts you asked about. Happy to discuss -- free Thursday or Friday?"

2. **Marcus Williams (a16z)** -- Partner meeting was 8 days ago with no response. This is concerning. Send a direct note: "Hi Marcus, checking in on next steps from our partner meeting last week. We are targeting to close the round by [date]. Would love to understand your timeline."

3. **Lisa Park (Angel)** -- Committed $50K verbally 12 days ago but has not wired. Send: "Hi Lisa, just following up on logistics. Our counsel can send the SAFE for signature whenever you are ready. Happy to answer any remaining questions."
