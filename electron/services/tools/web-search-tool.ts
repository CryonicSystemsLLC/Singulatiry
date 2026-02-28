/**
 * Web Search Tool - Web search capability for the agent
 *
 * This is a stub implementation that documents the API key requirements.
 * To enable real web search, configure one of the supported search providers
 * and set the corresponding API key in the application settings.
 */

import { Tool, ToolResult, ToolContext, defineTool } from './registry';

/**
 * Supported search provider configurations
 */
interface SearchProviderConfig {
  provider: 'brave' | 'google' | 'serper' | 'none';
  apiKey?: string;
}

/**
 * Get the configured search provider from environment or context
 */
function getSearchProvider(context: ToolContext): SearchProviderConfig {
  const env = { ...process.env, ...context.env };

  // Check for Brave Search API key
  if (env.BRAVE_SEARCH_API_KEY) {
    return { provider: 'brave', apiKey: env.BRAVE_SEARCH_API_KEY };
  }

  // Check for Google Custom Search API key
  if (env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_CX) {
    return { provider: 'google', apiKey: env.GOOGLE_SEARCH_API_KEY };
  }

  // Check for Serper API key (Google SERP API)
  if (env.SERPER_API_KEY) {
    return { provider: 'serper', apiKey: env.SERPER_API_KEY };
  }

  return { provider: 'none' };
}

/**
 * Search using the Brave Search API
 */
async function searchBrave(query: string, apiKey: string, count: number): Promise<any[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Brave Search API returned HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as {
    web?: {
      results?: Array<{
        title: string;
        url: string;
        description: string;
        age?: string;
      }>;
    };
  };

  return (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    age: r.age || null
  }));
}

/**
 * Search using Google Custom Search API
 */
async function searchGoogle(query: string, apiKey: string, count: number): Promise<any[]> {
  const cx = process.env.GOOGLE_SEARCH_CX || '';
  const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}&num=${Math.min(count, 10)}`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Google Search API returned HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as {
    items?: Array<{
      title: string;
      link: string;
      snippet: string;
    }>;
  };

  return (data.items || []).map(item => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet
  }));
}

/**
 * Search using Serper API (Google SERP)
 */
async function searchSerper(query: string, apiKey: string, count: number): Promise<any[]> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q: query,
      num: count
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Serper API returned HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as {
    organic?: Array<{
      title: string;
      link: string;
      snippet: string;
      position: number;
    }>;
  };

  return (data.organic || []).map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    position: r.position
  }));
}

/**
 * Web search tool
 */
export const webSearch = defineTool<{
  query: string;
  count?: number;
}>(
  'web_search',
  'Search the web for information. Requires a search API key to be configured (supports Brave Search, Google Custom Search, or Serper). Set the appropriate environment variable: BRAVE_SEARCH_API_KEY, GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX, or SERPER_API_KEY.',
  {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query'
      },
      count: {
        type: 'number',
        description: 'Number of results to return (default: 5, max: 20)',
        default: 5
      }
    },
    required: ['query']
  },
  async (params, context): Promise<ToolResult> => {
    const provider = getSearchProvider(context);
    const count = Math.min(params.count || 5, 20);

    if (provider.provider === 'none') {
      return {
        success: false,
        error: {
          message: [
            'Web search is not configured. To enable web search, set one of the following environment variables:',
            '',
            '1. Brave Search (recommended):',
            '   BRAVE_SEARCH_API_KEY=your_api_key',
            '   Get a key at: https://api.search.brave.com/',
            '',
            '2. Google Custom Search:',
            '   GOOGLE_SEARCH_API_KEY=your_api_key',
            '   GOOGLE_SEARCH_CX=your_search_engine_id',
            '   Get a key at: https://developers.google.com/custom-search/v1/overview',
            '',
            '3. Serper (Google SERP API):',
            '   SERPER_API_KEY=your_api_key',
            '   Get a key at: https://serper.dev/',
            '',
            'Set the environment variable and restart the application.'
          ].join('\n'),
          code: 'SEARCH_NOT_CONFIGURED',
          recoverable: false
        }
      };
    }

    try {
      let results: any[];

      switch (provider.provider) {
        case 'brave':
          results = await searchBrave(params.query, provider.apiKey!, count);
          break;
        case 'google':
          results = await searchGoogle(params.query, provider.apiKey!, count);
          break;
        case 'serper':
          results = await searchSerper(params.query, provider.apiKey!, count);
          break;
        default:
          results = [];
      }

      return {
        success: true,
        data: {
          query: params.query,
          provider: provider.provider,
          count: results.length,
          results
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Web search failed (${provider.provider}): ${error.message}`,
          code: 'SEARCH_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * All web search tools
 */
export const WEB_SEARCH_TOOLS: Tool[] = [
  webSearch
];

/**
 * Register web search tools with a registry
 */
export function registerWebSearchTools(registry: import('./registry').ToolRegistry): void {
  for (const tool of WEB_SEARCH_TOOLS) {
    registry.register(tool);
  }
}

export default WEB_SEARCH_TOOLS;
