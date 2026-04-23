---
name: market-research
description: Conducts structured market research and competitive analysis with TAM/SAM/SOM sizing
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


# Market Research

Produce structured market research and competitive analysis grounded in available data. This skill helps founders move from guesses to informed estimates, and from "I think there are competitors" to a detailed competitive map.

## When to Use

- After idea shaping to validate market assumptions
- Before or after startup scoring to fill data gaps in Market Opportunity and Competitive Landscape dimensions
- When a founder is considering a pivot and needs to evaluate a new market
- When preparing pitch materials that require defensible market sizing
- Periodically to update competitive intelligence

## Instructions

### Research Principles

1. **Distinguish data from estimates.** When citing market sizes, be explicit about whether a number comes from a published report, a bottoms-up calculation, or an educated guess. Label each clearly.

2. **Bottoms-up over top-down.** A top-down TAM ("The global SaaS market is $200B") is nearly useless. Always attempt a bottoms-up calculation: number of potential customers multiplied by realistic annual spend.

3. **Name sources when possible.** If referencing industry reports, analyst estimates, or public company data, cite the source. If working from general knowledge, say so.

4. **Competitive analysis must be specific.** Do not say "there are many competitors." Name them. Describe what they do. Identify their strengths and weaknesses. Estimate their traction if possible.

5. **Identify what the founder can uniquely learn.** The most valuable market research often comes from talking to customers. Flag specific questions the founder should ask real people.

### Research Sections

#### 1. Market Sizing (TAM/SAM/SOM)

- **TAM (Total Addressable Market):** The total revenue opportunity if every possible customer in the world used the product. Use both top-down (industry reports) and bottoms-up (customer count x price) approaches.
- **SAM (Serviceable Addressable Market):** The portion of TAM reachable given the product's current capabilities, geography, and go-to-market. This is the realistic target market.
- **SOM (Serviceable Obtainable Market):** The portion of SAM the startup can realistically capture in the first 2-3 years given resources and competition. This should be conservative.

Show your math. A number without a calculation is just a guess.

#### 2. Competitor Profiling

For each significant competitor (aim for 3-7), document:

- **Company name and URL**
- **What they do** (one sentence)
- **Target customer** (who they serve)
- **Pricing** (if publicly available)
- **Estimated traction** (users, revenue, funding -- whatever is known)
- **Key strengths** (what they do well)
- **Key weaknesses** (where they fall short)
- **Funding history** (investors, amounts, stages)
- **Threat level** (low / medium / high) with reasoning

Also map competitors on a 2x2 matrix using the two most relevant dimensions for the market (e.g., price vs. feature depth, or SMB vs. enterprise and horizontal vs. vertical).

#### 3. Market Trends

Identify 3-5 relevant trends affecting this market:

- **Trend name and description**
- **Direction** (tailwind or headwind for the startup)
- **Timeframe** (immediate, 1-2 years, 3-5 years)
- **Evidence** (what data supports this trend)
- **Implication** (what this means for the startup's strategy)

#### 4. Case Studies

Identify 1-3 analogous companies or situations that offer lessons:

- **Company/situation** described
- **What happened** (narrative)
- **Key lesson** for the founder
- **Applicability** (how closely this maps to the founder's situation)

Look for both success stories and cautionary tales. A failed company in an adjacent space is often more instructive than a unicorn in a different market.

#### 5. Customer Insights

Based on available information, outline:

- **Buyer persona** (who makes the purchase decision)
- **User persona** (who uses the product daily, if different)
- **Purchase triggers** (what events cause someone to seek a solution)
- **Decision criteria** (what factors matter most in choosing a solution)
- **Objections** (common reasons to not buy)
- **Validation questions** (specific questions the founder should ask potential customers)

### Research Quality Standards

- Never present a single data point as definitive. Triangulate when possible.
- Acknowledge uncertainty explicitly. "Based on available data, the TAM appears to be between $500M and $2B" is more honest than "$1.2B TAM."
- Update previous research when new information arrives rather than starting from scratch.
- Flag when research is stale (market conditions change, new competitors emerge).

## Output Format

```json
{
  "market_research": {
    "market_sizing": {
      "tam": {
        "estimate": "$X",
        "methodology": "top-down | bottoms-up | blended",
        "calculation": "Step-by-step math",
        "confidence": "low | medium | high",
        "sources": ["Source 1", "Source 2"]
      },
      "sam": {
        "estimate": "$X",
        "methodology": "How SAM was derived from TAM",
        "constraints": ["Geographic", "Segment", "Product capability"]
      },
      "som": {
        "estimate": "$X",
        "timeframe": "2-3 years",
        "assumptions": ["Assumption 1", "Assumption 2"],
        "market_share_implied": "X%"
      }
    },
    "competitors": [
      {
        "name": "Competitor Name",
        "url": "https://...",
        "description": "One sentence",
        "target_customer": "Who they serve",
        "pricing": "Pricing info or 'unknown'",
        "traction": "Known metrics",
        "strengths": ["Strength 1"],
        "weaknesses": ["Weakness 1"],
        "funding": "Known funding history",
        "threat_level": "low | medium | high",
        "threat_reasoning": "Why this threat level"
      }
    ],
    "competitor_matrix": {
      "axis_x": "Dimension 1",
      "axis_y": "Dimension 2",
      "positions": {
        "Competitor Name": {"x": "low | mid | high", "y": "low | mid | high"}
      },
      "white_space": "Where the opportunity gap is"
    },
    "trends": [
      {
        "name": "Trend name",
        "description": "What is happening",
        "direction": "tailwind | headwind",
        "timeframe": "immediate | 1-2 years | 3-5 years",
        "evidence": "Supporting data",
        "implication": "What this means for the startup"
      }
    ],
    "case_studies": [
      {
        "company": "Company or situation name",
        "narrative": "What happened",
        "lesson": "Key takeaway",
        "applicability": "How this applies to the founder"
      }
    ],
    "customer_insights": {
      "buyer_persona": "Description",
      "user_persona": "Description",
      "purchase_triggers": ["Trigger 1"],
      "decision_criteria": ["Criterion 1"],
      "common_objections": ["Objection 1"],
      "validation_questions": ["Question the founder should ask real customers"]
    },
    "research_gaps": [
      "Information that could not be determined and how to fill it"
    ],
    "last_updated": "ISO date"
  }
}
```

## Examples

### Example: Bottoms-Up Market Sizing

**Founder:** "What's the market size for an AI scheduling tool for dentists?"

**Agent response:** Let me size this bottoms-up rather than quoting a generic "dental software market" number.

**Bottoms-up TAM calculation:**
- There are approximately 200,000 dental practices in the US (ADA data)
- Each practice would be one customer
- A scheduling tool in this space typically charges $200-500/month
- Midpoint: $350/month x 12 = $4,200/year per practice
- 200,000 x $4,200 = $840M US TAM

**SAM narrowing:**
- Your product is cloud-based, which excludes practices resistant to cloud software (estimate 30%)
- You are launching in English only, US market first
- Practices with fewer than 2 dentists may not need AI scheduling
- SAM estimate: ~80,000 practices = $336M

**SOM (3-year):**
- Capturing 1-2% of SAM in 3 years would be aggressive but achievable for a well-funded startup
- SOM: 800-1,600 practices = $3.4M-$6.7M ARR

This is a viable niche but not a venture-scale standalone market. You would need to expand to other medical specialties or build a broader practice management suite.

### Example: Competitor Red Flag

**Agent:** I need to flag something about your competitive landscape. Dentrix (Henry Schein) owns roughly 40% of the dental practice management market. They recently added AI scheduling to their existing platform. This is a significant headwind because:

1. Dentrix customers will get scheduling "for free" as a feature
2. The switching cost from an integrated suite to a standalone tool is high
3. Henry Schein has sales relationships with most practices already

This does not make your idea impossible, but it means your product needs to be dramatically better at scheduling specifically, or you need to target the 60% of practices NOT on Dentrix.
