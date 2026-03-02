import React, { useEffect, useState } from 'react';
import { X, Check, Settings, Palette, Code2, Server, Layout, Bot, Monitor, Plus, Trash2, ChevronDown } from 'lucide-react';
import { useSettingsStore, Theme, WorkspaceMode } from '../stores/settingsStore';
import McpSettingsPane from './McpSettingsPane';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type SettingsTab = 'workspace' | 'appearance' | 'editor' | 'mcp';

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'workspace', label: 'Workspace', icon: <Layout size={14} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={14} /> },
    { id: 'editor', label: 'Editor', icon: <Code2 size={14} /> },
    { id: 'mcp', label: 'MCP Servers', icon: <Server size={14} /> },
];

const THEME_OPTIONS: { id: Theme; label: string; colors: [string, string, string, string] }[] = [
    { id: 'dark',            label: 'Dark',            colors: ['#0d0d12', '#a855f7', '#ffffff', '#27272a'] },
    { id: 'light',           label: 'Light',           colors: ['#ffffff', '#7c3aed', '#18181b', '#e4e4e7'] },
    { id: 'midnight',        label: 'Midnight',        colors: ['#0b1426', '#60a5fa', '#e2e8f0', '#1a2944'] },
    { id: 'nord',            label: 'Nord',            colors: ['#2e3440', '#88c0d0', '#eceff4', '#434c5e'] },
    { id: 'solarized-dark',  label: 'Solarized Dark',  colors: ['#002b36', '#b58900', '#fdf6e3', '#0a4050'] },
    { id: 'solarized-light', label: 'Solarized Light', colors: ['#fdf6e3', '#b58900', '#073642', '#ddd6c1'] },
    { id: 'monokai',         label: 'Monokai',         colors: ['#272822', '#f92672', '#f8f8f2', '#3e3d32'] },
    { id: 'dracula',         label: 'Dracula',         colors: ['#282a36', '#bd93f9', '#f8f8f2', '#343746'] },
    { id: 'catppuccin',      label: 'Catppuccin',      colors: ['#1e1e2e', '#cba6f7', '#cdd6f4', '#313244'] },
    { id: 'high-contrast',   label: 'High Contrast',   colors: ['#000000', '#00ffff', '#ffffff', '#1a1a1a'] },
    { id: 'gruvbox-dark',    label: 'Gruvbox Dark',    colors: ['#282828', '#fe8019', '#ebdbb2', '#504945'] },
    { id: 'gruvbox-light',   label: 'Gruvbox Light',   colors: ['#fbf1c7', '#d65d0e', '#3c3836', '#ebdbb2'] },
    { id: 'one-dark',        label: 'One Dark Pro',     colors: ['#282c34', '#61afef', '#abb2bf', '#2c313a'] },
    { id: 'one-light',       label: 'One Light',       colors: ['#fafafa', '#4078f2', '#383a42', '#e5e5e6'] },
    { id: 'tokyo-night',     label: 'Tokyo Night',     colors: ['#1a1b26', '#7aa2f7', '#c0caf5', '#232433'] },
    { id: 'github-dark',     label: 'GitHub Dark',     colors: ['#0d1117', '#58a6ff', '#f0f6fc', '#21262d'] },
    { id: 'github-light',    label: 'GitHub Light',    colors: ['#ffffff', '#0969da', '#1f2328', '#eaeef2'] },
    { id: 'rose-pine',       label: 'Rose Pine',       colors: ['#191724', '#c4a7e7', '#e0def4', '#26233a'] },
    { id: 'rose-pine-dawn',  label: 'Rose Pine Dawn',  colors: ['#faf4ed', '#907aa9', '#575279', '#f2e9e1'] },
    { id: 'synthwave',       label: 'Synthwave \'84',  colors: ['#262335', '#ff7edb', '#f0e4fc', '#34294f'] },
    { id: 'ayu-dark',        label: 'Ayu Dark',        colors: ['#0b0e14', '#e6b450', '#bfbdb6', '#151a23'] },
    { id: 'ayu-light',       label: 'Ayu Light',       colors: ['#fcfcfc', '#ff9940', '#5c6166', '#e8e9eb'] },
];

const FONT_OPTIONS = [
    "'JetBrains Mono', 'Fira Code', Consolas, monospace",
    "'Fira Code', Consolas, monospace",
    "Consolas, 'Courier New', monospace",
    "'Source Code Pro', Consolas, monospace",
    "'Cascadia Code', Consolas, monospace",
    "'IBM Plex Mono', Consolas, monospace",
];

const FONT_LABELS: Record<string, string> = {
    "'JetBrains Mono', 'Fira Code', Consolas, monospace": 'JetBrains Mono',
    "'Fira Code', Consolas, monospace": 'Fira Code',
    "Consolas, 'Courier New', monospace": 'Consolas',
    "'Source Code Pro', Consolas, monospace": 'Source Code Pro',
    "'Cascadia Code', Consolas, monospace": 'Cascadia Code',
    "'IBM Plex Mono', Consolas, monospace": 'IBM Plex Mono',
};

const MODE_OPTIONS: { id: WorkspaceMode; label: string; description: string; icon: React.ReactNode }[] = [
    {
        id: 'standard',
        label: 'Standard Mode',
        description: 'Traditional IDE layout with code editor, file explorer, terminal, and AI chat sidebar.',
        icon: <Monitor size={24} />,
    },
    {
        id: 'ai',
        label: '100% AI Mode',
        description: 'AI extensions take over the main area. Use Claude Code, Codex, or other AI assistants side-by-side without the code editor.',
        icon: <Bot size={24} />,
    },
];

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
    const [availableExtensions, setAvailableExtensions] = useState<{ id: string; name: string }[]>([]);

    const {
        theme, setTheme,
        fontSize, setFontSize,
        fontFamily, setFontFamily,
        tabSize, setTabSize,
        wordWrap, setWordWrap,
        minimap, setMinimap,
        lineNumbers, setLineNumbers,
        workspaceMode, setWorkspaceMode,
        aiModePanels, setAiModePanels,
    } = useSettingsStore();

    // Load extensions with sidebar views when workspace tab is active
    useEffect(() => {
        if (!isOpen || activeTab !== 'workspace') return;
        (async () => {
            try {
                const installed: any[] = await window.ipcRenderer.invoke('extensions:list-installed');
                const exts = installed
                    .filter((ext: any) => ext.contributions?.viewsContainers?.length > 0)
                    .map((ext: any) => ({ id: ext.id, name: ext.displayName || ext.name || ext.id }));
                setAvailableExtensions(exts);
            } catch {
                setAvailableExtensions([]);
            }
        })();
    }, [isOpen, activeTab]);

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-[var(--bg-secondary)] w-[560px] max-h-[85vh] flex flex-col rounded-lg border border-[var(--border-primary)] shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-[var(--border-primary)] shrink-0">
                    <h2 className="text-[var(--text-primary)] font-semibold flex items-center gap-2">
                        <Settings size={18} className="text-[var(--accent-primary)]" />
                        Settings
                    </h2>
                    <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Tab Bar */}
                <div className="flex border-b border-[var(--border-primary)] shrink-0">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors relative ${
                                activeTab === tab.id
                                    ? 'text-[var(--accent-primary)]'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                            }`}
                        >
                            {tab.icon}
                            {tab.label}
                            {activeTab === tab.id && (
                                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-[var(--accent-primary)] rounded-t" />
                            )}
                        </button>
                    ))}
                </div>

                {/* Scrollable Content */}
                <div className="overflow-y-auto flex-1">
                    {/* Workspace Tab */}
                    {activeTab === 'workspace' && (
                        <div className="p-4 space-y-6">
                            {/* Mode Selection */}
                            <div>
                                <span className="text-sm font-medium text-[var(--text-primary)] mb-3 block">Workspace Mode</span>
                                <div className="grid grid-cols-2 gap-3">
                                    {MODE_OPTIONS.map((mode) => {
                                        const isSelected = workspaceMode === mode.id;
                                        return (
                                            <button
                                                key={mode.id}
                                                onClick={() => {
                                                    if (mode.id === 'ai' && workspaceMode !== 'ai') {
                                                        setAiModePanels(['']);
                                                    }
                                                    setWorkspaceMode(mode.id);
                                                }}
                                                className={`flex flex-col items-start gap-2 p-4 rounded-lg border transition-all text-left ${
                                                    isSelected
                                                        ? 'border-[var(--accent-primary)] bg-[var(--accent-bg)]'
                                                        : 'border-[var(--border-primary)] hover:border-[var(--bg-hover)]'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <div className={`${isSelected ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`}>
                                                        {mode.icon}
                                                    </div>
                                                    {isSelected && (
                                                        <Check size={14} className="text-[var(--accent-primary)]" />
                                                    )}
                                                </div>
                                                <span className="text-xs font-medium text-[var(--text-primary)]">{mode.label}</span>
                                                <span className="text-[11px] text-[var(--text-muted)] leading-relaxed">{mode.description}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* AI Panel Configuration (only when AI mode) */}
                            {workspaceMode === 'ai' && (
                                <div>
                                    <span className="text-sm font-medium text-[var(--text-primary)] mb-3 block">AI Panels</span>
                                    <div className="space-y-2">
                                        {aiModePanels.map((panelExtId, index) => (
                                                <div key={index} className="flex items-center gap-2">
                                                    <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">
                                                        Panel {index + 1}
                                                    </span>
                                                    <div className="relative flex-1">
                                                        <select
                                                            value={panelExtId}
                                                            onChange={(e) => {
                                                                const updated = [...aiModePanels];
                                                                updated[index] = e.target.value;
                                                                setAiModePanels(updated);
                                                            }}
                                                            className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-[var(--border-primary)] focus:border-[var(--accent-primary)] focus:outline-none appearance-none pr-7"
                                                        >
                                                            <option value="">Select extension...</option>
                                                            {availableExtensions.map((ext) => (
                                                                <option key={ext.id} value={ext.id}>{ext.name}</option>
                                                            ))}
                                                        </select>
                                                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            const updated = aiModePanels.filter((_, i) => i !== index);
                                                            setAiModePanels(updated);
                                                        }}
                                                        className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--bg-tertiary)] transition-colors"
                                                        title="Remove panel"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                        ))}

                                        <button
                                            onClick={() => setAiModePanels([...aiModePanels, ''])}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors border border-dashed border-[var(--border-primary)]"
                                        >
                                            <Plus size={12} />
                                            Add Panel
                                        </button>

                                        {availableExtensions.length === 0 && (
                                            <p className="text-[11px] text-[var(--text-dim)]">
                                                No extensions with sidebar views installed. Install an AI extension from the Extensions pane first.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Appearance Tab */}
                    {activeTab === 'appearance' && (
                        <div className="p-4">
                            <span className="text-sm font-medium text-[var(--text-primary)] mb-3 block">Theme</span>
                            <div className="grid grid-cols-2 gap-2">
                                {THEME_OPTIONS.map((t) => {
                                    const isSelected = theme === t.id;
                                    return (
                                        <button
                                            key={t.id}
                                            onClick={() => setTheme(t.id)}
                                            className={`flex items-center gap-2.5 p-2 rounded-lg border transition-all text-left ${
                                                isSelected
                                                    ? 'border-[var(--accent-primary)] bg-[var(--accent-bg)]'
                                                    : 'border-[var(--border-primary)] hover:border-[var(--bg-hover)]'
                                            }`}
                                        >
                                            <div className="flex rounded overflow-hidden shrink-0">
                                                {t.colors.map((color, i) => (
                                                    <div key={i} className="w-3 h-6" style={{ backgroundColor: color }} />
                                                ))}
                                            </div>
                                            <span className="text-xs text-[var(--text-primary)] truncate">{t.label}</span>
                                            {isSelected && (
                                                <Check size={12} className="text-[var(--accent-primary)] ml-auto shrink-0" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Editor Tab */}
                    {activeTab === 'editor' && (
                        <div className="p-4">
                            <span className="text-sm font-medium text-[var(--text-primary)] mb-3 block">Editor</span>
                            <div className="space-y-3">
                                {/* Font Family */}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-[var(--text-secondary)]">Font Family</span>
                                    <select
                                        value={fontFamily}
                                        onChange={(e) => setFontFamily(e.target.value)}
                                        className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-[var(--border-primary)] focus:border-[var(--accent-primary)] focus:outline-none w-44"
                                    >
                                        {FONT_OPTIONS.map((font) => (
                                            <option key={font} value={font}>{FONT_LABELS[font] || font}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Font Size */}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-[var(--text-secondary)]">Font Size</span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setFontSize(Math.max(8, fontSize - 1))}
                                            className="w-6 h-6 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs flex items-center justify-center border border-[var(--border-primary)]"
                                        >
                                            -
                                        </button>
                                        <span className="text-xs text-[var(--text-primary)] w-8 text-center tabular-nums">{fontSize}px</span>
                                        <button
                                            onClick={() => setFontSize(Math.min(32, fontSize + 1))}
                                            className="w-6 h-6 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs flex items-center justify-center border border-[var(--border-primary)]"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                {/* Tab Size */}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-[var(--text-secondary)]">Tab Size</span>
                                    <div className="flex items-center gap-1 bg-[var(--bg-tertiary)] rounded p-0.5 border border-[var(--border-primary)]">
                                        {[2, 4, 8].map((size) => (
                                            <button
                                                key={size}
                                                onClick={() => setTabSize(size)}
                                                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                                                    tabSize === size
                                                        ? 'bg-[var(--accent-primary)] text-white'
                                                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                                }`}
                                            >
                                                {size}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Toggles */}
                                <ToggleRow label="Word Wrap" checked={wordWrap} onChange={setWordWrap} />
                                <ToggleRow label="Minimap" checked={minimap} onChange={setMinimap} />
                                <ToggleRow label="Line Numbers" checked={lineNumbers} onChange={setLineNumbers} />
                            </div>
                        </div>
                    )}

                    {/* MCP Servers Tab */}
                    {activeTab === 'mcp' && <McpSettingsPane />}
                </div>

                {/* Footer */}
                <div className="flex justify-end p-4 border-t border-[var(--border-primary)] shrink-0">
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

const ToggleRow: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
    <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
        <button
            onClick={() => onChange(!checked)}
            className={`w-9 h-5 rounded-full transition-colors relative ${
                checked ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-tertiary)] border border-[var(--border-primary)]'
            }`}
        >
            <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform ${
                checked ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
        </button>
    </div>
);

export default SettingsModal;
