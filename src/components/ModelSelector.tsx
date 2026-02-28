import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronLeft, Check, Brain, Key, Server, Pencil, Loader2, AlertCircle } from 'lucide-react';

// ── Providers ────────────────────────────────────────────────────────────────

interface Provider {
  id: string;
  name: string;
  color: string;
}

const PROVIDERS: Provider[] = [
  { id: 'openai',    name: 'OpenAI',    color: '#10a37f' },
  { id: 'anthropic', name: 'Anthropic', color: '#d4a27f' },
  { id: 'gemini',    name: 'Google',    color: '#4285f4' },
  { id: 'xai',       name: 'xAI',       color: '#1da1f2' },
  { id: 'deepseek',  name: 'DeepSeek',  color: '#4d6bfe' },
  { id: 'qwen',      name: 'Qwen',      color: '#6f42c1' },
  { id: 'kimi',      name: 'Moonshot',  color: '#ff6b35' },
  { id: 'mistral',   name: 'Mistral',   color: '#ff7000' },
  { id: 'cohere',    name: 'Cohere',    color: '#39594d' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function parseSelection(sel: string): { providerId: string; model: string } {
  const idx = sel.indexOf(':');
  if (idx === -1) return { providerId: 'anthropic', model: sel };
  return { providerId: sel.substring(0, idx), model: sel.substring(idx + 1) };
}

function fmt(providerId: string, model: string) { return `${providerId}:${model}`; }

function getProvider(id: string) { return PROVIDERS.find(p => p.id === id); }

// ── Types ────────────────────────────────────────────────────────────────────

interface FetchedModel {
  id: string;
  name: string;
}

type ViewState = 'providers' | 'api-key' | 'loading' | 'models' | 'custom';

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  selectedModel: string;
  onModelChange: (id: string) => void;
  compact?: boolean;
  availableProviders?: string[];
  showCost?: boolean;
  showCapabilities?: boolean;
}

export default function ModelSelector({ selectedModel, onModelChange }: Props) {
  const { providerId, model } = parseSelection(selectedModel);
  const provider = getProvider(providerId);

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ViewState>('providers');
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, boolean>>({});
  const [modelCache, setModelCache] = useState<Record<string, FetchedModel[]>>({});
  const [customUrl, setCustomUrl] = useState('');
  const [customModel, setCustomModel] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  // Check which providers have API keys on mount
  useEffect(() => {
    (async () => {
      try {
        const keys: Record<string, boolean> = {};
        for (const p of PROVIDERS) {
          const k = await (window as any).keyStorage?.get(p.id);
          keys[p.id] = !!k;
        }
        setConfiguredKeys(keys);
      } catch { /* keyStorage may not exist */ }
    })();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setView('providers');
        setActiveProvider(null);
        setError(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus key input when entering api-key view
  useEffect(() => {
    if (view === 'api-key') keyInputRef.current?.focus();
  }, [view]);

  const displayName = provider?.name || providerId;

  // Fetch models from the provider API
  const fetchModels = useCallback(async (pid: string, apiKey: string): Promise<{ success: boolean; models: FetchedModel[]; error?: string }> => {
    try {
      return await (window as any).ipcRenderer.invoke('provider:fetch-models', pid, apiKey);
    } catch (err: any) {
      return { success: false, models: [], error: err.message };
    }
  }, []);

  // When clicking a provider
  const handleProviderClick = useCallback(async (p: Provider) => {
    if (configuredKeys[p.id]) {
      // Has key — check cache first
      if (modelCache[p.id]?.length) {
        setActiveProvider(p.id);
        setFetchedModels(modelCache[p.id]);
        setView('models');
        return;
      }
      // Fetch models using saved key
      setActiveProvider(p.id);
      setView('loading');
      setError(null);
      const apiKey = await (window as any).keyStorage?.get(p.id);
      const result = await fetchModels(p.id, apiKey);
      if (result.success && result.models.length) {
        setFetchedModels(result.models);
        setModelCache(prev => ({ ...prev, [p.id]: result.models }));
        setView('models');
      } else {
        // Key might be expired/invalid — ask for new one
        setError(result.error || 'Could not fetch models. Re-enter your API key.');
        setKeyInput('');
        setView('api-key');
      }
      return;
    }
    // No key — show API key entry
    setActiveProvider(p.id);
    setKeyInput('');
    setError(null);
    setView('api-key');
  }, [configuredKeys, modelCache, fetchModels]);

  // Save API key, validate by fetching models
  const handleConnect = useCallback(async () => {
    if (!activeProvider || !keyInput.trim()) return;
    setView('loading');
    setError(null);
    try {
      const result = await fetchModels(activeProvider, keyInput.trim());
      if (result.success && result.models.length) {
        // Key works — save it
        await (window as any).keyStorage?.set(activeProvider, keyInput.trim());
        setConfiguredKeys(prev => ({ ...prev, [activeProvider]: true }));
        setFetchedModels(result.models);
        setModelCache(prev => ({ ...prev, [activeProvider]: result.models }));
        setView('models');
      } else {
        setError(result.error || 'Invalid key or no models found.');
        setView('api-key');
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      setView('api-key');
    }
  }, [activeProvider, keyInput, fetchModels]);

  // Select a model from the fetched list
  const handleModelSelect = useCallback((m: FetchedModel) => {
    if (!activeProvider) return;
    onModelChange(fmt(activeProvider, m.id));
    setIsOpen(false);
    setView('providers');
    setActiveProvider(null);
  }, [activeProvider, onModelChange]);

  const handleBack = useCallback(() => {
    setView('providers');
    setActiveProvider(null);
    setError(null);
  }, []);

  // Edit existing provider key
  const handleEdit = useCallback(async (pid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const existing = await (window as any).keyStorage?.get(pid);
    setActiveProvider(pid);
    setKeyInput(existing || '');
    setError(null);
    setView('api-key');
  }, []);

  // Save custom endpoint
  const handleCustomSave = useCallback(async () => {
    if (!customUrl.trim() || !customModel.trim()) return;
    try {
      if (keyInput.trim()) {
        await (window as any).keyStorage?.set('custom', keyInput.trim());
      }
      localStorage.setItem('singularity_custom_url', customUrl.trim());
      localStorage.setItem('singularity_custom_model', customModel.trim());
      onModelChange(fmt('custom', customModel.trim()));
      setIsOpen(false);
      setView('providers');
      setActiveProvider(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    }
  }, [customUrl, customModel, keyInput, onModelChange]);

  const ap = activeProvider ? getProvider(activeProvider) : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger */}
      <button
        onClick={() => { setIsOpen(!isOpen); setView('providers'); setActiveProvider(null); setError(null); }}
        className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-sm hover:bg-[var(--bg-hover)] transition-colors"
      >
        <Brain size={14} style={{ color: provider?.color || 'var(--accent-primary)' }} />
        <span className="text-[var(--text-primary)]">{displayName}</span>
        <ChevronDown size={14} className={`text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-1 left-0 w-72 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 overflow-hidden">

          {/* ── API Key Entry ── */}
          {view === 'api-key' && ap && (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-3">
                <button onClick={handleBack} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <ChevronLeft size={16} />
                </button>
                <div className="w-5 h-5 rounded flex items-center justify-center" style={{ backgroundColor: ap.color + '22' }}>
                  <Brain size={12} style={{ color: ap.color }} />
                </div>
                <span className="text-sm font-medium text-[var(--text-primary)]">{ap.name}</span>
              </div>

              {error && (
                <div className="flex items-center gap-1.5 mb-2 px-1 text-xs text-[var(--error)]">
                  <AlertCircle size={12} className="flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5 block">API Key</label>
                <input
                  ref={keyInputRef}
                  type="password"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleConnect(); }}
                  placeholder="sk-..."
                  className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded px-2 py-1.5 text-xs border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleConnect}
                  disabled={!keyInput.trim()}
                  className="flex-1 px-2 py-1.5 text-xs bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white rounded disabled:opacity-40"
                >
                  Connect
                </button>
                <button
                  onClick={handleBack}
                  className="px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Loading ── */}
          {view === 'loading' && (
            <div className="p-6 flex flex-col items-center gap-2">
              <Loader2 size={20} className="text-[var(--accent-primary)] animate-spin" />
              <span className="text-xs text-[var(--text-muted)]">Fetching models...</span>
            </div>
          )}

          {/* ── Custom Endpoint ── */}
          {view === 'custom' && (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-3">
                <button onClick={handleBack} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <ChevronLeft size={16} />
                </button>
                <div className="w-5 h-5 rounded flex items-center justify-center bg-[var(--info)]/20">
                  <Server size={12} className="text-[var(--info)]" />
                </div>
                <span className="text-sm font-medium text-[var(--text-primary)]">Custom Endpoint</span>
              </div>

              {error && (
                <div className="flex items-center gap-1.5 mb-2 px-1 text-xs text-[var(--error)]">
                  <AlertCircle size={12} className="flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5 block">Base URL</label>
                  <input
                    value={customUrl}
                    onChange={e => setCustomUrl(e.target.value)}
                    placeholder="http://localhost:11434/v1"
                    className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded px-2 py-1.5 text-xs border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5 block">API Key <span className="normal-case text-[var(--text-dim)]">(optional)</span></label>
                  <input
                    type="password"
                    value={keyInput}
                    onChange={e => setKeyInput(e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded px-2 py-1.5 text-xs border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5 block">Model Name</label>
                  <input
                    value={customModel}
                    onChange={e => setCustomModel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCustomSave(); }}
                    placeholder="llama3, mistral, etc."
                    className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded px-2 py-1.5 text-xs border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)]"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleCustomSave}
                    disabled={!customUrl.trim() || !customModel.trim()}
                    className="flex-1 px-2 py-1.5 text-xs bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white rounded disabled:opacity-40"
                  >
                    Save & Use
                  </button>
                  <button
                    onClick={handleBack}
                    className="px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Model Picker ── */}
          {view === 'models' && ap && (
            <div>
              <div className="px-3 py-2 border-b border-[var(--border-primary)] flex items-center gap-2">
                <button onClick={handleBack} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <ChevronLeft size={16} />
                </button>
                <div className="w-5 h-5 rounded flex items-center justify-center" style={{ backgroundColor: ap.color + '22' }}>
                  <Brain size={12} style={{ color: ap.color }} />
                </div>
                <span className="text-sm font-medium text-[var(--text-primary)]">{ap.name} Models</span>
                <span className="text-[10px] text-[var(--text-dim)] ml-auto">{fetchedModels.length}</span>
              </div>
              <div className="py-1 max-h-64 overflow-y-auto">
                {fetchedModels.map(m => {
                  const isActive = activeProvider === providerId && m.id === model;
                  return (
                    <button
                      key={m.id}
                      onClick={() => handleModelSelect(m)}
                      className={`w-full px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] flex items-center justify-between text-sm transition-colors ${
                        isActive ? 'bg-[var(--bg-tertiary)]' : ''
                      }`}
                    >
                      <span className="text-[var(--text-primary)] truncate pr-2">{m.name}</span>
                      {isActive && <Check size={14} className="text-[var(--accent-primary)] flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Provider List ── */}
          {view === 'providers' && (
            <>
              <div className="py-1 max-h-72 overflow-y-auto">
                {PROVIDERS.map(p => {
                  const isActive = p.id === providerId;
                  const hasKey = configuredKeys[p.id];
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleProviderClick(p)}
                      className={`w-full px-3 py-2.5 text-left hover:bg-[var(--bg-tertiary)] flex items-center justify-between transition-colors ${
                        isActive ? 'bg-[var(--bg-tertiary)]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded flex items-center justify-center" style={{ backgroundColor: p.color + '18' }}>
                          <Brain size={13} style={{ color: p.color }} />
                        </div>
                        <span className="text-sm text-[var(--text-primary)]">{p.name}</span>
                        {hasKey && (
                          <Key size={10} className="text-[var(--success)] opacity-60" />
                        )}
                        {!hasKey && (
                          <span className="text-[10px] text-[var(--text-dim)]">needs key</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {hasKey && (
                          <button
                            onClick={(e) => handleEdit(p.id, e)}
                            className="p-1 text-[var(--text-dim)] hover:text-[var(--text-secondary)] rounded"
                            title="Edit API key"
                          >
                            <Pencil size={11} />
                          </button>
                        )}
                        {isActive && <Check size={14} className="text-[var(--accent-primary)]" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Custom endpoint */}
              <div className="border-t border-[var(--border-primary)]">
                <button
                  onClick={() => {
                    setActiveProvider('custom');
                    setKeyInput('');
                    setCustomUrl(localStorage.getItem('singularity_custom_url') || '');
                    setCustomModel(localStorage.getItem('singularity_custom_model') || '');
                    setError(null);
                    setView('custom');
                  }}
                  className="w-full px-3 py-2.5 text-left hover:bg-[var(--bg-tertiary)] flex items-center gap-2.5 text-sm text-[var(--info)]"
                >
                  <div className="w-6 h-6 rounded flex items-center justify-center bg-[var(--info)]/10">
                    <Server size={13} className="text-[var(--info)]" />
                  </div>
                  Custom / Self-hosted...
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export { PROVIDERS };
