/**
 * Watch Source Processor — core processing logic for URL-based change detection.
 *
 * Flow: scrape URL → if changed, classify significance via LLM (Haiku)
 *       → insert source_changes row → if significance >= medium, create
 *       ecosystem_alert → if high, auto-queue pending_action.
 */

import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { scrapeWithChangeTracking, type ScrapeResult } from '@/lib/firecrawl';
import { runAgent } from '@/lib/pi-agent';
import { pickModel } from '@/lib/llm/router';
import { recordUsage, isProjectCapped } from '@/lib/cost-meter';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { createPendingAction } from '@/lib/pending-actions';
import { computeDedupeHash } from '@/lib/ecosystem-monitors';
import {
  structuralDiff, formatDiffForLLM,
  parseMarkdownTable, extractJsonLd,
} from '@/lib/structural-diff';
import type { WatchSource, ChangeStatus, SignalSignificance } from '@/types';

export interface ProcessResult {
  watch_source_id: string;
  status: 'scraped' | 'unchanged' | 'classified' | 'error' | 'skipped_budget';
  change_status: ChangeStatus;
  significance?: SignalSignificance;
  alert_created?: boolean;
  error?: string;
}

interface ClassificationResult {
  significance: SignalSignificance;
  rationale: string;
  headline: string;
  alert_type: string;
}

const MAX_DIFF_FOR_LLM = 4000;
const MAX_SNAPSHOT_STORED = 50_000;

/**
 * Process a single watch source: scrape → detect change → classify → persist.
 */
export async function processWatchSource(
  ws: WatchSource,
  projectContext?: string,
): Promise<ProcessResult> {
  const now = new Date().toISOString();

  // Cost gate
  const capStatus = await isProjectCapped(ws.project_id);
  if (capStatus.capped) {
    await run(
      `UPDATE watch_sources SET next_scrape_at = ?, updated_at = ? WHERE id = ?`,
      calculateNextRun(ws.schedule) || now,
      now,
      ws.id,
    );
    return { watch_source_id: ws.id, status: 'skipped_budget', change_status: 'same' };
  }

  let scrapeResult: ScrapeResult;
  try {
    scrapeResult = await scrapeWithChangeTracking(ws.url, {
      changeTrackingTag: ws.change_tracking_tag || undefined,
      previousContentHash: ws.last_content_hash,
      isFirstScrape: !ws.last_scraped_at,
    });
  } catch (err) {
    const errorMsg = (err as Error).message;
    const newErrorCount = (ws.error_count || 0) + 1;
    await run(
      `UPDATE watch_sources SET
         error_message = ?, error_count = ?,
         status = CASE WHEN ? >= 5 THEN 'error' ELSE status END,
         next_scrape_at = ?, updated_at = ?
       WHERE id = ?`,
      errorMsg.slice(0, 500),
      newErrorCount,
      newErrorCount,
      calculateNextRun(ws.schedule) || now,
      now,
      ws.id,
    );
    return { watch_source_id: ws.id, status: 'error', change_status: 'same', error: errorMsg };
  }

  // Update the watch source with scrape result
  await run(
    `UPDATE watch_sources SET
       last_snapshot = ?, last_content_hash = ?, last_scraped_at = ?,
       next_scrape_at = ?, error_message = NULL, error_count = 0,
       status = 'active', updated_at = ?
     WHERE id = ?`,
    scrapeResult.markdown.slice(0, MAX_SNAPSHOT_STORED),
    scrapeResult.contentHash,
    now,
    calculateNextRun(ws.schedule) || now,
    now,
    ws.id,
  );

  // If no change, record it and move on
  if (scrapeResult.changeStatus === 'same') {
    const changeId = generateId('sc');
    await run(
      `INSERT INTO source_changes
         (id, watch_source_id, project_id, change_status, previous_content_hash,
          current_content_hash, significance, detected_at)
       VALUES (?, ?, ?, 'same', ?, ?, 'noise', ?)`,
      changeId, ws.id, ws.project_id,
      ws.last_content_hash,
      scrapeResult.contentHash,
      now,
    );
    return { watch_source_id: ws.id, status: 'unchanged', change_status: 'same' };
  }

  // Change detected — classify significance via LLM
  let classification: ClassificationResult;
  try {
    classification = await classifyChange(ws, scrapeResult, projectContext);
  } catch (err) {
    // Classification failed — still record the change, just as 'low'
    console.warn(`[watch-source] classification failed for ${ws.id}:`, (err as Error).message);
    classification = {
      significance: 'low',
      rationale: `Classification failed: ${(err as Error).message}`,
      headline: `Content changed on ${ws.label}`,
      alert_type: 'trend_signal',
    };
  }

  // Insert source_changes row
  const changeId = generateId('sc');
  let alertId: string | null = null;

  // If significance >= medium, create an ecosystem_alert
  if (classification.significance === 'high' || classification.significance === 'medium') {
    alertId = generateId('ealr');
    const dedupeHash = computeDedupeHash(
      classification.alert_type,
      ws.url,
      classification.headline,
    );
    try {
      await run(
        `INSERT INTO ecosystem_alerts
           (id, project_id, monitor_id, alert_type, source, source_url,
            headline, body, relevance_score, confidence, dedupe_hash,
            reviewed_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(project_id, dedupe_hash) DO UPDATE SET
           relevance_score = GREATEST(ecosystem_alerts.relevance_score, EXCLUDED.relevance_score),
           monitor_run_id = EXCLUDED.monitor_run_id`,
        alertId,
        ws.project_id,
        ws.monitor_id,
        classification.alert_type,
        `watch:${ws.label}`,
        ws.url,
        classification.headline,
        classification.rationale,
        classification.significance === 'high' ? 0.9 : 0.7,
        0.8,
        dedupeHash,
        now,
      );
    } catch (err) {
      console.warn('[watch-source] ecosystem_alert insert failed:', (err as Error).message);
      alertId = null;
    }
  }

  await run(
    `INSERT INTO source_changes
       (id, watch_source_id, project_id, change_status, diff_summary, raw_diff,
        previous_content_hash, current_content_hash, significance,
        significance_rationale, alert_id, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    changeId, ws.id, ws.project_id,
    scrapeResult.changeStatus,
    classification.headline,
    scrapeResult.rawDiff?.slice(0, 100_000) || null,
    ws.last_content_hash,
    scrapeResult.contentHash,
    classification.significance,
    classification.rationale,
    alertId,
    now,
  );

  // If high significance, auto-queue a pending_action for the founder
  let pendingActionCreated = false;
  if (classification.significance === 'high' && alertId) {
    try {
      await createPendingAction({
        project_id: ws.project_id,
        ecosystem_alert_id: alertId,
        action_type: 'task',
        title: classification.headline,
        rationale: `High-significance change detected on "${ws.label}" (${ws.url}). ${classification.rationale}`,
        estimated_impact: 'high',
        priority: 'high',
        payload: {
          source: 'watch-source',
          watch_source_id: ws.id,
          source_change_id: changeId,
          url: ws.url,
          change_status: scrapeResult.changeStatus,
        },
      });
      pendingActionCreated = true;
    } catch (err) {
      console.warn('[watch-source] pending_action creation failed:', (err as Error).message);
    }
  }

  return {
    watch_source_id: ws.id,
    status: 'classified',
    change_status: scrapeResult.changeStatus,
    significance: classification.significance,
    alert_created: !!alertId || pendingActionCreated,
  };
}

/**
 * Classify the significance of a detected change using Haiku.
 */
async function classifyChange(
  ws: WatchSource,
  scrapeResult: ScrapeResult,
  projectContext?: string,
): Promise<ClassificationResult> {
  // Build a diff context for the LLM
  let diffContext: string;
  if (scrapeResult.rawDiff) {
    // Firecrawl provided a git-diff
    diffContext = `Git-diff of changes:\n${scrapeResult.rawDiff.slice(0, MAX_DIFF_FOR_LLM)}`;
  } else if (ws.last_snapshot && scrapeResult.markdown) {
    // Jina fallback — give the LLM old vs new snippets
    const oldSnippet = ws.last_snapshot.slice(0, MAX_DIFF_FOR_LLM / 2);
    const newSnippet = scrapeResult.markdown.slice(0, MAX_DIFF_FOR_LLM / 2);
    diffContext = `Previous content (truncated):\n${oldSnippet}\n\n---\n\nCurrent content (truncated):\n${newSnippet}`;
  } else {
    diffContext = `New page content (first scrape):\n${scrapeResult.markdown.slice(0, MAX_DIFF_FOR_LLM)}`;
  }

  // Attempt structural diff when both snapshots have parseable structured data
  const structuralSummary = tryStructuralDiff(ws.last_snapshot, scrapeResult.markdown);
  if (structuralSummary) {
    diffContext = `Structured field-level changes:\n${structuralSummary}\n\n${diffContext}`;
  }

  // Category-specific classification hints
  const categoryHints = getCategoryHints(ws.category);

  const systemPrompt = [
    'You classify content changes detected on a tracked web page.',
    `Respond ONLY with valid JSON: {"significance":"high"|"medium"|"low"|"noise","rationale":"<1-2 sentences>","headline":"<concise headline, max 120 chars>","alert_type":"<one of: competitor_activity, ip_filing, trend_signal, partnership_opportunity, regulatory_change, funding_event, hiring_signal, customer_sentiment, social_signal, ad_activity, pricing_change, product_launch>"}`,
    '',
    'Significance scale:',
    '- high: pricing change, major product launch, regulatory shift, acquisition',
    '- medium: notable content update, new feature announcement, team change',
    '- low: minor wording tweaks, blog post, routine update',
    '- noise: no meaningful change, formatting only, timestamp updates',
    '',
    categoryHints ? `Category guidance:\n${categoryHints}\n` : '',
    projectContext ? `Project context:\n${projectContext}\n` : '',
  ].join('\n');

  const prompt = [
    `Tracked page: "${ws.label}" (${ws.url})`,
    `Category: ${ws.category}`,
    `Change status: ${scrapeResult.changeStatus}`,
    '',
    diffContext,
  ].join('\n');

  const startedAt = Date.now();
  const { text, usage } = await runAgent(prompt, {
    systemPrompt,
    timeout: 30_000,
    task: 'signal-classify',
  });
  const latencyMs = Date.now() - startedAt;

  // Record cost
  const { provider, model } = pickModel('signal-classify');
  recordUsage({
    project_id: ws.project_id,
    skill_id: 'signals',
    step: 'signal_classify',
    provider,
    model,
    usage,
    latency_ms: latencyMs,
  }).catch(err =>
    console.warn('[watch-source] recordUsage failed:', (err as Error).message),
  );

  // Parse the JSON response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('LLM did not return valid JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult;

  // Validate
  const validSignificance = ['high', 'medium', 'low', 'noise'];
  if (!validSignificance.includes(parsed.significance)) {
    parsed.significance = 'low';
  }
  if (!parsed.headline || parsed.headline.length > 200) {
    parsed.headline = `Change detected on ${ws.label}`;
  }
  if (!parsed.alert_type) {
    parsed.alert_type = 'trend_signal';
  }

  return parsed;
}

/**
 * Category-specific classification hints to guide the LLM toward the
 * correct alert_type based on the watch source category.
 */
function getCategoryHints(category: string): string | null {
  switch (category) {
    case 'careers_page':
      return 'This is a careers/jobs page. Use alert_type="hiring_signal" for changes. Focus on strategic hires (leadership, enterprise AEs, security), team expansion into new areas, or mass hiring campaigns. Ignore routine job post refreshes.';
    case 'social_feed':
      return 'This is a social media feed or profile. Use alert_type="social_signal" for changes. Focus on feature announcements, messaging pivots, PR campaigns, viral content, or positioning shifts. Ignore routine engagement posts.';
    case 'review_site':
      return 'This is a review/ratings site. Use alert_type="customer_sentiment" for changes. Focus on rating shifts, recurring complaint patterns, competitive gaps mentioned, or sudden review volume changes. Ignore single reviews.';
    case 'competitor_pricing':
      return 'This is a competitor pricing page. Use alert_type="pricing_change" for pricing changes (tier changes, plan additions/removals, discount structures, free tier mods, usage limit adjustments, enterprise pricing shifts). Use alert_type="competitor_activity" for non-pricing updates. Ignore cosmetic page updates.';
    case 'competitor_product':
      return 'This is a competitor product page. Use alert_type="product_launch" for major product launches or new product lines. Use alert_type="competitor_activity" for incremental feature updates, deprecations, API changes, integrations, or roadmap announcements. Ignore minor copy edits or layout changes.';
    case 'ad_tracker':
      return 'This is an ad/paid marketing tracker (Meta Ads Library, Google Ads Transparency, landing page). Use alert_type="ad_activity" for changes. Focus on new campaigns, messaging pivots, new paid channels, budget shifts, aggressive promotions, or landing page messaging changes. Ignore minor creative refreshes.';
    case 'marketing':
      return 'This is a marketing page or content source. Use alert_type="ad_activity" for paid marketing changes, or alert_type="competitor_activity" for organic marketing shifts. Focus on messaging changes, campaign launches, positioning pivots, content strategy shifts, or rebrand signals. Ignore routine blog posts.';
    case 'patent_database':
      return 'This is a patent database listing. Use alert_type="ip_filing" for changes. Focus on new patent filings, granted patents, prior art relevance to our domain, claims scope changes, or continuation filings. Ignore administrative status updates.';
    case 'regulatory':
      return 'This is a regulatory or compliance source. Use alert_type="regulatory_change" for changes. Focus on new regulations, enforcement actions, compliance deadlines, policy shifts, or guidance updates that affect our industry. Ignore routine procedural notices.';
    case 'news':
      return 'This is a news or industry publication. Use alert_type="trend_signal" for changes. Focus on industry developments, market shifts, ecosystem changes, major partnerships, funding rounds, or acquisitions. Ignore routine press releases or minor updates.';
    default:
      return null;
  }
}

/**
 * Try to extract structured data from both snapshots and produce a structural diff.
 * Returns a formatted summary string, or null if structured data isn't available.
 */
function tryStructuralDiff(
  oldContent: string | null,
  newContent: string | null,
): string | null {
  if (!oldContent || !newContent) return null;

  try {
    // Strategy 1: JSON-LD blocks
    const oldJsonLd = extractJsonLd(oldContent);
    const newJsonLd = extractJsonLd(newContent);
    if (oldJsonLd && newJsonLd) {
      const entries = structuralDiff(oldJsonLd, newJsonLd);
      if (entries.length > 0) {
        return formatDiffForLLM(entries);
      }
    }

    // Strategy 2: Markdown tables
    const oldTable = parseMarkdownTable(oldContent);
    const newTable = parseMarkdownTable(newContent);
    if (oldTable && newTable) {
      // Guess a key column: first column header
      const headers = Object.keys(oldTable[0] || {});
      const keyBy = headers[0] || undefined;
      const entries = structuralDiff(oldTable, newTable, { keyBy });
      if (entries.length > 0) {
        return formatDiffForLLM(entries);
      }
    }
  } catch {
    // Parsing failed — fall through to text-based diff
  }

  return null;
}

/**
 * Process a batch of watch sources (for cron). Processes up to `limit`
 * sources that are due for scraping.
 */
export async function processWatchSourcesCron(limit = 10): Promise<ProcessResult[]> {
  const now = new Date().toISOString();

  const due = await query<WatchSource>(
    `SELECT * FROM watch_sources
     WHERE status = 'active'
       AND (next_scrape_at IS NULL OR next_scrape_at <= ?)
     ORDER BY next_scrape_at ASC NULLS FIRST
     LIMIT ?`,
    now,
    limit,
  );

  if (due.length === 0) return [];

  const results: ProcessResult[] = [];
  for (const ws of due) {
    results.push(await processWatchSource(ws));
  }

  return results;
}
