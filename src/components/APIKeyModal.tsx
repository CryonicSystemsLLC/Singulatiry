import React, { useState, useEffect, useCallback } from 'react';
import { X, Key, Check, AlertCircle, Loader2, Shield, Trash2 } from 'lucide-react';
import { AIProvider } from '../services/ai';

interface APIKeyModalProps {
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
    { value: 'openai', label: 'OpenAI', description: 'GPT-4o, o3-mini' },
    { value: 'anthropic', label: 'Anthropic', description: 'Claude Opus 4.6, Sonnet 4.6, Haiku 4.5' },
    { value: 'gemini', label: 'Google Gemini', description: 'Gemini 2.5 Pro, 2.5 Flash' },
    { value: 'xai', label: 'xAI', description: 'Grok 3' },
    { value: 'deepseek', label: 'DeepSeek', description: 'DeepSeek V3, DeepSeek R1' },
    { value: 'kimi', label: 'Moonshot Kimi', description: 'Moonshot v1' },
    { value: 'qwen', label: 'Alibaba Qwen', description: 'Qwen Plus' },
];

const APIKeyModal: React.FC<APIKeyModalProps> = ({ isOpen, onClose }) => {
    const [selectedProvider, setSelectedProvider] = useState<AIProvider>('openai');
    const [activeProvider, setActiveProvider] = useState<AIProvider>('openai');
    const [apiKey, setApiKey] = useState('');
    const [providerStates, setProviderStates] = useState<Record<string, ProviderKeyState>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

    useEffect(() => {
        setApiKey('');
        setSaveMessage(null);
    }, [selectedProvider]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleSaveKey = async () => {
        if (!apiKey.trim() || !window.keyStorage) return;

        setIsSaving(true);
        setSaveMessage(null);

        try {
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[var(--bg-secondary)] w-[520px] rounded-lg border border-[var(--border-primary)] shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center p-4 border-b border-[var(--border-primary)]">
                    <h2 className="text-[var(--text-primary)] font-semibold flex items-center gap-2">
                        <Shield size={18} className="text-[var(--accent-primary)]" />
                        API Key Management
                    </h2>
                    <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4">
                    <p className="text-xs text-[var(--text-muted)] mb-4">
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
                                            ? 'border-[var(--accent-primary)] bg-[var(--accent-bg)]'
                                            : 'border-[var(--border-primary)] hover:border-[var(--bg-hover)]'
                                    }`}
                                    onClick={() => setSelectedProvider(provider.value)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${
                                            state.hasKey ? 'bg-[var(--success)]' : 'bg-[var(--text-dim)]'
                                        }`} />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[var(--text-primary)] text-sm font-medium">{provider.label}</span>
                                                {isActive && (
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-[var(--accent-bg)] text-[var(--accent-primary)] rounded uppercase font-bold">
                                                        Active
                                                    </span>
                                                )}
                                            </div>
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
                                                            ? 'text-[var(--text-muted)] cursor-default'
                                                            : 'text-[var(--accent-primary)] hover:bg-[var(--accent-bg)]'
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
                                                    className="text-[var(--text-muted)] hover:text-[var(--error)] p-1"
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
                    <div className="border-t border-[var(--border-primary)] pt-4">
                        <div className="flex items-center gap-2 mb-3">
                            <Key size={14} className="text-[var(--text-secondary)]" />
                            <span className="text-sm text-[var(--text-secondary)]">
                                {selectedState.hasKey ? 'Update' : 'Add'} {selectedProviderInfo?.label} Key
                            </span>
                        </div>

                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={`Enter your ${selectedProviderInfo?.label.split(' ')[0]} API Key`}
                                className="flex-1 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded px-3 py-2 text-sm border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)]"
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                            />
                            <button
                                onClick={handleSaveKey}
                                disabled={!apiKey.trim() || isSaving}
                                className="px-4 py-2 text-sm bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--text-primary)] rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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

                        {saveMessage && (
                            <div className={`mt-3 flex items-center gap-2 text-sm ${
                                saveMessage.type === 'success' ? 'text-[var(--success)]' : 'text-[var(--error)]'
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
                            <p className="mt-2 text-xs text-[var(--text-dim)]">
                                Last updated: {new Date(selectedState.lastUpdated).toLocaleDateString()}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex justify-end p-4 border-t border-[var(--border-primary)]">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export default APIKeyModal;
