/**
 * Unified Model Service
 *
 * Single interface for interacting with all AI model providers.
 * Handles provider selection, API key management, and request routing.
 */

import {
  UnifiedModelService,
  ModelProvider,
  ModelConfig,
  ModelCapabilities,
  GenerateRequest,
  GenerateResponse,
  ChatRequest,
  ChatResponse,
  StreamRequest,
  StreamChunk,
  ToolCallRequest,
  ToolCallResponse,
  ModelError,
  ModelId,
  ProviderId,
  MODEL_CONFIGS,
  PROVIDER_CONFIGS,
  getProviderFromModel
} from './types';
import { ToolRegistry, globalToolRegistry } from '../tools/registry';
import { getKeyStorage } from '../keychain';

// Import providers
import {
  openaiProvider,
  xaiProvider,
  deepseekProvider,
  kimiProvider,
  qwenProvider
} from './providers/openai';
import { anthropicProvider } from './providers/anthropic';
import { geminiProvider } from './providers/gemini';

/**
 * Map of all available providers
 */
const PROVIDERS: Record<ProviderId, ModelProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  xai: xaiProvider,
  deepseek: deepseekProvider,
  kimi: kimiProvider,
  qwen: qwenProvider
};

/**
 * Default models for different task types
 */
const DEFAULT_MODELS: Record<string, ModelId> = {
  default: 'anthropic:claude-3-5-sonnet',
  planning: 'anthropic:claude-3-5-sonnet',
  coding: 'anthropic:claude-3-5-sonnet',
  quick: 'deepseek:deepseek-chat',
  explain: 'openai:gpt-4o-mini',
  review: 'openai:gpt-4o'
};

/**
 * Unified Model Service Implementation
 */
class UnifiedModelServiceImpl implements UnifiedModelService {
  private defaultModel: ModelId = 'anthropic:claude-3-5-sonnet';
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry?: ToolRegistry) {
    this.toolRegistry = toolRegistry || globalToolRegistry;
  }

  /**
   * Simple text generation
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model || this.defaultModel;
    const provider = this.getProvider(model);
    const apiKey = await this.getApiKey(model);

    // Convert to chat format
    const chatRequest: ChatRequest = {
      messages: [{ role: 'user', content: request.prompt }],
      model,
      systemPrompt: request.systemPrompt,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      stopSequences: request.stopSequences,
      responseFormat: request.responseFormat
    };

    const response = await provider.generate(chatRequest, apiKey);

    return {
      content: response.content,
      model: response.model,
      usage: response.usage,
      finishReason: response.finishReason,
      metadata: response.metadata
    };
  }

  /**
   * Chat completion
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model || this.defaultModel;
    const provider = this.getProvider(model);
    const apiKey = await this.getApiKey(model);

    return provider.generate(request, apiKey);
  }

  /**
   * Streaming chat completion
   */
  async *stream(request: StreamRequest): AsyncGenerator<StreamChunk, ChatResponse> {
    const model = request.model || this.defaultModel;
    const provider = this.getProvider(model);
    const apiKey = await this.getApiKey(model);

    return yield* provider.stream(request, apiKey);
  }

  /**
   * Chat with tool calling
   */
  async toolCall(request: ToolCallRequest): Promise<ToolCallResponse> {
    const model = request.model || this.defaultModel;
    const providerId = getProviderFromModel(model);
    const provider = this.getProvider(model);
    const apiKey = await this.getApiKey(model);
    const providerConfig = PROVIDER_CONFIGS[providerId];

    // Convert tools to provider-specific format
    let toolsFormat: any;

    if (providerConfig.supportsToolCalling) {
      // Use native tool calling
      if (providerId === 'anthropic') {
        toolsFormat = this.toolRegistry.toAnthropicFormat(
          request.tools.map(t => t.name)
        );
      } else if (providerId === 'gemini') {
        toolsFormat = this.toolRegistry.toGeminiFormat(
          request.tools.map(t => t.name)
        );
      } else {
        toolsFormat = this.toolRegistry.toOpenAIFormat(
          request.tools.map(t => t.name)
        );
      }

      return provider.toolCall(request, apiKey, toolsFormat);
    } else {
      // Simulate tool calling via prompting
      return this.simulateToolCall(request, provider, apiKey);
    }
  }

  /**
   * Simulate tool calling for providers that don't support it natively
   */
  private async simulateToolCall(
    request: ToolCallRequest,
    provider: ModelProvider,
    apiKey: string
  ): Promise<ToolCallResponse> {
    // Add tool descriptions to system prompt
    const toolPrompt = this.toolRegistry.toPromptFormat(
      request.tools.map(t => t.name)
    );

    const enhancedSystemPrompt = `${request.systemPrompt || ''}\n\n${toolPrompt}`;

    const chatRequest: ChatRequest = {
      ...request,
      systemPrompt: enhancedSystemPrompt
    };

    const response = await provider.generate(chatRequest, apiKey);

    // Parse tool calls from response
    const toolCalls = this.toolRegistry.parseToolCalls(response.content);

    return {
      ...response,
      toolCalls: toolCalls.map((tc, index) => ({
        id: `simulated_${index}`,
        type: 'function' as const,
        function: {
          name: tc.tool,
          arguments: JSON.stringify(tc.params)
        }
      })),
      finishReason: toolCalls.length > 0 ? 'tool_calls' : response.finishReason
    };
  }

  /**
   * Count tokens in text (approximate)
   */
  async countTokens(text: string, _model?: ModelId): Promise<number> {
    // Simple approximation: ~4 characters per token for English
    // This is a rough estimate - for accurate counts, use provider-specific APIs
    // _model parameter reserved for future provider-specific token counting
    return Math.ceil(text.length / 4);
  }

  /**
   * Get model capabilities
   */
  getCapabilities(model: ModelId): ModelCapabilities {
    const config = MODEL_CONFIGS[model];
    if (config) {
      return config.capabilities;
    }

    // Default capabilities for unknown models
    return {
      chat: true,
      streaming: true,
      toolCalling: false,
      vision: false,
      codeExecution: false,
      jsonMode: false
    };
  }

  /**
   * Get model configuration
   */
  getModelConfig(model: ModelId): ModelConfig | undefined {
    return MODEL_CONFIGS[model];
  }

  /**
   * List available models
   */
  listModels(): ModelConfig[] {
    return Object.values(MODEL_CONFIGS);
  }

  /**
   * Check if a model is available (has API key)
   */
  async isModelAvailable(model: ModelId): Promise<boolean> {
    const providerId = getProviderFromModel(model);
    const keyStorage = getKeyStorage();
    return keyStorage.hasKey(providerId);
  }

  /**
   * Get the default model for a task type
   */
  getDefaultModel(taskType?: string): ModelId {
    if (taskType && DEFAULT_MODELS[taskType]) {
      return DEFAULT_MODELS[taskType];
    }
    return this.defaultModel;
  }

  /**
   * Set the default model
   */
  setDefaultModel(model: ModelId): void {
    if (!MODEL_CONFIGS[model]) {
      console.warn(`Unknown model: ${model}. Using anyway.`);
    }
    this.defaultModel = model;
  }

  /**
   * Get provider for a model
   */
  private getProvider(model: ModelId): ModelProvider {
    const providerId = getProviderFromModel(model);
    const provider = PROVIDERS[providerId];

    if (!provider) {
      throw new ModelError(
        `Unknown provider: ${providerId}`,
        'PROVIDER_ERROR',
        providerId
      );
    }

    return provider;
  }

  /**
   * Get API key for a model's provider
   */
  private async getApiKey(model: ModelId): Promise<string> {
    const providerId = getProviderFromModel(model);
    const keyStorage = getKeyStorage();
    const apiKey = await keyStorage.getKey(providerId);

    if (!apiKey) {
      throw new ModelError(
        `No API key configured for ${providerId}. Please add your API key in Settings.`,
        'INVALID_API_KEY',
        providerId
      );
    }

    return apiKey;
  }

  /**
   * Validate API key for a provider
   */
  async validateApiKey(providerId: ProviderId): Promise<boolean> {
    const provider = PROVIDERS[providerId];
    if (!provider) return false;

    const keyStorage = getKeyStorage();
    const apiKey = await keyStorage.getKey(providerId);
    if (!apiKey) return false;

    return provider.validateKey(apiKey);
  }

  /**
   * Get list of providers with valid API keys
   */
  async getAvailableProviders(): Promise<ProviderId[]> {
    const keyStorage = getKeyStorage();
    const providers = await keyStorage.listProviders();
    return providers as ProviderId[];
  }

  /**
   * Get available models (those with API keys configured)
   */
  async getAvailableModels(): Promise<ModelConfig[]> {
    const availableProviders = await this.getAvailableProviders();
    return this.listModels().filter(model =>
      availableProviders.includes(model.providerId)
    );
  }
}

// Singleton instance
let modelServiceInstance: UnifiedModelServiceImpl | null = null;

/**
 * Get the unified model service instance
 */
export function getModelService(toolRegistry?: ToolRegistry): UnifiedModelService {
  if (!modelServiceInstance) {
    modelServiceInstance = new UnifiedModelServiceImpl(toolRegistry);
  }
  return modelServiceInstance;
}

/**
 * Create a new model service instance (for testing or isolation)
 */
export function createModelService(toolRegistry?: ToolRegistry): UnifiedModelService {
  return new UnifiedModelServiceImpl(toolRegistry);
}

/**
 * IPC handlers for model operations
 */
export const modelServiceIpcHandlers = {
  'model:generate': async (
    _event: any,
    request: GenerateRequest
  ): Promise<GenerateResponse> => {
    const service = getModelService();
    return service.generate(request);
  },

  'model:chat': async (
    _event: any,
    request: ChatRequest
  ): Promise<ChatResponse> => {
    const service = getModelService();
    return service.chat(request);
  },

  'model:tool-call': async (
    _event: any,
    request: ToolCallRequest
  ): Promise<ToolCallResponse> => {
    const service = getModelService();
    return service.toolCall(request);
  },

  'model:count-tokens': async (
    _event: any,
    text: string,
    model?: ModelId
  ): Promise<number> => {
    const service = getModelService();
    return service.countTokens(text, model);
  },

  'model:get-capabilities': (
    _event: any,
    model: ModelId
  ): ModelCapabilities => {
    const service = getModelService();
    return service.getCapabilities(model);
  },

  'model:list': (): ModelConfig[] => {
    const service = getModelService();
    return service.listModels();
  },

  'model:available': async (): Promise<ModelConfig[]> => {
    const service = getModelService() as UnifiedModelServiceImpl;
    return service.getAvailableModels();
  },

  'model:validate-key': async (
    _event: any,
    providerId: ProviderId
  ): Promise<boolean> => {
    const service = getModelService() as UnifiedModelServiceImpl;
    return service.validateApiKey(providerId);
  },

  'model:set-default': (_event: any, model: ModelId): void => {
    const service = getModelService();
    service.setDefaultModel(model);
  },

  'model:get-default': (_event: any, taskType?: string): ModelId => {
    const service = getModelService();
    return service.getDefaultModel(taskType);
  }
};

export default UnifiedModelServiceImpl;
