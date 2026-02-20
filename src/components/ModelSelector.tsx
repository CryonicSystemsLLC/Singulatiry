import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Zap,
  DollarSign,
  Brain,
  Clock,
  Check,
  Sparkles
} from 'lucide-react';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens?: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  capabilities: {
    toolCalling: boolean;
    streaming: boolean;
    vision?: boolean;
    caching?: boolean;
  };
  speed: 'fast' | 'medium' | 'slow';
  quality: 'standard' | 'high' | 'premium';
  recommended?: boolean;
}

const MODELS: ModelInfo[] = [
  // OpenAI
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputCostPer1M: 2.50,
    outputCostPer1M: 10.00,
    capabilities: { toolCalling: true, streaming: true, vision: true, caching: true },
    speed: 'fast',
    quality: 'premium',
    recommended: true
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
    capabilities: { toolCalling: true, streaming: true, vision: true, caching: true },
    speed: 'fast',
    quality: 'standard'
  },

  // Anthropic
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
    capabilities: { toolCalling: true, streaming: true, vision: true, caching: true },
    speed: 'fast',
    quality: 'premium',
    recommended: true
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'Anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1M: 1.00,
    outputCostPer1M: 5.00,
    capabilities: { toolCalling: true, streaming: true, vision: true, caching: true },
    speed: 'fast',
    quality: 'standard'
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    provider: 'Anthropic',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
    capabilities: { toolCalling: true, streaming: true, vision: true, caching: true },
    speed: 'slow',
    quality: 'premium'
  },

  // Google
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'Google',
    contextWindow: 1000000,
    inputCostPer1M: 0.10,
    outputCostPer1M: 0.40,
    capabilities: { toolCalling: true, streaming: true, vision: true },
    speed: 'fast',
    quality: 'high'
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'Google',
    contextWindow: 2000000,
    inputCostPer1M: 1.25,
    outputCostPer1M: 5.00,
    capabilities: { toolCalling: true, streaming: true, vision: true },
    speed: 'medium',
    quality: 'premium'
  },

  // xAI
  {
    id: 'grok-2',
    name: 'Grok 2',
    provider: 'xAI',
    contextWindow: 131072,
    inputCostPer1M: 2.00,
    outputCostPer1M: 10.00,
    capabilities: { toolCalling: false, streaming: true },
    speed: 'fast',
    quality: 'high'
  },

  // DeepSeek
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'DeepSeek',
    contextWindow: 64000,
    inputCostPer1M: 0.14,
    outputCostPer1M: 0.28,
    capabilities: { toolCalling: false, streaming: true, caching: true },
    speed: 'fast',
    quality: 'high'
  },

  // Qwen
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'Qwen',
    contextWindow: 32000,
    inputCostPer1M: 0.80,
    outputCostPer1M: 2.00,
    capabilities: { toolCalling: false, streaming: true },
    speed: 'fast',
    quality: 'standard'
  }
];

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  availableProviders?: string[];
  showCost?: boolean;
  showCapabilities?: boolean;
  compact?: boolean;
}

export default function ModelSelector({
  selectedModel,
  onModelChange,
  availableProviders,
  showCost = true,
  showCapabilities = true,
  compact = false
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedModelInfo = MODELS.find(m => m.id === selectedModel);

  // Filter models by available providers
  const filteredModels = MODELS.filter(model => {
    if (availableProviders && !availableProviders.includes(model.provider.toLowerCase())) {
      return false;
    }
    if (filter && model.provider !== filter) {
      return false;
    }
    return true;
  });

  // Group models by provider
  const groupedModels = filteredModels.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  }, {} as Record<string, ModelInfo[]>);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatContextWindow = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
    return tokens.toString();
  };

  const formatCost = (cost: number): string => {
    if (cost < 0.01) return '<$0.01';
    return `$${cost.toFixed(2)}`;
  };

  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 bg-[#27272a] rounded-lg text-sm hover:bg-[#3f3f46] transition-colors"
        >
          <Brain size={14} className="text-purple-400" />
          <span className="text-white">{selectedModelInfo?.name || 'Select Model'}</span>
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute top-full mt-1 left-0 w-64 bg-[#18181b] border border-[#27272a] rounded-lg shadow-xl z-50 max-h-80 overflow-auto">
            {Object.entries(groupedModels).map(([provider, models]) => (
              <div key={provider}>
                <div className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-[#0f0f0f]">
                  {provider}
                </div>
                {models.map(model => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onModelChange(model.id);
                      setIsOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-[#27272a] flex items-center justify-between ${
                      model.id === selectedModel ? 'bg-[#27272a]' : ''
                    }`}
                  >
                    <span className="text-sm text-white">{model.name}</span>
                    {model.id === selectedModel && <Check size={14} className="text-purple-400" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3" ref={dropdownRef}>
      {/* Selected Model Display */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 bg-[#27272a] rounded-xl hover:bg-[#3f3f46] transition-colors text-left"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <Brain size={20} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">
                  {selectedModelInfo?.name || 'Select a Model'}
                </span>
                {selectedModelInfo?.recommended && (
                  <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] rounded">
                    Recommended
                  </span>
                )}
              </div>
              <span className="text-sm text-gray-500">
                {selectedModelInfo?.provider || 'No model selected'}
              </span>
            </div>
          </div>
          <ChevronDown size={20} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>

        {selectedModelInfo && showCapabilities && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#3f3f46]">
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Clock size={12} />
              <span>{formatContextWindow(selectedModelInfo.contextWindow)} context</span>
            </div>
            {showCost && (
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <DollarSign size={12} />
                <span>{formatCost(selectedModelInfo.inputCostPer1M)}/1M in</span>
              </div>
            )}
            {selectedModelInfo.capabilities.toolCalling && (
              <div className="flex items-center gap-1 text-xs text-green-400">
                <Zap size={12} />
                <span>Tools</span>
              </div>
            )}
          </div>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl shadow-xl overflow-hidden">
          {/* Provider Filter */}
          <div className="flex items-center gap-2 p-3 border-b border-[#27272a] overflow-x-auto">
            <button
              onClick={() => setFilter(null)}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${
                filter === null ? 'bg-purple-500 text-white' : 'bg-[#27272a] text-gray-400 hover:text-white'
              }`}
            >
              All
            </button>
            {Object.keys(groupedModels).map(provider => (
              <button
                key={provider}
                onClick={() => setFilter(provider)}
                className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${
                  filter === provider ? 'bg-purple-500 text-white' : 'bg-[#27272a] text-gray-400 hover:text-white'
                }`}
              >
                {provider}
              </button>
            ))}
          </div>

          {/* Model List */}
          <div className="max-h-80 overflow-auto">
            {Object.entries(groupedModels).map(([provider, models]) => (
              <div key={provider}>
                <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-[#0f0f0f] sticky top-0">
                  {provider}
                </div>
                {models.map(model => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onModelChange(model.id);
                      setIsOpen(false);
                    }}
                    className={`w-full p-4 text-left hover:bg-[#27272a] transition-colors ${
                      model.id === selectedModel ? 'bg-[#27272a]' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{model.name}</span>
                        {model.recommended && (
                          <Sparkles size={12} className="text-yellow-400" />
                        )}
                      </div>
                      {model.id === selectedModel && (
                        <Check size={16} className="text-purple-400" />
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-gray-500">
                        {formatContextWindow(model.contextWindow)} context
                      </span>
                      {showCost && (
                        <span className="text-gray-500">
                          {formatCost(model.inputCostPer1M)}/1M
                        </span>
                      )}
                      <span className={`${
                        model.speed === 'fast' ? 'text-green-400' :
                        model.speed === 'medium' ? 'text-yellow-400' : 'text-orange-400'
                      }`}>
                        {model.speed}
                      </span>
                      {model.capabilities.toolCalling && (
                        <span className="text-blue-400">Tools</span>
                      )}
                      {model.capabilities.vision && (
                        <span className="text-purple-400">Vision</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { MODELS };
