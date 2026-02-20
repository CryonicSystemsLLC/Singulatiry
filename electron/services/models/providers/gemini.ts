/**
 * Gemini Provider
 *
 * Handles API calls for Google's Gemini models.
 * Uses Google's Generative AI API format.
 */

import {
  ModelProvider,
  ChatRequest,
  ChatResponse,
  StreamRequest,
  StreamChunk,
  ToolCallRequest,
  ToolCallResponse,
  TokenUsage,
  ToolCall,
  ModelError,
  FinishReason,
  PROVIDER_CONFIGS,
  MODEL_CONFIGS,
  getModelName
} from '../types';
import { GeminiTool } from '../../tools/registry';

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, any>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, any>;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: GeminiPart[];
      role: 'model';
    };
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
    index: number;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiStreamResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
      role?: 'model';
    };
    finishReason?: string;
    index?: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

const config = PROVIDER_CONFIGS.gemini;

export const geminiProvider: ModelProvider = {
  id: 'gemini',
  config,

  async generate(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const modelConfig = MODEL_CONFIGS[request.model || ''];
    const modelName = getModelName(request.model || 'gemini-1.5-flash');

    const contents = convertMessages(request.messages, request.systemPrompt);

    const body: Record<string, any> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? modelConfig?.defaultTemperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? modelConfig?.defaultMaxTokens ?? 4096
      }
    };

    if (request.stopSequences?.length) {
      body.generationConfig.stopSequences = request.stopSequences;
    }

    if (request.responseFormat === 'json') {
      body.generationConfig.responseMimeType = 'application/json';
    }

    const url = `${config.baseUrl}/models/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await handleError(response);
    }

    const data: GeminiResponse = await response.json();

    if (!data.candidates?.length) {
      throw new ModelError('No response candidates', 'PROVIDER_ERROR', 'gemini');
    }

    const candidate = data.candidates[0];
    const textContent = candidate.content.parts
      .filter(part => part.text)
      .map(part => part.text!)
      .join('');

    const toolCalls = candidate.content.parts
      .filter(part => part.functionCall)
      .map((part, index) => ({
        id: `call_${index}`,
        type: 'function' as const,
        function: {
          name: part.functionCall!.name,
          arguments: JSON.stringify(part.functionCall!.args)
        }
      }));

    return {
      content: textContent,
      role: 'assistant',
      model: request.model || `gemini:${modelName}`,
      usage: {
        promptTokens: data.usageMetadata.promptTokenCount,
        completionTokens: data.usageMetadata.candidatesTokenCount,
        totalTokens: data.usageMetadata.totalTokenCount,
        estimatedCost: calculateCost(data.usageMetadata, modelConfig)
      },
      finishReason: mapFinishReason(candidate.finishReason),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      metadata: {
        provider: 'gemini',
        model: request.model || `gemini:${modelName}`
      }
    };
  },

  async *stream(request: StreamRequest, apiKey: string): AsyncGenerator<StreamChunk, ChatResponse> {
    const modelConfig = MODEL_CONFIGS[request.model || ''];
    const modelName = getModelName(request.model || 'gemini-1.5-flash');

    const contents = convertMessages(request.messages, request.systemPrompt);

    const body: Record<string, any> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? modelConfig?.defaultTemperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? modelConfig?.defaultMaxTokens ?? 4096
      }
    };

    if (request.stopSequences?.length) {
      body.generationConfig.stopSequences = request.stopSequences;
    }

    const url = `${config.baseUrl}/models/${modelName}:streamGenerateContent?key=${apiKey}&alt=sse`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await handleError(response);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ModelError('No response body', 'NETWORK_ERROR', 'gemini');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let usage: TokenUsage | undefined;
    let finishReason: FinishReason = 'stop';
    const toolCalls: ToolCall[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const data: GeminiStreamResponse = JSON.parse(trimmed.slice(6));

            if (data.candidates?.[0]?.content?.parts) {
              for (const part of data.candidates[0].content.parts) {
                if (part.text) {
                  fullContent += part.text;
                  yield {
                    type: 'content',
                    content: part.text
                  };
                  request.onChunk?.({ type: 'content', content: part.text });
                }

                if (part.functionCall) {
                  const toolCall: ToolCall = {
                    id: `call_${toolCalls.length}`,
                    type: 'function',
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args)
                    }
                  };
                  toolCalls.push(toolCall);
                  yield {
                    type: 'tool_call',
                    toolCall
                  };
                }
              }
            }

            if (data.candidates?.[0]?.finishReason) {
              finishReason = mapFinishReason(data.candidates[0].finishReason);
            }

            if (data.usageMetadata) {
              usage = {
                promptTokens: data.usageMetadata.promptTokenCount,
                completionTokens: data.usageMetadata.candidatesTokenCount,
                totalTokens: data.usageMetadata.totalTokenCount,
                estimatedCost: calculateCost(data.usageMetadata, modelConfig)
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
      model: request.model || `gemini:${modelName}`,
      usage: usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      metadata: {
        provider: 'gemini',
        model: request.model || `gemini:${modelName}`
      }
    };

    request.onComplete?.(finalResponse);
    return finalResponse;
  },

  async toolCall(
    request: ToolCallRequest,
    apiKey: string,
    toolsFormat: GeminiTool
  ): Promise<ToolCallResponse> {
    const modelConfig = MODEL_CONFIGS[request.model || ''];
    const modelName = getModelName(request.model || 'gemini-1.5-flash');

    const contents = convertMessages(request.messages, request.systemPrompt);

    const body: Record<string, any> = {
      contents,
      tools: [toolsFormat],
      generationConfig: {
        temperature: request.temperature ?? modelConfig?.defaultTemperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? modelConfig?.defaultMaxTokens ?? 4096
      }
    };

    // Tool choice configuration
    if (request.toolChoice) {
      if (request.toolChoice === 'auto') {
        body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
      } else if (request.toolChoice === 'required') {
        body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
      } else if (request.toolChoice === 'none') {
        body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
      } else if (typeof request.toolChoice === 'object') {
        body.toolConfig = {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [request.toolChoice.function.name]
          }
        };
      }
    }

    const url = `${config.baseUrl}/models/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await handleError(response);
    }

    const data: GeminiResponse = await response.json();

    if (!data.candidates?.length) {
      throw new ModelError('No response candidates', 'PROVIDER_ERROR', 'gemini');
    }

    const candidate = data.candidates[0];
    const textContent = candidate.content.parts
      .filter(part => part.text)
      .map(part => part.text!)
      .join('');

    const toolCalls: ToolCall[] = candidate.content.parts
      .filter(part => part.functionCall)
      .map((part, index) => ({
        id: `call_${index}`,
        type: 'function' as const,
        function: {
          name: part.functionCall!.name,
          arguments: JSON.stringify(part.functionCall!.args)
        }
      }));

    return {
      content: textContent,
      role: 'assistant',
      model: request.model || `gemini:${modelName}`,
      usage: {
        promptTokens: data.usageMetadata.promptTokenCount,
        completionTokens: data.usageMetadata.candidatesTokenCount,
        totalTokens: data.usageMetadata.totalTokenCount,
        estimatedCost: calculateCost(data.usageMetadata, modelConfig)
      },
      finishReason: mapFinishReason(candidate.finishReason),
      toolCalls,
      metadata: {
        provider: 'gemini',
        model: request.model || `gemini:${modelName}`
      }
    };
  },

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const url = `${config.baseUrl}/models?key=${apiKey}`;
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }
};

/**
 * Convert messages to Gemini format
 */
function convertMessages(messages: ChatRequest['messages'], systemPrompt?: string): GeminiContent[] {
  const contents: GeminiContent[] = [];

  // Gemini handles system prompt differently - prepend to first user message
  // or add as a separate "user" turn at the start
  if (systemPrompt) {
    contents.push({
      role: 'user',
      parts: [{ text: systemPrompt }]
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Understood. I will follow these instructions.' }]
    });
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Already handled above
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];

    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else {
      for (const c of msg.content) {
        if (c.type === 'text') {
          parts.push({ text: c.text || '' });
        } else if (c.type === 'image_url') {
          // Would need to fetch and convert to base64
          parts.push({ text: '[Image]' });
        } else if (c.type === 'tool_result') {
          parts.push({
            functionResponse: {
              name: '', // Would need to track the function name
              response: { result: c.tool_result?.content }
            }
          });
        }
      }
    }

    // Handle tool messages (function responses)
    if (msg.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: msg.name || '',
            response: {
              result: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }
          }
        }]
      });
      continue;
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return contents;
}

/**
 * Handle API error
 */
async function handleError(response: Response): Promise<ModelError> {
  let message = `API error: ${response.status} ${response.statusText}`;
  let code: ModelError['code'] = 'PROVIDER_ERROR';

  try {
    const error = await response.json();
    message = error.error?.message || error.message || message;

    if (response.status === 400 && message.includes('API key')) {
      code = 'INVALID_API_KEY';
    } else if (response.status === 429) {
      code = 'RATE_LIMITED';
    } else if (message.includes('safety')) {
      code = 'CONTENT_FILTERED';
    }
  } catch {
    // Use default message
  }

  return new ModelError(
    message,
    code,
    'gemini',
    response.status,
    response.status === 429 || response.status >= 500
  );
}

/**
 * Map Gemini finish reason
 */
function mapFinishReason(reason: string): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': return 'content_filter';
    case 'RECITATION': return 'content_filter';
    default: return 'stop';
  }
}

/**
 * Calculate cost
 */
function calculateCost(
  usage: { promptTokenCount: number; candidatesTokenCount: number },
  modelConfig?: { costPerInputToken: number; costPerOutputToken: number }
): number | undefined {
  if (!modelConfig) return undefined;

  const inputCost = (usage.promptTokenCount / 1_000_000) * modelConfig.costPerInputToken;
  const outputCost = (usage.candidatesTokenCount / 1_000_000) * modelConfig.costPerOutputToken;

  return inputCost + outputCost;
}

export default geminiProvider;
