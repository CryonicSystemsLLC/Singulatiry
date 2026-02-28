import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Star, Loader2, Download, Check, Trash2, ShieldAlert, ShieldCheck, Eye, EyeOff } from 'lucide-react';

interface Extension {
    namespace: string;
    name: string;
    version: string;
    displayName: string;
    description: string;
    publisher: string;
    icon?: string;
    files?: { icon?: string; download?: string };
    downloadCount?: number;
    averageRating?: number;
    verified?: boolean;
}

interface ExtensionContribution {
    commands: { command: string; title: string }[];
    viewsContainers: { id: string; title: string; icon?: string }[];
    themes: { label: string }[];
    languages: { id: string }[];
}

interface InstalledExtension {
    id: string;
    namespace: string;
    name: string;
    displayName: string;
    version: string;
    description: string;
    publisher: string;
    iconUrl?: string;
    installedAt: string;
    extensionPath: string;
    contributions?: ExtensionContribution;
}

type ViewMode = 'marketplace' | 'installed';

const ipc = window.ipcRenderer;

/** Open VSX API often has publisher=null; use namespace as fallback */
function getPublisher(ext: { publisher?: string; namespace?: string }): string {
    return ext.publisher || ext.namespace || 'Unknown';
}

function formatDownloads(n?: number): string {
    if (!n) return '';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

// ---- Trust Publisher Dialog ----
function TrustDialog({
    publisher,
    extensionName,
    onTrustOnce,
    onTrustAlways,
    onCancel,
}: {
    publisher: string;
    extensionName: string;
    onTrustOnce: () => void;
    onTrustAlways: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-2xl w-[380px] p-5">
                <div className="flex items-center gap-3 mb-4">
                    <ShieldAlert size={24} className="text-[var(--warning)] shrink-0" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Trust Extension Publisher?</h3>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mb-4">
                    You are about to install <strong className="text-[var(--text-primary)]">{extensionName}</strong> by <strong className="text-[var(--accent-primary)]">{publisher}</strong>.
                </p>
                <p className="text-xs text-[var(--text-muted)] mb-4">
                    Extensions can execute code and access files on your system. Only install extensions from publishers you trust.
                </p>
                <div className="flex flex-col gap-2">
                    <button
                        onClick={onTrustAlways}
                        className="w-full bg-[var(--accent-primary)] text-[var(--text-primary)] text-xs font-medium py-2 rounded hover:opacity-90 flex items-center justify-center gap-2"
                    >
                        <ShieldCheck size={14} /> Trust Publisher &amp; Install
                    </button>
                    <button
                        onClick={onTrustOnce}
                        className="w-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs font-medium py-2 rounded hover:bg-[var(--bg-hover)] border border-[var(--border-primary)]"
                    >
                        Install Once (Don't Remember)
                    </button>
                    <button
                        onClick={onCancel}
                        className="w-full text-[var(--text-muted)] text-xs py-2 rounded hover:text-[var(--text-secondary)]"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

const ExtensionsPane: React.FC = () => {
    const [query, setQuery] = useState('');
    const [extensions, setExtensions] = useState<Extension[]>([]);
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('marketplace');
    const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
    const [installedExts, setInstalledExts] = useState<InstalledExtension[]>([]);
    const [installing, setInstalling] = useState<Set<string>>(new Set());
    const [uninstalling, setUninstalling] = useState<Set<string>>(new Set());
    const [selectedInstalled, setSelectedInstalled] = useState<InstalledExtension | null>(null);
    const [hiddenIcons, setHiddenIcons] = useState<Set<string>>(new Set());

    // Trust dialog state
    const [trustPrompt, setTrustPrompt] = useState<{ ext: Extension; resolve: (action: 'once' | 'always' | 'cancel') => void } | null>(null);

    // Update tracking
    const [availableUpdates, setAvailableUpdates] = useState<Map<string, { currentVersion: string; latestVersion: string }>>(new Map());
    const [updating, setUpdating] = useState<Set<string>>(new Set());

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3000);
    }, []);

    // Listen for update notifications from main process
    useEffect(() => {
        const onUpdatesAvailable = (_event: any, updates: { id: string; currentVersion: string; latestVersion: string }[]) => {
            const map = new Map<string, { currentVersion: string; latestVersion: string }>();
            for (const u of updates) {
                map.set(u.id, { currentVersion: u.currentVersion, latestVersion: u.latestVersion });
            }
            setAvailableUpdates(map);
            if (updates.length > 0) {
                showToast(`${updates.length} extension update${updates.length > 1 ? 's' : ''} available`);
            }
        };
        ipc.on('extensions:updates-available', onUpdatesAvailable);
        return () => { ipc.off('extensions:updates-available', onUpdatesAvailable); };
    }, [showToast]);

    const handleUpdate = useCallback(async (id: string) => {
        if (updating.has(id)) return;
        setUpdating(prev => new Set(prev).add(id));
        try {
            await ipc.invoke('extensions:update', id);
            setAvailableUpdates(prev => {
                const next = new Map(prev);
                next.delete(id);
                return next;
            });
            showToast(`Updated ${id}. Restart to apply.`);
            // Reload installed list
            const [list, hidden]: [InstalledExtension[], string[]] = await Promise.all([
                ipc.invoke('extensions:list-installed'),
                ipc.invoke('extensions:get-hidden-icons'),
            ]);
            setInstalledExts(list);
            setInstalledIds(new Set(list.map(e => e.id)));
            setHiddenIcons(new Set(hidden));
            globalThis.dispatchEvent(new Event('singularity:refresh-activity-bar'));
        } catch (e: any) {
            showToast(`Failed to update ${id}: ${e.message}`);
        } finally {
            setUpdating(prev => { const next = new Set(prev); next.delete(id); return next; });
        }
    }, [updating, showToast]);

    const handleCheckUpdates = useCallback(async () => {
        showToast('Checking for updates...');
        try {
            const updates = await ipc.invoke('extensions:check-updates');
            const map = new Map<string, { currentVersion: string; latestVersion: string }>();
            for (const u of updates) {
                map.set(u.id, { currentVersion: u.currentVersion, latestVersion: u.latestVersion });
            }
            setAvailableUpdates(map);
            if (updates.length === 0) showToast('All extensions are up to date');
            else showToast(`${updates.length} update${updates.length > 1 ? 's' : ''} available`);
        } catch {
            showToast('Failed to check for updates');
        }
    }, [showToast]);

    // Load installed extensions + hidden icons
    const loadInstalled = useCallback(async () => {
        try {
            const [list, hidden]: [InstalledExtension[], string[]] = await Promise.all([
                ipc.invoke('extensions:list-installed'),
                ipc.invoke('extensions:get-hidden-icons'),
            ]);
            setInstalledExts(list);
            setInstalledIds(new Set(list.map(e => e.id)));
            setHiddenIcons(new Set(hidden));
        } catch {
            // Extension manager not available
        }
    }, []);

    useEffect(() => {
        loadInstalled();
    }, [loadInstalled]);

    const toggleIconVisibility = useCallback(async (id: string) => {
        const isHidden = hiddenIcons.has(id);
        try {
            await ipc.invoke('extensions:set-icon-hidden', id, !isHidden);
            setHiddenIcons(prev => {
                const next = new Set(prev);
                if (isHidden) next.delete(id); else next.add(id);
                return next;
            });
            // Tell ActivityBar to refresh its icons
            globalThis.dispatchEvent(new Event('singularity:refresh-activity-bar'));
        } catch {}
    }, [hiddenIcons]);

    const fetchExtensions = async (searchQuery: string) => {
        setLoading(true);
        try {
            let url = 'https://open-vsx.org/api/-/search?size=20';
            if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;
            const req = await fetch(url);
            const data = await req.json();
            setExtensions(data.extensions || []);
        } catch (e) {
            console.error('Failed to fetch extensions', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchExtensions('');
    }, []);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchExtensions(query);
    };

    // Trust check + install flow
    const handleInstall = useCallback(async (ext: Extension) => {
        const id = `${ext.namespace}.${ext.name}`;
        if (installing.has(id)) return;

        // Check if publisher is already trusted
        let trusted = false;
        try {
            trusted = await ipc.invoke('extensions:is-publisher-trusted', getPublisher(ext));
        } catch { /* proceed to prompt */ }

        if (!trusted) {
            // Show trust dialog and wait for user decision
            const action = await new Promise<'once' | 'always' | 'cancel'>((resolve) => {
                setTrustPrompt({ ext, resolve });
            });
            setTrustPrompt(null);

            if (action === 'cancel') return;
            if (action === 'always') {
                try { await ipc.invoke('extensions:trust-publisher', getPublisher(ext)); } catch {}
            }
        }

        // Proceed with install
        setInstalling(prev => new Set(prev).add(id));
        showToast(`Installing ${ext.displayName || ext.name}...`);

        try {
            await ipc.invoke('extensions:install', {
                namespace: ext.namespace,
                name: ext.name,
                displayName: ext.displayName || ext.name,
                version: ext.version,
                description: ext.description,
                publisher: getPublisher(ext),
                downloadUrl: ext.files?.download || '',
                iconUrl: ext.files?.icon || ext.icon,
            });
            showToast(`${ext.displayName || ext.name} installed!`);
            await loadInstalled();
            globalThis.dispatchEvent(new Event('singularity:refresh-activity-bar'));
        } catch (err: any) {
            showToast(`Failed to install: ${err.message}`);
        } finally {
            setInstalling(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [installing, showToast, loadInstalled]);

    const handleUninstall = useCallback(async (id: string, displayName: string) => {
        if (uninstalling.has(id)) return;

        setUninstalling(prev => new Set(prev).add(id));
        showToast(`Uninstalling ${displayName}...`);

        try {
            await ipc.invoke('extensions:uninstall', id);
            showToast(`${displayName} uninstalled`);
            setSelectedInstalled(null);
            await loadInstalled();
            globalThis.dispatchEvent(new Event('singularity:refresh-activity-bar'));
        } catch (err: any) {
            showToast(`Failed to uninstall: ${err.message}`);
        } finally {
            setUninstalling(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [uninstalling, showToast, loadInstalled]);

    return (
        <div className="flex flex-col h-full p-4 overflow-hidden">
            <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase mb-3 tracking-wider">Extensions</h2>

            {/* Trust dialog — portaled to document root so it overlays the full window */}
            {trustPrompt && createPortal(
                <TrustDialog
                    publisher={getPublisher(trustPrompt.ext)}
                    extensionName={trustPrompt.ext.displayName || trustPrompt.ext.name}
                    onTrustAlways={() => trustPrompt.resolve('always')}
                    onTrustOnce={() => trustPrompt.resolve('once')}
                    onCancel={() => trustPrompt.resolve('cancel')}
                />,
                document.body
            )}

            {/* View toggle */}
            <div className="flex gap-0.5 mb-3 shrink-0 bg-[var(--bg-tertiary)] rounded p-0.5">
                <button
                    onClick={() => { setViewMode('marketplace'); setSelectedInstalled(null); }}
                    className={`flex-1 text-[10px] font-medium py-1.5 rounded transition-colors ${
                        viewMode === 'marketplace'
                            ? 'bg-[var(--bg-primary)] text-[var(--text-primary)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                >
                    Marketplace
                </button>
                <button
                    onClick={() => { setViewMode('installed'); setSelectedInstalled(null); }}
                    className={`flex-1 text-[10px] font-medium py-1.5 rounded transition-colors relative ${
                        viewMode === 'installed'
                            ? 'bg-[var(--bg-primary)] text-[var(--text-primary)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                >
                    Installed
                    {installedExts.length > 0 && (
                        <span className="ml-1 bg-[var(--accent-primary)] text-[var(--text-primary)] text-[8px] px-1 rounded-full">
                            {installedExts.length}
                        </span>
                    )}
                </button>
            </div>

            {/* Search (marketplace only) */}
            {viewMode === 'marketplace' && (
                <form onSubmit={handleSearch} className="relative mb-4 shrink-0">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search Marketplace..."
                        className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-sm rounded-md px-3 py-1.5 pl-8 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-muted)]"
                    />
                    <Search size={14} className="absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
                </form>
            )}

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-4 right-4 bg-[var(--accent-primary)] text-[var(--text-primary)] px-4 py-2 rounded shadow-lg text-xs z-50 animate-fade-in">
                    {toast}
                </div>
            )}

            <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
                {loading && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-[var(--accent-primary)]" /></div>}

                {/* ---- Marketplace View ---- */}
                {viewMode === 'marketplace' && !loading && extensions.map((ext) => {
                    const id = `${ext.namespace}.${ext.name}`;
                    const iconUrl = ext.files?.icon || ext.icon;
                    const isInstalled = installedIds.has(id);
                    const isInstalling = installing.has(id);

                    return (
                        <div key={id} className="group flex gap-3 p-2 hover:bg-white/5 rounded cursor-pointer">
                            <div className="w-10 h-10 bg-[var(--bg-tertiary)] rounded overflow-hidden shrink-0 flex items-center justify-center text-xs text-[var(--text-muted)]">
                                {iconUrl ? <img src={iconUrl} alt="" className="w-full h-full object-cover" /> : 'EXT'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold text-sm truncate text-[var(--text-secondary)]">{ext.displayName || ext.name}</span>
                                    <span className="text-[10px] bg-[var(--accent-bg)] text-[var(--accent-primary)] px-1.5 rounded">{ext.version}</span>
                                </div>
                                <div className="text-xs text-[var(--text-muted)] truncate">{ext.description}</div>
                                <div className="flex items-center gap-3 mt-2">
                                    {isInstalled ? (
                                        <span className="text-[10px] bg-[var(--success)]/20 text-[var(--success)] px-2 py-0.5 rounded flex items-center gap-1 font-medium">
                                            <Check size={10} /> Installed
                                        </span>
                                    ) : (
                                        <button
                                            className="text-[10px] bg-[var(--info)] text-[var(--text-primary)] px-2 py-0.5 rounded flex items-center gap-1 active:scale-95 transition-transform hover:opacity-90 disabled:opacity-50"
                                            disabled={isInstalling || !ext.files?.download}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleInstall(ext);
                                            }}
                                        >
                                            {isInstalling ? <Loader2 size={10} className="animate-spin" /> : null}
                                            {isInstalling ? 'Installing...' : 'Install'}
                                        </button>
                                    )}
                                    <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                                        {ext.verified && <Check size={10} className="text-[var(--success)]" />}
                                        {getPublisher(ext)}
                                    </span>
                                    {ext.downloadCount != null && ext.downloadCount > 0 && (
                                        <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                                            <Download size={10} /> {formatDownloads(ext.downloadCount)}
                                        </span>
                                    )}
                                    {ext.averageRating != null && ext.averageRating > 0 && (
                                        <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                                            <Star size={10} className="fill-current text-yellow-500" /> {ext.averageRating.toFixed(1)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* ---- Installed View ---- */}
                {viewMode === 'installed' && !loading && !selectedInstalled && (
                    <>
                        {/* Check for Updates button */}
                        {installedExts.length > 0 && (
                            <div className="flex items-center justify-between mb-2">
                                <button
                                    onClick={handleCheckUpdates}
                                    className="text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                                >
                                    <Download size={10} /> Check for Updates
                                </button>
                                {availableUpdates.size > 0 && (
                                    <span className="text-[10px] bg-[var(--info)]/20 text-[var(--info)] px-2 py-0.5 rounded">
                                        {availableUpdates.size} update{availableUpdates.size > 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>
                        )}
                        {installedExts.length === 0 && (
                            <p className="text-xs text-[var(--text-muted)] text-center py-8">No extensions installed</p>
                        )}
                        {installedExts.map((ext) => {
                            const isRemoving = uninstalling.has(ext.id);
                            const updateInfo = availableUpdates.get(ext.id);
                            const isUpdating = updating.has(ext.id);
                            return (
                                <div
                                    key={ext.id}
                                    className="group flex gap-3 p-2 hover:bg-white/5 rounded cursor-pointer"
                                    onClick={() => setSelectedInstalled(ext)}
                                >
                                    <div className="w-10 h-10 bg-[var(--bg-tertiary)] rounded overflow-hidden shrink-0 flex items-center justify-center text-xs text-[var(--text-muted)]">
                                        {ext.iconUrl ? <img src={ext.iconUrl} alt="" className="w-full h-full object-cover" /> : 'EXT'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold text-sm truncate text-[var(--text-secondary)]">{ext.displayName}</span>
                                            <div className="flex items-center gap-1">
                                                {updateInfo && (
                                                    <span className="text-[10px] bg-[var(--info)]/20 text-[var(--info)] px-1.5 rounded">{updateInfo.latestVersion}</span>
                                                )}
                                                <span className={`text-[10px] px-1.5 rounded ${updateInfo ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] line-through' : 'bg-[var(--accent-bg)] text-[var(--accent-primary)]'}`}>{ext.version}</span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-[var(--text-muted)] truncate">{ext.description}</div>
                                        <div className="flex items-center gap-3 mt-2">
                                            {updateInfo && (
                                                <button
                                                    className="text-[10px] bg-[var(--info)] text-[var(--text-primary)] px-2 py-0.5 rounded flex items-center gap-1 active:scale-95 transition-transform hover:opacity-90 disabled:opacity-50"
                                                    disabled={isUpdating}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleUpdate(ext.id);
                                                    }}
                                                >
                                                    {isUpdating ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                                                    {isUpdating ? 'Updating...' : 'Update'}
                                                </button>
                                            )}
                                            <button
                                                className="text-[10px] text-[var(--error)] hover:bg-[var(--error)]/10 px-2 py-0.5 rounded flex items-center gap-1 transition-colors disabled:opacity-50"
                                                disabled={isRemoving}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleUninstall(ext.id, ext.displayName);
                                                }}
                                            >
                                                {isRemoving ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                                                {isRemoving ? 'Removing...' : 'Uninstall'}
                                            </button>
                                            <button
                                                className={`text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors ${
                                                    hiddenIcons.has(ext.id)
                                                        ? 'text-[var(--text-muted)] hover:bg-white/5'
                                                        : 'text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10'
                                                }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleIconVisibility(ext.id);
                                                }}
                                                title={hiddenIcons.has(ext.id) ? 'Show in Activity Bar' : 'Hide from Activity Bar'}
                                            >
                                                {hiddenIcons.has(ext.id) ? <EyeOff size={10} /> : <Eye size={10} />}
                                                {hiddenIcons.has(ext.id) ? 'Hidden' : 'Visible'}
                                            </button>
                                            <span className="text-[10px] text-[var(--text-muted)]">{getPublisher(ext)}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}

                {/* ---- Extension Detail View ---- */}
                {viewMode === 'installed' && selectedInstalled && (
                    <div className="space-y-3">
                        <button
                            onClick={() => setSelectedInstalled(null)}
                            className="text-[10px] text-[var(--accent-primary)] hover:underline mb-2"
                        >
                            &larr; Back to list
                        </button>
                        <div className="flex gap-3 items-start">
                            <div className="w-12 h-12 bg-[var(--bg-tertiary)] rounded overflow-hidden shrink-0 flex items-center justify-center text-xs text-[var(--text-muted)]">
                                {selectedInstalled.iconUrl ? <img src={selectedInstalled.iconUrl} alt="" className="w-full h-full object-cover" /> : 'EXT'}
                            </div>
                            <div>
                                <div className="text-sm font-semibold text-[var(--text-primary)]">{selectedInstalled.displayName}</div>
                                <div className="text-[10px] text-[var(--text-muted)]">{getPublisher(selectedInstalled)} &middot; v{selectedInstalled.version}</div>
                            </div>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)]">{selectedInstalled.description}</p>

                        {/* Contributions */}
                        {selectedInstalled.contributions && (
                            <div className="space-y-2">
                                {selectedInstalled.contributions.commands.length > 0 && (
                                    <div>
                                        <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">Commands ({selectedInstalled.contributions.commands.length})</h4>
                                        <div className="space-y-0.5">
                                            {selectedInstalled.contributions.commands.slice(0, 10).map(cmd => (
                                                <div key={cmd.command} className="text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded px-2 py-1">
                                                    {cmd.title}
                                                </div>
                                            ))}
                                            {selectedInstalled.contributions.commands.length > 10 && (
                                                <div className="text-[10px] text-[var(--text-muted)] pl-2">
                                                    +{selectedInstalled.contributions.commands.length - 10} more...
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {selectedInstalled.contributions.viewsContainers.length > 0 && (
                                    <div>
                                        <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">Views</h4>
                                        {selectedInstalled.contributions.viewsContainers.map(vc => (
                                            <div key={vc.id} className="text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded px-2 py-1 mb-0.5">
                                                {vc.title}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {selectedInstalled.contributions.themes.length > 0 && (
                                    <div>
                                        <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">Themes</h4>
                                        {selectedInstalled.contributions.themes.map(t => (
                                            <div key={t.label} className="text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded px-2 py-1 mb-0.5">
                                                {t.label}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {selectedInstalled.contributions.languages.length > 0 && (
                                    <div>
                                        <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">Languages</h4>
                                        <div className="flex flex-wrap gap-1">
                                            {selectedInstalled.contributions.languages.map(l => (
                                                <span key={l.id} className="text-[10px] text-[var(--accent-primary)] bg-[var(--accent-bg)] px-1.5 py-0.5 rounded">
                                                    {l.id}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="text-[10px] text-[var(--text-muted)] pt-2 border-t border-[var(--border-secondary)]">
                            Installed: {new Date(selectedInstalled.installedAt).toLocaleDateString()}
                        </div>

                        <button
                            className="text-[10px] text-[var(--error)] hover:bg-[var(--error)]/10 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                            onClick={() => handleUninstall(selectedInstalled.id, selectedInstalled.displayName)}
                        >
                            <Trash2 size={10} /> Uninstall
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ExtensionsPane;
