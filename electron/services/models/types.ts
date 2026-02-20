/**
 * Model Types - Core interfaces for the unified model provider layer
 */

import { Tool, OpenAITool, AnthropicTool, GeminiTool } from '../tools/registry';

// ============================================================================
// Provider Types
// ============================================================================

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'kimi'
  | 'qwen';

export type ModelId =
  | 'openai:gpt-4o'
  | 'openai:gpt-4o-mini'
  | 'openai:gpt-4-turbo'
  | 'anthropic:claude-3-5-sonnet'
  | 'anthropic:claude-3-opus'
  | 'anthropic:claude-3-haiku'
  | 'gemini:gemini-1.5-pro'
  | 'gemini:gemini-1.5-flash'
  | 'xai:grok-beta'
  | 'deepseek:deepseek-chat'
  | 'deepseek:deepseek-coder'
  | 'kimi:moonshot-v1-8k'
  | 'kimi:moonshot-v1-32k'
  | 'qwen:qwen-plus'
  | 'qwen:qwen-turbo'
  | string; // Allow custom model IDs

// ============================================================================
// Provider Configuration
// ============================================================================

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  authType: 'bearer' | 'api-key-header' | 'query-param';
  authHeaderName?: string; // For 'api-key-header' type
  authQueryParam?: string; // For 'query-param' type
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
}

export interface ModelConfig {
  id: ModelId;
  providerId: ProviderId;
  displayName: string;
  description?: string;

  // Capabilities
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;

  // Cost (per 1M tokens)
  costPerInputToken: number;
  costPerOutputToken: number;

  // Rate limits
  rateLimit: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };

  // Model-specific defaults
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

export interface ModelCapabilities {
  chat: boolean;
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  codeExecution: boolean;
  jsonMode: boolean;
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string | MessageContent[];
  name?: string; // For tool messages
  toolCallId?: string; // For tool result messages
}

export interface MessageContent {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
  tool_use?: {
    id: string;
    name: string;
    input: Record<string, any>;
  };
  tool_result?: {
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  };
}

// ============================================================================
// Request Types
// ============================================================================

export interface GenerateRequest {
  prompt: string;
  model?: ModelId;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  responseFormat?: 'text' | 'json';
}

export interface ChatRequest {
  messages: Message[];
  model?: ModelId;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  responseFormat?: 'text' | 'json';
}

export interface StreamRequest extends ChatRequest {
  onChunk?: (chunk: StreamChunk) => void;
  onComplete?: (response: ChatResponse) => void;
  onError?: (error: Error) => void;
}

export interface ToolCallRequest extends ChatRequest {
  tools: Tool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

// ============================================================================
// Response Types
// ============================================================================

export interface GenerateResponse {
  content: string;
  model: ModelId;
  usage: TokenUsage;
  finishReason: FinishReason;
  metadata?: ResponseMetadata;
}

export interface ChatResponse {
  content: string;
  role: 'assistant';
  model: ModelId;
  usage: TokenUsage;
  finishReason: FinishReason;
  toolCalls?: ToolCall[];
  metadata?: ResponseMetadata;
}

export interface StreamChunk {
  type: 'content' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
  usage?: Partial<TokenUsage>;
}

export interface ToolCallResponse extends ChatResponse {
  toolCalls: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

// ============================================================================
// Usage & Metadata
// ============================================================================

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
}

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error';

export interface ResponseMetadata {
  requestId?: string;
  latencyMs?: number;
  provider: ProviderId;
  model: ModelId;
}

// ============================================================================
// Error Types
// ============================================================================

export class ModelError extends Error {
  constructor(
    message: string,
    public code: ModelErrorCode,
    public provider?: ProviderId,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export type ModelErrorCode =
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'CONTENT_FILTERED'
  | 'MODEL_NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'UNKNOWN';

// ============================================================================
// Service Interface
// ============================================================================

export interface UnifiedModelService {
  /**
   * Simple text generation
   */
  generate(request: GenerateRequest): Promise<GenerateResponse>;

  /**
   * Chat completion
   */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /**
   * Streaming chat completion
   */
  stream(request: StreamRequest): AsyncGenerator<StreamChunk, ChatResponse>;

  /**
   * Chat with tool calling
   */
  toolCall(request: ToolCallRequest): Promise<ToolCallResponse>;

  /**
   * Count tokens in text (approximate)
   */
  countTokens(text: string, model?: ModelId): Promise<number>;

  /**
   * Get model capabilities
   */
  getCapabilities(model: ModelId): ModelCapabilities;

  /**
   * Get model configuration
   */
  getModelConfig(model: ModelId): ModelConfig | undefined;

  /**
   * List available models
   */
  listModels(): ModelConfig[];

  /**
   * Check if a model is available (has API key)
   */
  isModelAvailable(model: ModelId): Promise<boolean>;

  /**
   * Get the default model for a task type
   */
  getDefaultModel(taskType?: string): ModelId;

  /**
   * Set the default model
   */
  setDefaultModel(model: ModelId): void;
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface ModelProvider {
  id: ProviderId;
  config: ProviderConfig;

  /**
   * Generate a completion
   */
  generate(
    request: ChatRequest,
    apiKey: string
  ): Promise<ChatResponse>;

  /**
   * Generate a streaming completion
   */
  stream(
    request: StreamRequest,
    apiKey: string
  ): AsyncGenerator<StreamChunk, ChatResponse>;

  /**
   * Generate with tool calling
   */
  toolCall(
    request: ToolCallRequest,
    apiKey: string,
    toolsFormat: OpenAITool[] | AnthropicTool[] | GeminiTool
  ): Promise<ToolCallResponse>;

  /**
   * Validate API key
   */
  validateKey(apiKey: string): Promise<boolean>;
}

// ============================================================================
// Model Registry
// ============================================================================

export const PROVIDER_CONFIGS: Record<ProviderId, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    supportsStreaming: true,
    supportsToolCalling: true
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    authType: 'api-key-header',
    authHeaderName: 'x-api-key',
    supportsStreaming: true,
    supportsToolCalling: true
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'query-param',
    authQueryParam: 'key',
    supportsStreaming: true,
    supportsToolCalling: true
  },
  xai: {
    id: 'xai',
    name: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    authType: 'bearer',
    supportsStreaming: true,
    supportsToolCalling: false
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    authType: 'bearer',
    supportsStreaming: true,
    supportsToolCalling: false
  },
  kimi: {
    id: 'kimi',
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    authType: 'bearer',
    supportsStreaming: true,
    supportsToolCalling: false
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    authType: 'bearer',
    supportsStreaming: true,
    supportsToolCalling: false
  }
};

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'openai:gpt-4o': {
    id: 'openai:gpt-4o',
    providerId: 'openai',
    displayName: 'GPT-4o',
    description: 'Most capable OpenAI model with vision',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: true,
      vision: true,
      codeExecution: false,
      jsonMode: true
    },
    costPerInputToken: 2.50,
    costPerOutputToken: 10.00,
    rateLimit: { requestsPerMinute: 500, tokensPerMinute: 30000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'openai:gpt-4o-mini': {
    id: 'openai:gpt-4o-mini',
    providerId: 'openai',
    displayName: 'GPT-4o Mini',
    description: 'Fast and cost-effective',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: true,
      vision: true,
      codeExecution: false,
      jsonMode: true
    },
    costPerInputToken: 0.15,
    costPerOutputToken: 0.60,
    rateLimit: { requestsPerMinute: 500, tokensPerMinute: 200000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'anthropic:claude-3-5-sonnet': {
    id: 'anthropic:claude-3-5-sonnet',
    providerId: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
    description: 'Best for coding and analysis',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: true,
      vision: true,
      codeExecution: false,
      jsonMode: false
    },
    costPerInputToken: 3.00,
    costPerOutputToken: 15.00,
    rateLimit: { requestsPerMinute: 50, tokensPerMinute: 100000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'anthropic:claude-3-haiku': {
    id: 'anthropic:claude-3-haiku',
    providerId: 'anthropic',
    displayName: 'Claude 3 Haiku',
    description: 'Fast and efficient',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: true,
      vision: true,
      codeExecution: false,
      jsonMode: false
    },
    costPerInputToken: 0.25,
    costPerOutputToken: 1.25,
    rateLimit: { requestsPerMinute: 50, tokensPerMinute: 100000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'gemini:gemini-1.5-flash': {
    id: 'gemini:gemini-1.5-flash',
    providerId: 'gemini',
    displayName: 'Gemini 1.5 Flash',
    description: 'Fast with 1M context',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: true,
      vision: true,
      codeExecution: true,
      jsonMode: true
    },
    costPerInputToken: 0.075,
    costPerOutputToken: 0.30,
    rateLimit: { requestsPerMinute: 360, tokensPerMinute: 4000000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'gemini:gemini-1.5-pro': {
    id: 'gemini:gemini-1.5-pro',
    providerId: 'gemini',
    displayName: 'Gemini 1.5 Pro',
    description: 'Most capable Gemini model',
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: true,
      vision: true,
      codeExecution: true,
      jsonMode: true
    },
    costPerInputToken: 1.25,
    costPerOutputToken: 5.00,
    rateLimit: { requestsPerMinute: 360, tokensPerMinute: 4000000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'xai:grok-beta': {
    id: 'xai:grok-beta',
    providerId: 'xai',
    displayName: 'Grok Beta',
    description: 'xAI\'s conversational model',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: false,
      vision: false,
      codeExecution: false,
      jsonMode: false
    },
    costPerInputToken: 5.00,
    costPerOutputToken: 15.00,
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'deepseek:deepseek-chat': {
    id: 'deepseek:deepseek-chat',
    providerId: 'deepseek',
    displayName: 'DeepSeek Chat',
    description: 'Cost-effective general purpose',
    contextWindow: 64000,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: false,
      vision: false,
      codeExecution: false,
      jsonMode: false
    },
    costPerInputToken: 0.14,
    costPerOutputToken: 0.28,
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 60000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'deepseek:deepseek-coder': {
    id: 'deepseek:deepseek-coder',
    providerId: 'deepseek',
    displayName: 'DeepSeek Coder',
    description: 'Specialized for coding',
    contextWindow: 64000,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: false,
      vision: false,
      codeExecution: false,
      jsonMode: false
    },
    costPerInputToken: 0.14,
    costPerOutputToken: 0.28,
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 60000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'kimi:moonshot-v1-8k': {
    id: 'kimi:moonshot-v1-8k',
    providerId: 'kimi',
    displayName: 'Moonshot v1 8K',
    description: 'Moonshot AI model',
    contextWindow: 8000,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: false,
      vision: false,
      codeExecution: false,
      jsonMode: false
    },
    costPerInputToken: 0.12,
    costPerOutputToken: 0.12,
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 60000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  },
  'qwen:qwen-plus': {
    id: 'qwen:qwen-plus',
    providerId: 'qwen',
    displayName: 'Qwen Plus',
    description: 'Alibaba\'s advanced model',
    contextWindow: 32000,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      streaming: true,
      toolCalling: false,
      vision: false,
      codeExecution: false,
      jsonMode: false
    },
    costPerInputToken: 0.80,
    costPerOutputToken: 2.00,
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 60000 },
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096
  }
};

/**
 * Get provider ID from model ID
 */
export function getProviderFromModel(modelId: ModelId): ProviderId {
  const [provider] = modelId.split(':');
  return provider as ProviderId;
}

/**
 * Get model name from model ID
 */
export function getModelName(modelId: ModelId): string {
  const [, model] = modelId.split(':');
  return model;
}

/**
 * Parse tool call arguments from JSON string
 */
export function parseToolCallArguments(toolCall: ToolCall): ParsedToolCall {
  try {
    return {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments)
    };
  } catch {
    return {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: {}
    };
  }
}
