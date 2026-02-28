import React, { useState, useEffect, useCallback } from 'react';
import { Files, Search, Puzzle, Play, GitBranch, Monitor, Github } from 'lucide-react';

export type SidebarView = string;

interface ExtensionEntry {
    extId: string;
    displayName: string;
    iconUrl?: string;
}

interface ActivityBarProps {
    activeView: SidebarView;
    onViewChange: (view: SidebarView) => void;
}

const builtinViews: { id: string; icon: typeof Files; label: string }[] = [
    { id: 'explorer', icon: Files, label: 'Explorer' },
    { id: 'search', icon: Search, label: 'Search' },
    { id: 'git', icon: GitBranch, label: 'Source Control' },
    { id: 'github', icon: Github, label: 'GitHub' },
    { id: 'remote', icon: Monitor, label: 'Remote Explorer' },
    { id: 'debug', icon: Play, label: 'Run and Debug' },
    { id: 'extensions', icon: Puzzle, label: 'Extensions' },
];

const ipc = window.ipcRenderer;

const ActivityBar = React.memo<ActivityBarProps>(({ activeView, onViewChange }) => {
    const [extensions, setExtensions] = useState<ExtensionEntry[]>([]);

    const loadExtensionIcons = useCallback(async () => {
        try {
            const [installed, hiddenIds]: [any[], string[]] = await Promise.all([
                ipc.invoke('extensions:list-installed'),
                ipc.invoke('extensions:get-hidden-icons'),
            ]);
            const hidden = new Set(hiddenIds);
            const exts: ExtensionEntry[] = [];
            const seen = new Set<string>();

            for (const ext of installed) {
                if (seen.has(ext.id) || hidden.has(ext.id)) continue;
                if (ext.contributions?.viewsContainers?.length > 0) {
                    seen.add(ext.id);
                    exts.push({
                        extId: ext.id,
                        displayName: ext.displayName,
                        iconUrl: ext.iconUrl,
                    });
                }
            }

            setExtensions(exts);
        } catch { /* not available */ }
    }, []);

    useEffect(() => {
        loadExtensionIcons();
    }, [loadExtensionIcons]);

    // Listen for refresh events from ExtensionsPane when visibility toggles
    useEffect(() => {
        const handler = () => { loadExtensionIcons(); };
        globalThis.addEventListener('singularity:refresh-activity-bar', handler);
        return () => globalThis.removeEventListener('singularity:refresh-activity-bar', handler);
    }, [loadExtensionIcons]);

    return (
        <nav
            className="w-12 h-full bg-[var(--bg-secondary)] border-r border-[var(--border-primary)] flex flex-col items-center py-4 gap-1 shrink-0 z-20"
            role="toolbar"
            aria-label="Activity Bar"
            aria-orientation="vertical"
        >
            {builtinViews.map(({ id, icon: Icon, label }) => (
                <button
                    key={id}
                    onClick={() => onViewChange(id)}
                    className={`p-2 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] ${
                        activeView === id
                            ? 'text-[var(--text-primary)] bg-[var(--bg-tertiary)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                    title={label}
                    aria-label={label}
                    aria-pressed={activeView === id}
                >
                    <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
                </button>
            ))}

            {/* Extension icons — open as editor tabs */}
            {extensions.length > 0 && (
                <div className="w-6 border-t border-[var(--border-primary)] my-1" />
            )}
            {extensions.map((ext) => {
                const viewId = `ext:${ext.extId}`;
                return (
                    <button
                        key={ext.extId}
                        onClick={() => onViewChange(viewId)}
                        className={`p-1.5 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] ${
                            activeView === viewId
                                ? 'bg-[var(--bg-tertiary)]'
                                : 'hover:bg-[var(--bg-tertiary)]/50'
                        }`}
                        title={ext.displayName}
                        aria-label={ext.displayName}
                        aria-pressed={activeView === viewId}
                    >
                        {ext.iconUrl ? (
                            <img src={ext.iconUrl} alt={ext.displayName} className={`w-6 h-6 rounded ${activeView !== viewId ? 'opacity-60 hover:opacity-100' : ''}`} />
                        ) : (
                            <Puzzle size={24} strokeWidth={1.5} className={activeView === viewId ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'} />
                        )}
                    </button>
                );
            })}
        </nav>
    );
});

export default ActivityBar;
