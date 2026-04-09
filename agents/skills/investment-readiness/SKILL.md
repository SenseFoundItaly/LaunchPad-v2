---
name: investment-readiness
description: Produces OKRs, financial projections, investor deck outline, and data room readiness assessment for fundraising preparation
---

# Investment Readiness

Prepare the founder for fundraising with company OKRs, financial projections, an investor deck outline, and a data room readiness assessment. This skill synthesizes all previous validation work into investor-facing materials.

## When to Use

- After prototype-spec when the founder is preparing to raise capital
- When founder asks "am I ready to fundraise?"
- Before approaching investors to ensure all materials are prepared
- When an investor asks for specific materials (deck, financials, data room)

## Instructions

### Company OKRs (COO Perspective)

Set 3 company-level objectives for the next quarter. Each objective has 3 key results.

**Rules:**
- Objectives are qualitative and inspiring (e.g., "Establish product-market fit in the mid-market segment")
- Key Results are quantitative and measurable (e.g., "Achieve 50 paying customers with <5% monthly churn")
- Key Results must have specific numbers, not "increase" or "improve"
- Each KR needs a baseline (current state) and target (end of quarter)
- Time-bound: quarterly (13 weeks)

### Product OKRs (VP Product Perspective)

Set 2-3 product objectives aligned to company OKRs. Each with 3 key results focused on product metrics:
- Feature adoption rates
- User engagement metrics
- Technical performance targets
- NPS or satisfaction scores

### 3-Year Financial Projections

#### Revenue Projections (per year)
- Customer count (specific number, not range)
- ARR (Annual Recurring Revenue)
- Growth rate (YoY %)
- Revenue assumptions (list each, be explicit)

#### Profit & Loss (per year)
- Revenue
- COGS (with breakdown)
- Gross Profit + Gross Margin %
- Operating Expenses (broken down: R&D, Sales & Marketing, G&A)
- EBITDA
- Net Income

#### SaaS Metrics
- LTV (Lifetime Value) with calculation shown
- CAC (Customer Acquisition Cost) with channel breakdown
- LTV/CAC ratio
- Payback period (months)
- Monthly churn rate (%)
- Net Revenue Retention (NRR %)

All numbers in EUR. Show your math. Reference industry benchmarks with sources (e.g., "Median SaaS gross margin is 75% per KeyBanc 2025 SaaS Survey").

### Investor Deck Outline

15-20 slides with content guidance per slide:

1. **Title:** Company name, tagline, round info
2. **Problem:** The pain point (reference Persona 1's top pain from scientific-validation)
3. **Solution:** What you build and how it solves the problem
4. **Market:** TAM/SAM/SOM from market-research (with sources)
5. **Traction:** Current metrics, milestones achieved
6. **Business Model:** From business-model evaluation (the recommended model)
7. **Product:** Screenshots or wireframes description, key features from prototype-spec
8. **Competition:** 2x2 matrix from market-research, your positioning
9. **Go-to-Market:** Top 3 channels from gtm-strategy (if available)
10. **Team:** Key team members, relevant experience, gaps to fill
11. **Financials:** 3-year summary (revenue, margins, key SaaS metrics)
12. **The Ask:** Amount raising, instrument (SAFE/equity), use of funds breakdown
13. **Use of Funds:** Percentage allocation (product, hiring, marketing, operations)
14. **Milestones:** What you will achieve with this capital (next 12-18 months)
15. **Risks:** Top 3 risks with mitigation (from risk-scoring if available)
16. **Appendix:** Detailed financials, competitive details, technical architecture

Per slide: specify the key message (one sentence) and the data points to include.

### Investor Readiness Score (0-100)

Score based on completeness of data room items:

| Item | Status | Weight |
|------|--------|--------|
| Pitch deck | ready / draft / missing | 15% |
| Financial model | ready / draft / missing | 15% |
| Cap table | ready / draft / missing | 10% |
| Team bios | ready / draft / missing | 10% |
| Product demo | ready / draft / missing | 15% |
| Customer references | ready / draft / missing | 10% |
| Market research | ready / draft / missing | 10% |
| Legal (incorporation, IP) | ready / draft / missing | 10% |
| Technical documentation | ready / draft / missing | 5% |

Status scoring: ready = 100%, draft = 50%, missing = 0%

Weighted sum = Investor Readiness Score.

- **80-100:** Ready to approach investors
- **60-79:** Almost ready, address gaps first
- **40-59:** Significant preparation needed
- **Below 40:** Not ready -- focus on building before fundraising

### Quality Standards

Follow `_shared/quality-standards.md`. Financial projections must reference industry benchmarks with sources. No vague terms in the deck outline.

## Output Format

```json
{
  "investment_readiness": {
    "company_okrs": [
      {
        "objective": "Qualitative objective",
        "key_results": [
          { "kr": "Specific measurable KR", "baseline": "Current state", "target": "End of quarter target" }
        ]
      }
    ],
    "product_okrs": [],
    "financials": {
      "revenue_projections": [
        { "year": 1, "customers": 50, "arr": "€240K", "growth_rate": "N/A (year 1)", "assumptions": ["Assumption 1"] }
      ],
      "profit_and_loss": [
        { "year": 1, "revenue": "€240K", "cogs": "€48K", "gross_profit": "€192K", "gross_margin_pct": 80, "opex": "€480K", "ebitda": "-€288K", "net_income": "-€288K" }
      ],
      "saas_metrics": {
        "ltv": "€14,400",
        "ltv_calculation": "€400 ARPU x 36 months avg lifetime",
        "cac": "€2,400",
        "cac_breakdown": { "content_marketing": "€800", "paid_ads": "€1,000", "sales": "€600" },
        "ltv_cac_ratio": 6.0,
        "payback_months": 6,
        "monthly_churn_pct": 2.8,
        "nrr_pct": 110
      }
    },
    "deck_outline": [
      { "slide": 1, "title": "Slide title", "key_message": "One sentence", "data_points": ["Data to include"] }
    ],
    "readiness_score": {
      "overall": 62,
      "label": "Almost ready",
      "items": [
        { "item": "Pitch deck", "status": "draft", "weight": 0.15, "score": 50, "action_needed": "Finalize slides 5-8" }
      ]
    },
    "data_room_gaps": ["Specific items to prepare with timeline"],
    "recommended_next": "pitch-coaching"
  }
}
```
