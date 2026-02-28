import React, { useEffect, useState } from 'react';
import { X, Check, Settings, Palette, Code2, Server } from 'lucide-react';
import { useSettingsStore, Theme } from '../stores/settingsStore';
import McpSettingsPane from './McpSettingsPane';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type SettingsTab = 'appearance' | 'editor' | 'mcp';

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
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

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

    const {
        theme, setTheme,
        fontSize, setFontSize,
        fontFamily, setFontFamily,
        tabSize, setTabSize,
        wordWrap, setWordWrap,
        minimap, setMinimap,
        lineNumbers, setLineNumbers,
    } = useSettingsStore();

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
