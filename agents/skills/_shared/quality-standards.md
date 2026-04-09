## Source Attribution Standards

Every factual claim must cite a source when possible.

### Source Format
- title: Source name
- url: Direct URL (not hallucinated)
- snippet: Relevant quote (min 50 chars)
- credibility: Authoritative | Premium | Industry | Community

### Credibility Tiers
- Authoritative: Government data, peer-reviewed research, major firms (McKinsey, Gartner, BCG)
- Premium: Paid databases (Crunchbase, PitchBook, Statista, CB Insights)
- Industry: Trade publications, company reports, industry associations
- Community: News articles, blog posts, forums

### Minimum Source Requirements
- Market sizing claims: 2+ sources from different tiers
- Competitor data: 1+ source per competitor
- Financial projections: Industry benchmark + comparable company
- Technical claims: Academic or industry report

## Specificity Rules

### Banned Vague Terms
Replace these with specific data:
- "significant" → "€X amount" or "X%"
- "various" → list specific items
- "several" → exact count or range
- "strong/good" → specific metric or rank
- "large/high" → specific size/number
- "leading" → "X% market share (Source)"
- "well-funded" → "€XXM Series X at €XXB valuation"
- "innovative" → describe the specific innovation

## Confidence Scoring

When certainty varies, assign confidence:
- 0.9-1.0: Verified data with recent, authoritative sources
- 0.7-0.8: Multiple corroborating signals from different sources
- 0.5-0.6: Industry benchmarks applied to this specific case
- 0.3-0.4: Estimates from analogous markets (flagged as estimates)
- 0.1-0.2: Educated guesses with limited data (prefix with "Estimated:")

## Escape Hatches

When data is unavailable:
- Use comparable benchmarks, clearly labeled as "[BENCHMARK]"
- Mark estimates explicitly: "[ESTIMATE] Based on analogous market X..."
- When conflicting data exists: present both with confidence levels
- Never fabricate sources, URLs, or statistics
- For arrays requiring 5+ items: provide 3+ high-quality items (quality > quantity)

## Quality Check (Before Output)

Verify before responding:
1. Every number has a source or is labeled as estimate
2. No banned vague terms remain
3. All source URLs are real (not hallucinated)
4. Confidence scores are assigned where certainty varies
5. Recommendations include specific next steps with timelines
