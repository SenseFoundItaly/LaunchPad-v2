---
name: pitch-coaching
description: Helps founders build and iterate on pitch decks with investor-ready storytelling and data
---

# Pitch Coaching

Help founders craft compelling pitch decks through iterative feedback. This skill focuses on clarity, narrative structure, data-driven claims, and investor psychology. It covers both full pitch decks and Demo Day format (1-minute pitch).

## When to Use

- Founder is preparing a pitch deck for fundraising
- Founder has a Demo Day or pitch competition coming up
- After receiving investor feedback that needs to be incorporated
- When transitioning between fundraising stages (pre-seed to seed, seed to Series A)
- When the story has changed (pivot, new traction data, team changes)

## Instructions

### Pitch Philosophy

1. **Story first, slides second.** A great pitch is a narrative, not a slideshow. The founder should be able to tell the story without any slides. Slides reinforce the story; they do not replace it.

2. **Every claim needs evidence.** "Huge market" means nothing. "$4.2B market growing 23% annually" means something. "Customers love us" means nothing. "NPS of 72 with 40% monthly active usage" means something.

3. **Investors fund trajectories, not snapshots.** Show momentum. Week-over-week growth, accelerating metrics, expanding use cases. Static numbers are less compelling than trends.

4. **Know the audience.** A pitch to a pre-seed angel is different from a pitch to a Series A firm. Adjust emphasis, depth, and ask accordingly.

5. **Honesty builds trust.** Do not hide weaknesses. Acknowledge them and explain how you plan to address them. Investors will find the holes anyway -- better to show you are aware and have a plan.

### Full Pitch Deck Structure (10-12 slides)

Coach the founder through each section:

#### Slide 1: Title
- Company name, one-line description, founder name
- The one-liner should communicate what the company does, not what it aspires to be

#### Slide 2: Problem
- Specific, relatable pain point
- Quantify the cost of the problem (time, money, frustration)
- Show that this is a real problem experienced by real people, not a theoretical inconvenience
- Use a concrete story or data point to make it visceral

#### Slide 3: Solution
- What the product does in plain language
- Show the product (screenshot, demo, or diagram)
- Connect directly back to the problem -- how does this solve it specifically?
- Avoid technical jargon unless pitching to technical investors

#### Slide 4: Market Size
- TAM/SAM/SOM with bottoms-up math (reference market-research skill output)
- Show the math, do not just state numbers
- "Why now?" -- what has changed that makes this the right time

#### Slide 5: Business Model
- How the company makes money
- Pricing and unit economics
- If pre-revenue, explain the monetization hypothesis and any validation

#### Slide 6: Traction
- The most important slide for seed and beyond
- Metrics that matter: revenue, users, growth rate, retention, engagement
- Show trajectory, not just current state
- If pre-traction, show validation signals (waitlist, LOIs, pilot results)

#### Slide 7: Product / How It Works
- Deeper dive into the product experience
- Customer workflow or use case walkthrough
- Key differentiation visible in the product itself

#### Slide 8: Competition
- Competitor landscape (2x2 matrix or similar visualization)
- Honest assessment of competitors
- Clear articulation of differentiation
- Never say "we have no competitors" -- that signals either naivete or no market

#### Slide 9: Team
- Relevant experience and domain expertise
- Why this team is uniquely positioned to win
- Key hires planned (shows you know what you need)
- Advisors if notable

#### Slide 10: Financials
- Revenue projections (18-36 months for early stage)
- Key assumptions clearly stated
- Burn rate and runway
- Path to profitability or next milestone

#### Slide 11: The Ask
- How much are you raising?
- What will the funds be used for? (hiring, product, growth -- be specific)
- What milestones will this funding enable?
- What is the target timeline for the raise?

#### Slide 12: Appendix (optional)
- Detailed financial model
- Additional metrics
- Technical architecture (if relevant)
- Customer testimonials

### Demo Day Format (1-Minute Pitch)

Structure for a 60-second pitch:

1. **Hook (5 seconds):** One sentence that makes the audience pay attention. A surprising stat, a relatable problem, or a bold claim.
2. **Problem (10 seconds):** The pain point, concisely. One sentence.
3. **Solution (10 seconds):** What you built. One sentence.
4. **Traction (15 seconds):** Your strongest proof point. Revenue, growth, users, notable customer.
5. **Market (5 seconds):** Size of the opportunity. One number.
6. **Ask (10 seconds):** What you are raising and what it enables.
7. **Close (5 seconds):** Memorable final line that reinforces the core message.

Total: ~60 seconds. Every word must earn its place.

### Feedback and Iteration Process

When reviewing a pitch draft:

1. **Read/listen to the full pitch first** before giving feedback.
2. **Start with what works.** Identify the strongest moments.
3. **Identify the single biggest weakness.** Do not give 15 pieces of feedback. Focus on the one change that would have the most impact.
4. **Be specific.** Not "the traction slide is weak" but "the traction slide shows total sign-ups but not growth rate or retention. Add a chart showing weekly active users over the last 12 weeks."
5. **Provide a rewrite option.** Do not just say what is wrong -- show what a stronger version looks like.
6. **After major feedback is addressed, move to polish.** Word choice, slide design principles, timing.

### Incorporating Investor Feedback

When a founder reports feedback from a real investor meeting:

1. **Separate the signal from the noise.** Not all investor feedback is useful. Some reflects the investor's thesis mismatch, not a real weakness.
2. **Look for patterns.** If three investors raise the same concern, it is a real issue. If one investor has a unique objection, it might just be their perspective.
3. **Categorize feedback:** Must-address (factual errors, missing data), should-address (legitimate concerns about the narrative), and consider-but-may-ignore (style preferences, thesis mismatches).
4. **Update the deck** and explain what changed and why.

## Output Format

### Pitch Review

```json
{
  "pitch_review": {
    "overall_assessment": "Strong | Needs Work | Major Revision Needed",
    "narrative_score": "1-10: Does the pitch tell a compelling story?",
    "data_score": "1-10: Are claims supported by evidence?",
    "clarity_score": "1-10: Would a non-expert understand this?",
    "strongest_moment": "The most compelling part of the pitch",
    "biggest_weakness": "The single most impactful thing to fix",
    "slide_feedback": [
      {
        "slide": "Slide name",
        "status": "strong | needs_improvement | missing | cut",
        "feedback": "Specific feedback",
        "suggested_revision": "What a stronger version looks like"
      }
    ],
    "investor_readiness": "ready | almost | not_yet",
    "next_steps": ["Prioritized action items"]
  }
}
```

### Demo Day Pitch Draft

```json
{
  "demo_day_pitch": {
    "hook": "Opening line",
    "problem": "Problem statement",
    "solution": "Solution statement",
    "traction": "Key proof point",
    "market": "Market size",
    "ask": "Fundraising ask",
    "close": "Closing line",
    "total_word_count": 0,
    "estimated_duration_seconds": 0,
    "coaching_notes": "Delivery tips"
  }
}
```

## Examples

### Example: Weak Traction Slide

**Founder:** "Here's our traction slide. We have 1,200 sign-ups."

**Agent response:** Sign-ups alone do not tell investors much. 1,200 sign-ups could be impressive or concerning depending on context. Here is what is missing and what would make this slide compelling:

**Current slide (weak):** "1,200 sign-ups"

**Revised slide (strong):**
- 1,200 sign-ups, 340 weekly active users (28% activation rate)
- Growing 12% week-over-week for the last 8 weeks
- 45% 30-day retention (above SaaS benchmark of 35%)
- 3 paying customers at $200/month (organic, no sales team)
- Chart showing WAU growth trajectory

The numbers do not have to be huge at pre-seed. They have to show a pattern: people sign up, they actually use it, they come back, and some are willing to pay. That is the story of early product-market fit.

If you do not have activation or retention data yet, be honest about it: "1,200 sign-ups in 6 weeks with zero marketing spend. We are now focused on activation and retention metrics." That shows awareness.

### Example: Demo Day Coaching

**Agent:** Here is your 60-second pitch. Read it aloud and time yourself:

"Every week, 200,000 dental practices in America waste 4 hours playing phone tag to schedule appointments. That is $8 billion in lost productivity annually.

DentSchedule uses AI to handle 90% of scheduling calls automatically. No app download, no behavior change for patients -- they call the same number and our AI handles the rest.

In 4 months, we have 23 dental practices live, processing 1,400 calls per week. Our average practice saves 6 hours per week and our churn rate is zero.

The dental practice software market is $4 billion and scheduling is the entry point to a full practice management suite.

We are raising $1.5 million to expand to 500 practices and launch our second product module.

If you want to back the company replacing the most hated job in every dental office in America, let's talk."

**Word count:** 142. **Estimated duration:** 58 seconds. Practice until you can deliver it in exactly 60 seconds with natural pacing. Pause slightly after the hook and before the close.
