/**
 * OpenAI-Compatible Provider
 *
 * Handles API calls for providers that use OpenAI-compatible APIs:
 * - OpenAI
 * - xAI (Grok)
 * - DeepSeek
 * - Moonshot (Kimi)
 * - Qwen (Alibaba)
 */

import {
  ModelProvider,
  ProviderConfig,
  ChatRequest,
  ChatResponse,
  StreamRequest,
  StreamChunk,
  ToolCallRequest,
  ToolCallResponse,
  TokenUsage,
  ToolCall,
  ModelError,
  ProviderId,
  PROVIDER_CONFIGS,
  MODEL_CONFIGS,
  getModelName
} from '../types';
import { OpenAITool } from '../../tools/registry';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamDelta {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Create an OpenAI-compatible provider
 */
export function createOpenAICompatibleProvider(providerId: ProviderId): ModelProvider {
  const config = PROVIDER_CONFIGS[providerId];

  if (!config) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  return {
    id: providerId,
    config,

    async generate(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
      const modelConfig = MODEL_CONFIGS[request.model || ''];
      const modelName = getModelName(request.model || 'gpt-4o');

      const messages: OpenAIMessage[] = [];

      // Add system message if provided
      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }

      // Convert messages
      for (const msg of request.messages) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(c => c.text || '').join('');

        messages.push({
          role: msg.role as 'user' | 'assistant' | 'tool',
          content,
          name: msg.name,
          tool_call_id: msg.toolCallId
        });
      }

      const body: Record<string, any> = {
        model: modelName,
        messages,
        temperature: request.temperature ?? modelConfig?.defaultTemperature ?? 0.7,
        max_tokens: request.maxTokens ?? modelConfig?.defaultMaxTokens ?? 4096
      };

      if (request.stopSequences?.length) {
        body.stop = request.stopSequences;
      }

      if (request.responseFormat === 'json') {
        body.response_format = { type: 'json_object' };
      }

      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: getHeaders(config, apiKey),
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw await handleError(response, providerId);
      }

      const data: OpenAIResponse = await response.json();
      const choice = data.choices[0];

      return {
        content: choice.message.content || '',
        role: 'assistant',
        model: request.model || `${providerId}:${modelName}`,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          estimatedCost: calculateCost(data.usage, modelConfig)
        },
        finishReason: mapFinishReason(choice.finish_reason),
        toolCalls: choice.message.tool_calls?.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: tc.function
        })),
        metadata: {
          requestId: data.id,
          provider: providerId,
          model: request.model || `${providerId}:${modelName}`
        }
      };
    },

    async *stream(request: StreamRequest, apiKey: string): AsyncGenerator<StreamChunk, ChatResponse> {
      const modelConfig = MODEL_CONFIGS[request.model || ''];
      const modelName = getModelName(request.model || 'gpt-4o');

      const messages: OpenAIMessage[] = [];

      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }

      for (const msg of request.messages) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(c => c.text || '').join('');

        messages.push({
          role: msg.role as 'user' | 'assistant' | 'tool',
          content,
          name: msg.name,
          tool_call_id: msg.toolCallId
        });
      }

      const body: Record<string, any> = {
        model: modelName,
        messages,
        temperature: request.temperature ?? modelConfig?.defaultTemperature ?? 0.7,
        max_tokens: request.maxTokens ?? modelConfig?.defaultMaxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true }
      };

      if (request.stopSequences?.length) {
        body.stop = request.stopSequences;
      }

      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: getHeaders(config, apiKey),
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw await handleError(response, providerId);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ModelError('No response body', 'NETWORK_ERROR', providerId);
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let usage: TokenUsage | undefined;
      let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' = 'stop';
      const toolCalls: Map<number, ToolCall> = new Map();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const json = JSON.parse(trimmed.slice(6)) as OpenAIStreamDelta;
              const delta = json.choices[0]?.delta;

              if (delta?.content) {
                fullContent += delta.content;
                yield {
                  type: 'content',
                  content: delta.content
                };
                request.onChunk?.({ type: 'content', content: delta.content });
              }

              // Handle tool calls in stream
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  let existing = toolCalls.get(tc.index);
                  if (!existing) {
                    existing = {
                      id: tc.id || '',
                      type: 'function',
                      function: { name: '', arguments: '' }
                    };
                    toolCalls.set(tc.index, existing);
                  }
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.function.name += tc.function.name;
                  if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;

                  yield {
                    type: 'tool_call',
                    toolCall: existing
                  };
                }
              }

              if (json.choices[0]?.finish_reason) {
                finishReason = json.choices[0].finish_reason;
              }

              if (json.usage) {
                usage = {
                  promptTokens: json.usage.prompt_tokens,
                  completionTokens: json.usage.completion_tokens,
                  totalTokens: json.usage.total_tokens,
                  estimatedCost: calculateCost(json.usage, modelConfig)
                };
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { type: 'done' };

      const finalResponse: ChatResponse = {
        content: fullContent,
        role: 'assistant',
        model: request.model || `${providerId}:${modelName}`,
        usage: usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: mapFinishReason(finishReason),
        toolCalls: toolCalls.size > 0 ? Array.from(toolCalls.values()) : undefined,
        metadata: {
          provider: providerId,
          model: request.model || `${providerId}:${modelName}`
        }
      };

      request.onComplete?.(finalResponse);
      return finalResponse;
    },

    async toolCall(
      request: ToolCallRequest,
      apiKey: string,
      toolsFormat: OpenAITool[]
    ): Promise<ToolCallResponse> {
      const modelConfig = MODEL_CONFIGS[request.model || ''];
      const modelName = getModelName(request.model || 'gpt-4o');

      const messages: OpenAIMessage[] = [];

      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }

      for (const msg of request.messages) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(c => c.text || '').join('');

        messages.push({
          role: msg.role as 'user' | 'assistant' | 'tool',
          content,
          name: msg.name,
          tool_call_id: msg.toolCallId
        });
      }

      const body: Record<string, any> = {
        model: modelName,
        messages,
        tools: toolsFormat,
        temperature: request.temperature ?? modelConfig?.defaultTemperature ?? 0.7,
        max_tokens: request.maxTokens ?? modelConfig?.defaultMaxTokens ?? 4096
      };

      if (request.toolChoice) {
        body.tool_choice = request.toolChoice;
      }

      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: getHeaders(config, apiKey),
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw await handleError(response, providerId);
      }

      const data: OpenAIResponse = await response.json();
      const choice = data.choices[0];

      return {
        content: choice.message.content || '',
        role: 'assistant',
        model: request.model || `${providerId}:${modelName}`,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          estimatedCost: calculateCost(data.usage, modelConfig)
        },
        finishReason: mapFinishReason(choice.finish_reason),
        toolCalls: choice.message.tool_calls?.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: tc.function
        })) || [],
        metadata: {
          requestId: data.id,
          provider: providerId,
          model: request.model || `${providerId}:${modelName}`
        }
      };
    },

    async validateKey(apiKey: string): Promise<boolean> {
      try {
        const response = await fetch(`${config.baseUrl}/models`, {
          method: 'GET',
          headers: getHeaders(config, apiKey)
        });
        return response.ok;
      } catch {
        return false;
      }
    }
  };
}

/**
 * Get headers for API request
 */
function getHeaders(config: ProviderConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (config.authType === 'api-key-header' && config.authHeaderName) {
    headers[config.authHeaderName] = apiKey;
  }

  return headers;
}

/**
 * Handle API error response
 */
async function handleError(response: Response, providerId: ProviderId): Promise<ModelError> {
  let message = `API error: ${response.status} ${response.statusText}`;
  let code: ModelError['code'] = 'PROVIDER_ERROR';

  try {
    const error = await response.json();
    message = error.error?.message || error.message || message;

    if (response.status === 401) {
      code = 'INVALID_API_KEY';
    } else if (response.status === 429) {
      code = 'RATE_LIMITED';
    } else if (response.status === 400 && message.includes('context')) {
      code = 'CONTEXT_LENGTH_EXCEEDED';
    }
  } catch {
    // Use default message
  }

  return new ModelError(
    message,
    code,
    providerId,
    response.status,
    response.status === 429 || response.status >= 500
  );
}

/**
 * Map OpenAI finish reason to our format
 */
function mapFinishReason(reason: string): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls': return 'tool_calls';
    case 'content_filter': return 'content_filter';
    default: return 'stop';
  }
}

/**
 * Calculate estimated cost
 */
function calculateCost(
  usage: { prompt_tokens: number; completion_tokens: number },
  modelConfig?: { costPerInputToken: number; costPerOutputToken: number }
): number | undefined {
  if (!modelConfig) return undefined;

  const inputCost = (usage.prompt_tokens / 1_000_000) * modelConfig.costPerInputToken;
  const outputCost = (usage.completion_tokens / 1_000_000) * modelConfig.costPerOutputToken;

  return inputCost + outputCost;
}

// Export pre-configured providers
export const openaiProvider = createOpenAICompatibleProvider('openai');
export const xaiProvider = createOpenAICompatibleProvider('xai');
export const deepseekProvider = createOpenAICompatibleProvider('deepseek');
export const kimiProvider = createOpenAICompatibleProvider('kimi');
export const qwenProvider = createOpenAICompatibleProvider('qwen');
