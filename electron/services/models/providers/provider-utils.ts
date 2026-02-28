/**
 * Shared Provider Utilities
 *
 * Common patterns extracted from individual provider implementations:
 * error handling, cost calculation, and SSE stream parsing.
 */

import { ModelError, ProviderId } from '../types';

/**
 * Parse an API error response into a ModelError.
 * Provider-specific classification is handled via the optional `classify` callback.
 */
export async function handleProviderError(
  response: Response,
  providerId: ProviderId,
  classify?: (status: number, message: string) => ModelError['code'] | null,
): Promise<ModelError> {
  let message = `API error: ${response.status} ${response.statusText}`;
  let code: ModelError['code'] = 'PROVIDER_ERROR';

  try {
    const error = await response.json();
    message = error.error?.message || error.message || message;

    const custom = classify?.(response.status, message);
    if (custom) {
      code = custom;
    } else {
      if (response.status === 401) code = 'INVALID_API_KEY';
      else if (response.status === 429) code = 'RATE_LIMITED';
    }
  } catch {
    // Use default message
  }

  return new ModelError(
    message,
    code,
    providerId,
    response.status,
    response.status === 429 || response.status >= 500,
  );
}

/**
 * Calculate estimated cost from token counts and model pricing.
 * Each provider maps its response-specific field names before calling this.
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  modelConfig?: { costPerInputToken: number; costPerOutputToken: number },
): number | undefined {
  if (!modelConfig) return undefined;
  return (inputTokens / 1_000_000) * modelConfig.costPerInputToken +
         (outputTokens / 1_000_000) * modelConfig.costPerOutputToken;
}

/**
 * Async generator that reads SSE lines from a fetch response body.
 * Yields trimmed, non-empty lines. Handles buffering across chunk boundaries.
 */
export async function* readSSELines(
  response: Response,
  providerId: ProviderId,
): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ModelError('No response body', 'NETWORK_ERROR', providerId);
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) yield trimmed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
