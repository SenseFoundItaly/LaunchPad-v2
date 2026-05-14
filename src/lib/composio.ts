/**
 * Composio integration — external service workflows
 * Gracefully no-ops when COMPOSIO_API_KEY is not set
 */

// Composio types (minimal — full SDK may not be installed yet)
interface ComposioResult {
  success: boolean;
  data: unknown;
  error?: string;
}

let _apiKey: string | null = null;

function getApiKey(): string | null {
  if (_apiKey === null) {
    _apiKey = process.env.COMPOSIO_API_KEY || '';
  }
  return _apiKey || null;
}

function isConfigured(): boolean {
  return !!getApiKey();
}

/** Generic Composio action executor */
async function executeAction(action: string, params: Record<string, unknown>): Promise<ComposioResult> {
  const key = getApiKey();
  if (!key) return { success: false, data: null, error: 'Composio not configured' };

  try {
    // Composio REST API call
    const res = await fetch('https://backend.composio.dev/api/v2/actions/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
      },
      body: JSON.stringify({ action, params }),
    });
    const data = await res.json();
    return { success: res.ok, data };
  } catch (err) {
    return { success: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Search for competitor activity on the web */
export async function searchCompetitor(query: string): Promise<ComposioResult> {
  return executeAction('SERPAPI_SEARCH', { q: query, num: 10 });
}

/** Search for patents */
export async function searchPatents(query: string): Promise<ComposioResult> {
  return executeAction('SERPAPI_SEARCH', { q: `site:patents.google.com ${query}`, num: 10 });
}

/** Search Crunchbase for funding rounds */
export async function searchFunding(companyName: string): Promise<ComposioResult> {
  return executeAction('SERPAPI_SEARCH', { q: `${companyName} funding round crunchbase`, num: 5 });
}

/** Search news */
export async function searchNews(query: string): Promise<ComposioResult> {
  return executeAction('SERPAPI_SEARCH', { q: query, tbm: 'nws', num: 10 });
}

/** Send Slack notification */
export async function sendSlack(channel: string, message: string): Promise<ComposioResult> {
  return executeAction('SLACK_SEND_MESSAGE', { channel, text: message });
}

/** Check if Composio is configured */
export { isConfigured };

/** Workflow templates */
export const WORKFLOW_TEMPLATES = {
  competitor_monitor: {
    id: 'competitor_monitor',
    name: 'Competitor Monitor',
    description: 'Track competitor news, product updates, and strategic moves',
    schedule: 'weekly',
    category: 'competitive',
    action: 'searchCompetitor',
    promptTemplate: 'Search for recent news about {competitor_name}. Report product launches, hiring, funding, partnerships, or pricing changes.',
  },
  patent_search: {
    id: 'patent_search',
    name: 'Patent Monitor',
    description: 'Search for new patent filings in your market',
    schedule: 'monthly',
    category: 'market',
    action: 'searchPatents',
    promptTemplate: 'Search Google Patents for new filings related to: {keywords}. Report relevant patents filed in the last 30 days.',
  },
  funding_tracker: {
    id: 'funding_tracker',
    name: 'Funding Tracker',
    description: 'Track competitor funding rounds',
    schedule: 'weekly',
    category: 'competitive',
    action: 'searchFunding',
    promptTemplate: 'Search for recent funding rounds by companies in the {market} space. Report rounds above $500K.',
  },
  news_monitor: {
    id: 'news_monitor',
    name: 'Market News',
    description: 'Track industry news and regulatory changes',
    schedule: 'daily',
    category: 'market',
    action: 'searchNews',
    promptTemplate: 'Search news for: {keywords}. Report significant developments, regulatory changes, or market shifts.',
  },
};
