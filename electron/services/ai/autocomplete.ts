/**
 * AI Autocomplete Service
 *
 * Provides fill-in-the-middle (FIM) completions for ghost text suggestions.
 * Uses a fast/cheap model to minimize latency.
 */

import { getModelService } from '../models/unified';

interface AutocompleteRequest {
  prefix: string;       // Code before cursor
  suffix: string;       // Code after cursor
  language: string;     // File language
  filePath?: string;    // Current file path
  maxTokens?: number;   // Max completion length
}

interface AutocompleteResponse {
  completion: string;
  model: string;
}

// Debounce timer
let debounceTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = 500;

// Cache recent completions to avoid redundant calls
const completionCache = new Map<string, string>();
const MAX_CACHE_SIZE = 50;

function getCacheKey(prefix: string, suffix: string): string {
  // Use last 100 chars of prefix + first 50 of suffix as key
  return `${prefix.slice(-100)}|||${suffix.slice(0, 50)}`;
}

export async function getAutocomplete(request: AutocompleteRequest): Promise<AutocompleteResponse | null> {
  // Skip if prefix is too short
  if (request.prefix.trim().length < 5) return null;

  const cacheKey = getCacheKey(request.prefix, request.suffix);
  const cached = completionCache.get(cacheKey);
  if (cached) {
    return { completion: cached, model: 'cached' };
  }

  try {
    const service = getModelService();

    // Use a fast model for autocomplete
    const model = 'openai:gpt-4o-mini';

    // Build a FIM-style prompt
    const prompt = `Complete the following ${request.language} code. Return ONLY the completion text that goes at the cursor position (marked with <CURSOR>). No markdown, no explanations, just the code to insert.

\`\`\`${request.language}
${request.prefix.slice(-500)}<CURSOR>${request.suffix.slice(0, 200)}
\`\`\`

Completion (just the code to insert at <CURSOR>, typically 1-3 lines):`;

    const response = await service.generate({
      prompt,
      model,
      maxTokens: request.maxTokens || 100,
      temperature: 0,
      systemPrompt: 'You are a code autocomplete engine. Return ONLY the completion code, nothing else. Be concise - typically 1-3 lines.'
    });

    if (response.content) {
      let completion = response.content.trim();
      // Strip markdown fences
      if (completion.startsWith('```')) {
        completion = completion.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      }

      // Cache the result
      if (completionCache.size >= MAX_CACHE_SIZE) {
        const firstKey = completionCache.keys().next().value;
        if (firstKey) completionCache.delete(firstKey);
      }
      completionCache.set(cacheKey, completion);

      return { completion, model };
    }

    return null;
  } catch (error) {
    console.error('Autocomplete error:', error);
    return null;
  }
}

/**
 * Debounced autocomplete - cancels previous requests
 */
export function debouncedAutocomplete(
  request: AutocompleteRequest,
  callback: (result: AutocompleteResponse | null) => void
): () => void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    const result = await getAutocomplete(request);
    callback(result);
  }, DEBOUNCE_MS);

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };
}

/**
 * IPC handlers for autocomplete
 */
export const autocompleteIpcHandlers = {
  'ai:autocomplete': async (_event: any, request: AutocompleteRequest) => {
    return getAutocomplete(request);
  }
};
