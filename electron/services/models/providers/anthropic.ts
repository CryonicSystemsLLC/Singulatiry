/**
 * Anthropic Provider
 *
 * Handles API calls for Anthropic's Claude models.
 * Uses Anthropic's native Messages API format.
 */

import {
  ModelProvider,
  ChatRequest,
  ChatResponse,
  StreamRequest,
  StreamChunk,
  ToolCallRequest,
  ToolCallResponse,
  ToolCall,
  ModelError,
  FinishReason,
  PROVIDER_CONFIGS,
  MODEL_CONFIGS,
  getModelName
} from '../types';
import { AnthropicTool } from '../../tools/registry';
import { handleProviderError, calculateCost as calcCost, readSSELines } from './provider-utils';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  id?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop' | 'error';
  message?: Partial<AnthropicResponse>;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: {
    type: 'text_delta' | 'input_json_delta' | 'thinking_delta';
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
    stop_sequence?: string;
  };
  usage?: {
    output_tokens: number;
  };
  error?: {
    type: string;
    message: string;
  };
}

const config = PROVIDER_CONFIGS.anthropic;

export const anthropicProvider: ModelProvider = {
  id: 'anthropic',
  config,

  async generate(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const modelConfig = MODEL_CONFIGS[request.model || ''];
    const modelName = getModelName(request.model || 'claude-sonnet-4-6');

    const messages = convertMessages(request.messages);

    const body: Record<string, any> = {
      model: modelName,
      messages,
      max_tokens: request.maxTokens ?? modelConfig?.defaultMaxTokens ?? 4096,
      temperature: request.temperature ?? modelConfig?.defaultTemperature ?? 0.7
    };

    if (request.systemPrompt) {
      body.system = [{ type: 'text', text: request.systemPrompt, cache_control: { type: 'ephemeral' } }];
    }

    if (request.stopSequences?.length) {
      body.stop_sequences = request.stopSequences;
    }

    // Extended thinking support
    if (request.thinking?.enabled) {
      body.thinking = { type: 'enabled', budget_tokens: request.thinking.budgetTokens || 10000 };
      // Thinking requires temperature = 1
      body.temperature = 1;
    }

    const response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: getHeaders(apiKey, { thinking: request.thinking?.enabled, caching: true }),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await handleProviderError(response, 'anthropic', (s, m) => s === 400 && m.includes('token') ? 'CONTEXT_LENGTH_EXCEEDED' : null);
    }

    const data: AnthropicResponse = await response.json();

    // Extract text content
    const textContent = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('');

    // Extract tool calls
    const toolCalls = data.content
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        id: block.id!,
        type: 'function' as const,
        function: {
          name: block.name!,
          arguments: JSON.stringify(block.input)
        }
      }));

    return {
      content: textContent,
      role: 'assistant',
      model: request.model || `anthropic:${modelName}`,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        estimatedCost: calcCost(data.usage.input_tokens, data.usage.output_tokens, modelConfig)
      },
      finishReason: mapStopReason(data.stop_reason),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      metadata: {
        requestId: data.id,
        provider: 'anthropic',
        model: request.model || `anthropic:${modelName}`
      }
    };
  },

  async *stream(request: StreamRequest, apiKey: string): AsyncGenerator<StreamChunk, ChatResponse> {
    const modelConfig = MODEL_CONFIGS[request.model || ''];
    const modelName = getModelName(request.model || 'claude-sonnet-4-6');

    const messages = convertMessages(request.messages);

    const body: Record<string, any> = {
      model: modelName,
      messages,
      max_tokens: request.maxTokens ?? modelConfig?.defaultMaxTokens ?? 4096,
      temperature: request.temperature ?? modelConfig?.defaultTemperature ?? 0.7,
      stream: true
    };

    if (request.systemPrompt) {
      body.system = [{ type: 'text', text: request.systemPrompt, cache_control: { type: 'ephemeral' } }];
    }

    if (request.stopSequences?.length) {
      body.stop_sequences = request.stopSequences;
    }

    // Extended thinking support
    if (request.thinking?.enabled) {
      body.thinking = { type: 'enabled', budget_tokens: request.thinking.budgetTokens || 10000 };
      body.temperature = 1;
    }

    const response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: getHeaders(apiKey, { thinking: request.thinking?.enabled, caching: true }),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await handleProviderError(response, 'anthropic', (s, m) => s === 400 && m.includes('token') ? 'CONTEXT_LENGTH_EXCEEDED' : null);
    }

    let fullContent = '';
    let thinkingContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: FinishReason = 'stop';
    const toolCalls: ToolCall[] = [];
    let currentToolCall: ToolCall | null = null;
    let currentToolIndex = -1;

    for await (const line of readSSELines(response, 'anthropic')) {
      if (!line.startsWith('data: ')) continue;

      try {
        const event: AnthropicStreamEvent = JSON.parse(line.slice(6));

        switch (event.type) {
          case 'message_start':
            if (event.message?.usage?.input_tokens) {
              inputTokens = event.message.usage.input_tokens;
            }
            break;

          case 'content_block_start':
            if (event.content_block?.type === 'tool_use') {
              currentToolCall = {
                id: event.content_block.id!,
                type: 'function',
                function: { name: event.content_block.name!, arguments: '' },
              };
              currentToolIndex = event.index!;
            }
            break;

          case 'content_block_delta':
            if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
              thinkingContent += event.delta.thinking;
              yield { type: 'thinking', thinking: event.delta.thinking };
              request.onChunk?.({ type: 'thinking', thinking: event.delta.thinking });
            } else if (event.delta?.type === 'text_delta' && event.delta.text) {
              fullContent += event.delta.text;
              yield { type: 'content', content: event.delta.text };
              request.onChunk?.({ type: 'content', content: event.delta.text });
            } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json && currentToolCall) {
              currentToolCall.function.arguments += event.delta.partial_json;
              yield { type: 'tool_call', toolCall: currentToolCall };
            }
            break;

          case 'content_block_stop':
            if (currentToolCall && currentToolIndex === event.index) {
              toolCalls.push(currentToolCall);
              currentToolCall = null;
              currentToolIndex = -1;
            }
            break;

          case 'message_delta':
            if (event.delta?.stop_reason) {
              finishReason = mapStopReason(event.delta.stop_reason as any);
            }
            if (event.usage?.output_tokens) {
              outputTokens = event.usage.output_tokens;
            }
            break;

          case 'error':
            yield { type: 'error', error: event.error?.message || 'Unknown error' };
            throw new ModelError(event.error?.message || 'Stream error', 'PROVIDER_ERROR', 'anthropic');
        }
      } catch (e) {
        if (e instanceof ModelError) throw e;
        // Skip malformed JSON
      }
    }

    yield { type: 'done' };

    const finalResponse: ChatResponse = {
      content: fullContent,
      role: 'assistant',
      model: request.model || `anthropic:${modelName}`,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCost: calcCost(inputTokens, outputTokens, modelConfig)
      },
      finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      metadata: {
        provider: 'anthropic',
        model: request.model || `anthropic:${modelName}`
      }
    };

    request.onComplete?.(finalResponse);
    return finalResponse;
  },

  async toolCall(
    request: ToolCallRequest,
    apiKey: string,
    toolsFormat: AnthropicTool[]
  ): Promise<ToolCallResponse> {
    const modelConfig = MODEL_CONFIGS[request.model || ''];
    const modelName = getModelName(request.model || 'claude-sonnet-4-6');

    const messages = convertMessages(request.messages);

    const body: Record<string, any> = {
      model: modelName,
      messages,
      tools: toolsFormat,
      max_tokens: request.maxTokens ?? modelConfig?.defaultMaxTokens ?? 4096,
      temperature: request.temperature ?? modelConfig?.defaultTemperature ?? 0.7
    };

    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    if (request.toolChoice) {
      if (request.toolChoice === 'auto') {
        body.tool_choice = { type: 'auto' };
      } else if (request.toolChoice === 'required') {
        body.tool_choice = { type: 'any' };
      } else if (request.toolChoice === 'none') {
        // Don't include tools
        delete body.tools;
      } else if (typeof request.toolChoice === 'object') {
        body.tool_choice = {
          type: 'tool',
          name: request.toolChoice.function.name
        };
      }
    }

    const response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await handleProviderError(response, 'anthropic', (s, m) => s === 400 && m.includes('token') ? 'CONTEXT_LENGTH_EXCEEDED' : null);
    }

    const data: AnthropicResponse = await response.json();

    // Extract text content
    const textContent = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('');

    // Extract tool calls
    const toolCalls: ToolCall[] = data.content
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        id: block.id!,
        type: 'function' as const,
        function: {
          name: block.name!,
          arguments: JSON.stringify(block.input)
        }
      }));

    return {
      content: textContent,
      role: 'assistant',
      model: request.model || `anthropic:${modelName}`,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        estimatedCost: calcCost(data.usage.input_tokens, data.usage.output_tokens, modelConfig)
      },
      finishReason: mapStopReason(data.stop_reason),
      toolCalls,
      metadata: {
        requestId: data.id,
        provider: 'anthropic',
        model: request.model || `anthropic:${modelName}`
      }
    };
  },

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      // Anthropic doesn't have a /models endpoint, so we make a minimal request
      const response = await fetch(`${config.baseUrl}/messages`, {
        method: 'POST',
        headers: getHeaders(apiKey),
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1
        })
      });

      // 200 = valid, 401 = invalid key, anything else might be rate limit etc
      return response.ok || response.status !== 401;
    } catch {
      return false;
    }
  }
};

/**
 * Convert our message format to Anthropic's format
 */
function convertMessages(messages: ChatRequest['messages']): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // System messages are handled separately in Anthropic API
      continue;
    }

    if (msg.role === 'tool') {
      // Tool results need to be added to the previous assistant message
      // or as a user message with tool_result content block
      result.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.toolCallId!,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        }]
      });
      continue;
    }

    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content.map(c => {
          if (c.type === 'text') {
            return { type: 'text' as const, text: c.text || '' };
          } else if (c.type === 'image_url') {
            // Would need to convert URL to base64 for Anthropic
            return { type: 'text' as const, text: '[Image]' };
          }
          return { type: 'text' as const, text: '' };
        });

    result.push({
      role: msg.role as 'user' | 'assistant',
      content
    });
  }

  return result;
}

/**
 * Get headers for Anthropic API
 */
function getHeaders(apiKey: string, options?: { thinking?: boolean; caching?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };

  const betas: string[] = [];
  if (options?.thinking) betas.push('interleaved-thinking-2025-05-14');
  if (options?.caching) betas.push('prompt-caching-2024-07-31');
  if (betas.length > 0) {
    headers['anthropic-beta'] = betas.join(',');
  }

  return headers;
}

/**
 * Handle API error
 */
/**
 * Map Anthropic stop reason to our format
 */
function mapStopReason(reason: string): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'max_tokens': return 'length';
    case 'stop_sequence': return 'stop';
    case 'tool_use': return 'tool_calls';
    default: return 'stop';
  }
}

export default anthropicProvider;
