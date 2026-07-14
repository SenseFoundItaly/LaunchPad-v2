/**
 * Ad-pack export helpers (launch pipeline W3) — pure functions turning an
 * AdPackArtifact into paste-ready files for the two editors. No platform
 * APIs: the founder downloads and imports (Google Ads Editor CSV; Meta bulk
 * JSON). Pure + unit-tested; client cards call these via blob download.
 */

import type { AdPackArtifact } from '@/types/artifacts';

function csvCell(v: string): string {
  const s = (v ?? '').replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

/**
 * Google Ads Editor CSV — one row per (audience → ad group) with RSA columns.
 * Column contract (tested): Campaign, Ad Group, plus Headline 1-15 and
 * Description 1-4 (blank-padded), Final URL.
 */
export function toGoogleAdsCsv(pack: AdPackArtifact): string {
  const headers = [
    'Campaign', 'Ad Group',
    ...Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`),
    ...Array.from({ length: 4 }, (_, i) => `Description ${i + 1}`),
    'Final URL',
  ];
  const rows: string[] = [headers.join(',')];
  for (const ad of pack.ads ?? []) {
    const headlines = (ad.headlines ?? []).slice(0, 15);
    const descriptions = (ad.descriptions ?? []).slice(0, 4);
    rows.push([
      csvCell(pack.title || 'LaunchPad campaign'),
      csvCell(ad.audience || 'Default'),
      ...Array.from({ length: 15 }, (_, i) => csvCell(headlines[i] ?? '')),
      ...Array.from({ length: 4 }, (_, i) => csvCell(descriptions[i] ?? '')),
      csvCell(pack.final_url ?? ''),
    ].join(','));
  }
  return rows.join('\n');
}

/**
 * Meta bulk JSON — campaign → ad sets (one per audience, with budget split)
 * → ads (primary_text + headline variants). Meta's bulk import accepts
 * spreadsheet-shaped data; JSON keeps the full structure for Ads Manager
 * copy-paste or a future API driver.
 */
export function toMetaBulkJson(pack: AdPackArtifact): string {
  const total = pack.budget?.total_monthly_usd ?? 0;
  const pctFor = (audience: string): number =>
    pack.budget?.split?.find((s) => s.audience === audience)?.pct ?? 0;
  return JSON.stringify({
    campaign: {
      name: pack.title || 'LaunchPad campaign',
      objective: 'OUTCOME_TRAFFIC',
      monthly_budget_usd: total,
    },
    ad_sets: (pack.audiences ?? []).map((a) => ({
      name: a.name,
      targeting_notes: a.targeting_notes,
      monthly_budget_usd: Math.round((total * pctFor(a.name)) / 100),
      ads: (pack.ads ?? []).filter((ad) => ad.audience === a.name).map((ad) => ({
        primary_text: ad.primary_text ?? '',
        headlines: ad.headlines ?? [],
        descriptions: ad.descriptions ?? [],
        call_to_action: ad.cta ?? 'LEARN_MORE',
        image_prompt: ad.image_prompt ?? '',
        link: pack.final_url ?? '',
      })),
    })),
  }, null, 2);
}
