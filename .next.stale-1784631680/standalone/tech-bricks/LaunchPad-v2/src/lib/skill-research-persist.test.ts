import { describe, it, expect } from 'vitest';
import { extractResearchFields } from './skill-research-persist';

// extractResearchFields — the parse layer that feeds research persistence AND
// the Stage-2 1A staging (market size / trends / buyer persona). The
// customer_insights extraction is what makes buyer_persona_defined closable
// from a skill run, so its recovery paths need the same coverage as the rest.

const FULL_OUTPUT = `Here is the research.

\`\`\`json
{
  "market_research": {
    "market_sizing": { "tam": { "estimate": "$840M", "confidence": "medium" } },
    "competitors": [ { "name": "Dentrix", "description": "Practice management suite" } ],
    "trends": [
      { "name": "Cloud adoption", "direction": "tailwind", "timeframe": "1-2 years", "implication": "Lower resistance to SaaS" }
    ],
    "customer_insights": {
      "buyer_persona": "Practice owner, 45-60, non-technical",
      "user_persona": "Front-desk staff",
      "purchase_triggers": ["Missed recalls pile up"],
      "decision_criteria": ["Price", "Ease of onboarding"]
    }
  }
}
\`\`\`
`;

describe('extractResearchFields — customer_insights', () => {
  it('extracts customer_insights alongside sizing/competitors/trends on a full parse', () => {
    const f = extractResearchFields(FULL_OUTPUT)!;
    expect(f).not.toBeNull();
    expect(f.competitors).toHaveLength(1);
    expect(f.trends).toHaveLength(1);
    expect(f.customerInsights?.buyer_persona).toBe('Practice owner, 45-60, non-technical');
  });

  it('recovers customer_insights via balanced extraction when the JSON is truncated', () => {
    // Truncate mid-sources so the full parse fails but earlier complete
    // structures (competitors, customer_insights) are individually recoverable.
    const truncated = FULL_OUTPUT.replace(/\n\s*\}\n\}\n```\n$/, '\n    "sources": [ { "type": "web", "title": "cut');
    const f = extractResearchFields(truncated)!;
    expect(f).not.toBeNull();
    expect(f.competitors).toHaveLength(1);
    expect(f.customerInsights?.buyer_persona).toBe('Practice owner, 45-60, non-technical');
  });

  it('yields customerInsights: null when the section is absent (no phantom persona item)', () => {
    const without = FULL_OUTPUT.replace(/,\s*"customer_insights": \{[\s\S]*?\}/, '');
    const f = extractResearchFields(without)!;
    expect(f).not.toBeNull();
    expect(f.customerInsights).toBeNull();
  });
});
