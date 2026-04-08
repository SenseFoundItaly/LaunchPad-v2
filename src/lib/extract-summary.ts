export interface SkillHighlights {
  keyTake: string;
  strengths: string[];
  weaknesses: string[];
  metrics: string[];
  verdict: string | null;
  sectionCount: number;
}

/** Extract actionable highlights from skill output */
export function extractSkillHighlights(content: string | undefined): SkillHighlights | null {
  if (!content || content.length < 50) return null;

  const clean = content.replace(/:::artifact[\s\S]*?:::/g, '').trim();
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

  // Key take: first meaningful sentence >40 chars
  let keyTake = '';
  for (const line of lines) {
    if (line.length < 40) continue;
    if (line.startsWith('#')) continue;
    if (line.match(/^[━═─]{3,}/)) continue;
    if (line.startsWith('---')) continue;
    keyTake = line.replace(/^[#*\->\s]+/, '').replace(/\*\*/g, '').slice(0, 200);
    if (keyTake.length > 180) keyTake = keyTake.slice(0, 180) + '...';
    break;
  }

  // Strengths: lines with positive signals
  const strengthSignals = /strength|advantage|opportunity|strong|positive|win|defensib|moat|differentiator|high score|high demand|large market|TAM|growing|scalab/i;
  const weaknessSignals = /risk|weakness|gap|missing|threat|vulnerable|low score|concern|challenge|problem|kill|fatal|danger|disintermediat|churn|competitor|burn/i;

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  for (const line of lines) {
    if (line.length < 20 || line.length > 200) continue;
    if (line.startsWith('#')) continue;
    if (line.match(/^[━═─]/)) continue;

    const cleaned = line.replace(/^[-*\u2192>\s]+/, '').replace(/\*\*/g, '').trim();
    if (cleaned.length < 15) continue;

    if (strengthSignals.test(cleaned) && strengths.length < 3) {
      strengths.push(cleaned.slice(0, 120));
    } else if (weaknessSignals.test(cleaned) && weaknesses.length < 3) {
      weaknesses.push(cleaned.slice(0, 120));
    }
  }

  // If we didn't find explicit signals, look for bullet patterns near headings
  if (strengths.length === 0) {
    const strengthIdx = lines.findIndex(l => /strength|advantage|positive|what.?s working/i.test(l));
    if (strengthIdx >= 0) {
      for (let i = strengthIdx + 1; i < Math.min(strengthIdx + 6, lines.length); i++) {
        const l = lines[i].replace(/^[-*\u2192>\s]+/, '').replace(/\*\*/g, '').trim();
        if (l.length > 15 && l.length < 150 && !l.startsWith('#')) {
          strengths.push(l);
          if (strengths.length >= 3) break;
        }
      }
    }
  }

  if (weaknesses.length === 0) {
    const weakIdx = lines.findIndex(l => /weakness|risk|gap|concern|threat|challenge|what.?s missing/i.test(l));
    if (weakIdx >= 0) {
      for (let i = weakIdx + 1; i < Math.min(weakIdx + 6, lines.length); i++) {
        const l = lines[i].replace(/^[-*\u2192>\s]+/, '').replace(/\*\*/g, '').trim();
        if (l.length > 15 && l.length < 150 && !l.startsWith('#')) {
          weaknesses.push(l);
          if (weaknesses.length >= 3) break;
        }
      }
    }
  }

  // Metrics
  const metricPatterns = [
    /\$[\d,.]+[KMB]?(?:\/mo)?/g,
    /\d+\.?\d*%/g,
    /\d+\.?\d*\/10/g,
    /\d+\.?\d*x\b/g,
    /LTV[:/]\s*CAC\s*[=:]\s*\d+\.?\d*x?/gi,
    /MRR\s*[=:]\s*\$[\d,.]+[KMB]?/gi,
    /ARR\s*[=:]\s*\$[\d,.]+[KMB]?/gi,
  ];
  const metricsSet = new Set<string>();
  for (const p of metricPatterns) {
    const matches = clean.match(p);
    if (matches) for (const m of matches) {
      if (m.length > 2 && m.length < 25) metricsSet.add(m.trim());
    }
  }
  const metrics = [...metricsSet].slice(0, 6);

  // Verdict
  let verdict: string | null = null;
  const verdictPatterns = [
    /(?:WINNER|RECOMMENDED)[:\s]+(.{10,80})/i,
    /(?:VERDICT|RECOMMENDATION)[:\s]*(STRONG.GO|GO|NO.GO|CAUTION|CONDITIONAL|PASS|BUY|HOLD)/i,
    /Weighted\s+Score[:\s]*(\d+\.?\d*\/10)/i,
    /Overall[:\s]*(\d+\.?\d*\/10)/i,
  ];
  for (const p of verdictPatterns) {
    const match = clean.match(p);
    if (match) { verdict = (match[1] || match[0]).replace(/[*#]/g, '').trim().slice(0, 60); break; }
  }

  const sectionCount = (clean.match(/^#{1,3}\s/gm) || []).length +
    (clean.match(/^[━═─]+\s*.+\s*[━═─]+$/gm) || []).length;

  return { keyTake, strengths, weaknesses, metrics, verdict, sectionCount };
}
