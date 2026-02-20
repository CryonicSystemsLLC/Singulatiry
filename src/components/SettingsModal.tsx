import React, { useState, useEffect, useCallback } from 'react';
import { X, Key, Check, AlertCircle, Loader2, Shield, Trash2 } from 'lucide-react';
import { AIProvider } from '../services/ai';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ProviderKeyState {
    hasKey: boolean;
    isValidating: boolean;
    isValid?: boolean;
    lastUpdated?: string;
}

const PROVIDER_OPTIONS: { value: AIProvider; label: string; description: string }[] = [
    { value: 'openai', label: 'OpenAI', description: 'GPT-4o, GPT-4o-mini' },
    { value: 'anthropic', label: 'Anthropic', description: 'Claude 3.5 Sonnet, Claude 3 Opus' },
    { value: 'gemini', label: 'Google Gemini', description: 'Gemini 1.5 Pro, Gemini 1.5 Flash' },
    { value: 'xai', label: 'xAI', description: 'Grok Beta' },
    { value: 'deepseek', label: 'DeepSeek', description: 'DeepSeek Chat, DeepSeek Coder' },
    { value: 'kimi', label: 'Moonshot Kimi', description: 'Moonshot v1' },
    { value: 'qwen', label: 'Alibaba Qwen', description: 'Qwen Plus, Qwen Turbo' },
];

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [selectedProvider, setSelectedProvider] = useState<AIProvider>('openai');
    const [activeProvider, setActiveProvider] = useState<AIProvider>('openai');
    const [apiKey, setApiKey] = useState('');
    const [providerStates, setProviderStates] = useState<Record<string, ProviderKeyState>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Load provider key states
    const loadProviderStates = useCallback(async () => {
        if (!window.keyStorage) return;

        const states: Record<string, ProviderKeyState> = {};
        const providers = await window.keyStorage.list();

        for (const provider of PROVIDER_OPTIONS) {
            const hasKey = providers.includes(provider.value);
            let metadata = null;
            if (hasKey) {
                metadata = await window.keyStorage.getMetadata(provider.value);
            }
            states[provider.value] = {
                hasKey,
                isValidating: false,
                lastUpdated: metadata?.lastUpdated,
            };
        }

        setProviderStates(states);
    }, []);

    // Load active provider from localStorage
    useEffect(() => {
        if (isOpen) {
            loadProviderStates();
            const storedProvider = localStorage.getItem('singularity_provider');
            if (storedProvider) {
                setActiveProvider(storedProvider as AIProvider);
                setSelectedProvider(storedProvider as AIProvider);
            }
        }
    }, [isOpen, loadProviderStates]);

    // Clear key input when switching providers
    useEffect(() => {
        setApiKey('');
        setSaveMessage(null);
    }, [selectedProvider]);

    const handleSaveKey = async () => {
        if (!apiKey.trim() || !window.keyStorage) return;

        setIsSaving(true);
        setSaveMessage(null);

        try {
            // Validate key before saving
            setProviderStates(prev => ({
                ...prev,
                [selectedProvider]: { ...prev[selectedProvider], isValidating: true }
            }));

            let isValid = true;
            if (window.modelService) {
                isValid = await window.modelService.validateKey(selectedProvider, apiKey);
            }

            if (!isValid) {
                setSaveMessage({ type: 'error', text: 'Invalid API key. Please check and try again.' });
                setProviderStates(prev => ({
                    ...prev,
                    [selectedProvider]: { ...prev[selectedProvider], isValidating: false, isValid: false }
                }));
                setIsSaving(false);
                return;
            }

            // Save the key securely
            const success = await window.keyStorage.set(selectedProvider, apiKey);

            if (success) {
                setSaveMessage({ type: 'success', text: 'API key saved securely.' });
                setProviderStates(prev => ({
                    ...prev,
                    [selectedProvider]: {
                        hasKey: true,
                        isValidating: false,
                        isValid: true,
                        lastUpdated: new Date().toISOString()
                    }
                }));
                setApiKey('');
            } else {
                setSaveMessage({ type: 'error', text: 'Failed to save API key.' });
            }
        } catch (error) {
            setSaveMessage({ type: 'error', text: 'Error saving API key.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteKey = async (provider: AIProvider) => {
        if (!window.keyStorage) return;

        const confirmed = confirm(`Delete API key for ${PROVIDER_OPTIONS.find(p => p.value === provider)?.label}?`);
        if (!confirmed) return;

        const success = await window.keyStorage.delete(provider);
        if (success) {
            setProviderStates(prev => ({
                ...prev,
                [provider]: { hasKey: false, isValidating: false }
            }));
            if (provider === activeProvider) {
                // Find another provider with a key
                const nextProvider = PROVIDER_OPTIONS.find(p =>
                    p.value !== provider && providerStates[p.value]?.hasKey
                );
                if (nextProvider) {
                    handleSetActive(nextProvider.value);
                }
            }
        }
    };

    const handleSetActive = (provider: AIProvider) => {
        if (!providerStates[provider]?.hasKey) return;
        setActiveProvider(provider);
        localStorage.setItem('singularity_provider', provider);
    };

    if (!isOpen) return null;

    const selectedProviderInfo = PROVIDER_OPTIONS.find(p => p.value === selectedProvider);
    const selectedState = providerStates[selectedProvider] || { hasKey: false, isValidating: false };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-[#18181b] w-[520px] rounded-lg border border-[#27272a] shadow-xl">
                <div className="flex justify-between items-center p-4 border-b border-[#27272a]">
                    <h2 className="text-white font-semibold flex items-center gap-2">
                        <Shield size={18} className="text-purple-400" />
                        API Key Management
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4">
                    <p className="text-xs text-gray-500 mb-4">
                        API keys are encrypted and stored securely on your device.
                    </p>

                    {/* Provider List */}
                    <div className="space-y-2 mb-6">
                        {PROVIDER_OPTIONS.map(provider => {
                            const state = providerStates[provider.value] || { hasKey: false };
                            const isActive = activeProvider === provider.value;
                            const isSelected = selectedProvider === provider.value;

                            return (
                                <div
                                    key={provider.value}
                                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                                        isSelected
                                            ? 'border-purple-500 bg-purple-500/10'
                                            : 'border-[#27272a] hover:border-[#3f3f46]'
                                    }`}
                                    onClick={() => setSelectedProvider(provider.value)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${
                                            state.hasKey ? 'bg-green-500' : 'bg-gray-600'
                                        }`} />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-white text-sm font-medium">{provider.label}</span>
                                                {isActive && (
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded uppercase font-bold">
                                                        Active
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs text-gray-500">{provider.description}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {state.hasKey && (
                                            <>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSetActive(provider.value);
                                                    }}
                                                    className={`text-xs px-2 py-1 rounded ${
                                                        isActive
                                                            ? 'text-gray-500 cursor-default'
                                                            : 'text-purple-400 hover:bg-purple-500/20'
                                                    }`}
                                                    disabled={isActive}
                                                >
                                                    {isActive ? 'In Use' : 'Use'}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteKey(provider.value);
                                                    }}
                                                    className="text-gray-500 hover:text-red-400 p-1"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Key Input Section */}
                    <div className="border-t border-[#27272a] pt-4">
                        <div className="flex items-center gap-2 mb-3">
                            <Key size={14} className="text-gray-400" />
                            <span className="text-sm text-gray-300">
                                {selectedState.hasKey ? 'Update' : 'Add'} {selectedProviderInfo?.label} Key
                            </span>
                        </div>

                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={`Enter your ${selectedProviderInfo?.label.split(' ')[0]} API Key`}
                                className="flex-1 bg-[#27272a] text-white rounded px-3 py-2 text-sm border border-transparent focus:border-purple-500 focus:outline-none placeholder-gray-600"
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                            />
                            <button
                                onClick={handleSaveKey}
                                disabled={!apiKey.trim() || isSaving}
                                className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    'Save Key'
                                )}
                            </button>
                        </div>

                        {/* Status Message */}
                        {saveMessage && (
                            <div className={`mt-3 flex items-center gap-2 text-sm ${
                                saveMessage.type === 'success' ? 'text-green-400' : 'text-red-400'
                            }`}>
                                {saveMessage.type === 'success' ? (
                                    <Check size={14} />
                                ) : (
                                    <AlertCircle size={14} />
                                )}
                                {saveMessage.text}
                            </div>
                        )}

                        {selectedState.lastUpdated && (
                            <p className="mt-2 text-xs text-gray-600">
                                Last updated: {new Date(selectedState.lastUpdated).toLocaleDateString()}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex justify-end p-4 border-t border-[#27272a]">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
