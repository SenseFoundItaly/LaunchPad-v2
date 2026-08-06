---
name: clarity-scoring
description: Scores how CLEAR a startup idea is — canvas-only, pre-validation. The honest first score, before any market evidence exists.
---

# Clarity Score

Answer one question: **how clear is this idea, on paper?**

This is the FIRST score a founder sees, right after compiling the Idea Canvas —
before any market research, competitor mapping or customer interview exists.
That timing is the whole design (founder decision, changelog 4/08): the full
Startup Scoring judges market opportunity, competition, feasibility and customer
demand — dimensions that at this stage are not weak, they are **unknowable**.
Scoring them now punishes ignorance as if it were weakness and hands every
founder a low number that reads as a verdict on their idea. The Startup Scoring
runs later, once the Validation Gate has produced real evidence for those
dimensions.

So: judge ONLY what is on the canvas. Clarity, specificity, internal coherence.
Not whether the market is big — whether the founder knows what they are
claiming.

## Rules

- **Canvas-only. Do NOT use web search or any external research tool.** Every
  input you need is in the project context (the Idea Canvas fields). If a field
  is empty, score its variable low and say the field is empty — that IS the
  finding.
- Judge the writing in front of you, not the idea's potential. "AI for
  restaurants" as a problem statement scores low on specificity even if the
  underlying opportunity is real.
- Be concrete in every rationale: quote the founder's own words back and name
  what is missing ("'le PMI italiane' — which PMI? size, sector, trigger?").
- Sources: cite `type: 'internal'` (the canvas fields) or `type: 'user'`. No web
  sources — there is nothing external to cite.

## The six variables

| Variable | Weight | What it measures |
| --- | --- | --- |
| `problem_specificity` | 20% | The problem is concrete, has an identifiable trigger, is not generic |
| `solution_problem_coherence` | 20% | The solution logically addresses the stated problem |
| `icp_specificity` | 20% | The target is narrow enough to be testable (not "all SMEs") |
| `value_prop_articulation` | 15% | The value proposition is clear and distinguishable, even just on paper |
| `differentiation_logic` | 15% | There is a stated REASONING (not proof) for why this beats the alternatives |
| `revenue_cost_coherence` | 10% | The sketched economic model is internally sensible |

Each variable: 0-100. Overall = weighted sum, 0-100.

## Verdict

| Verdict | Threshold | Meaning |
| --- | --- | --- |
| `GO` | ≥ 70 and no critical variable below 40 | Idea well structured — proceed to the Validation Gate |
| `PIVOT PARZIALE` | 40-69, or a single critical variable below 40 | Interesting idea, one specific weakness — name it precisely |
| `NO GO` | < 40, or a fundamental incoherence (problem not real, solution disconnected) | The canvas needs a guided revision before anything else |

The critical variables are `problem_specificity`, `solution_problem_coherence`
and `icp_specificity` — a hole in any of them undermines everything downstream.

The verdict NEVER blocks the founder. This platform is AI-assisted, not
AI-dictated: on PIVOT PARZIALE or NO GO, name the specific weakness and
recommend fixing it first, but state plainly that they can proceed anyway.

## Output Format

Emit the COMPACT json block below **first**, before any narrative. It must be
complete and closed. Everything the product stores is in here — keep it tight.
Do NOT include weights, threshold tables or improvement plans inside the json;
write those as prose AFTER the block. (If the run is cut short, a small block
that already closed is the only thing that still parses — without it the
founder's score is silently lost even though the run looks successful.)

```json
{
  "startup_score": {
    "overall_score": 0,
    "overall_grade": "A+ | A | B+ | B | C+ | C | D | F",
    "recommendation": "GO | PIVOT PARZIALE | NO GO",
    "summary": "2-3 sentences: how clear is this idea, and what is the ONE thing to sharpen first",
    "dimensions": {
      "problem_specificity": { "score": 0, "rationale": "one sentence, quoting the canvas" },
      "solution_problem_coherence": { "score": 0, "rationale": "one sentence" },
      "icp_specificity": { "score": 0, "rationale": "one sentence" },
      "value_prop_articulation": { "score": 0, "rationale": "one sentence" },
      "differentiation_logic": { "score": 0, "rationale": "one sentence" },
      "revenue_cost_coherence": { "score": 0, "rationale": "one sentence" }
    }
  }
}
```

After the block, in prose: the verdict explained, the single most important
thing to sharpen, and — on PIVOT PARZIALE / NO GO — a concrete suggestion for
how to revise the weak field (with the reminder that proceeding anyway is the
founder's call).
