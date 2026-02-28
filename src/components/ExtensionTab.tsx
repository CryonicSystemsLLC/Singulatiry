import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Puzzle, Loader2, Trash2, FolderOpen, RefreshCw, Circle } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

interface ExtensionContribution {
    commands: { command: string; title: string }[];
    viewsContainers: { id: string; title: string }[];
    themes: { label: string }[];
    languages: { id: string }[];
}

interface InstalledExtension {
    id: string;
    namespace?: string;
    displayName: string;
    version: string;
    description: string;
    publisher?: string;
    iconUrl?: string;
    installedAt: string;
    extensionPath: string;
    contributions?: ExtensionContribution;
}

interface WebviewInfo {
    hasWebview: boolean;
    url?: string;
    type?: 'html' | 'generated';
}

interface ExtensionTabProps {
    extensionId: string;
}

const ipc = window.ipcRenderer;

function getPublisher(ext: { publisher?: string; namespace?: string }): string {
    return ext.publisher || ext.namespace || 'Unknown';
}

type ViewMode = 'webview' | 'details';
type HostStatus = 'stopped' | 'starting' | 'ready' | 'activated' | 'error';

const ExtensionTab: React.FC<ExtensionTabProps> = ({ extensionId }) => {
    const [ext, setExt] = useState<InstalledExtension | null>(null);
    const [hasWebview, setHasWebview] = useState(false);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<ViewMode>('webview');
    const [iframeKey, setIframeKey] = useState(0);
    const [hostStatus, setHostStatus] = useState<HostStatus>('stopped');
    // Dynamic webview URL from extension host (NOT the static one from getWebviewInfo)
    const [webviewUrl, setWebviewUrl] = useState<string | null>(null);
    // The actual panelId registered by the extension (e.g. "Anthropic.claude-code:claudeVSCodeSidebar")
    const [panelId, setPanelId] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    // Load extension metadata
    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const installed: InstalledExtension[] = await ipc.invoke('extensions:list-installed');
                const found = installed.find(e => e.id === extensionId);
                if (found) {
                    setExt(found);
                    try {
                        const info: WebviewInfo = await ipc.invoke('extensions:get-webview-info', extensionId);
                        setHasWebview(info.hasWebview);
                        if (!info.hasWebview) setViewMode('details');
                    } catch {
                        setHasWebview(false);
                        setViewMode('details');
                    }
                }
            } catch { /* fallback */ }
            setLoading(false);
        })();
    }, [extensionId]);

    // Start the extension host when the tab has a webview
    useEffect(() => {
        if (!hasWebview) return;

        let cancelled = false;

        (async () => {
            try {
                // Check if already running and has a webview URL
                const running = await ipc.invoke('exthost:is-running', extensionId);
                if (running) {
                    setHostStatus('activated');
                    // Query for existing webview URL (in case it was set before we mounted)
                    try {
                        const result = await ipc.invoke('exthost:get-webview-url', extensionId);
                        if (result && !cancelled) {
                            setPanelId(result.panelId);
                            setWebviewUrl(result.url);
                        }
                    } catch {}
                    return;
                }

                setHostStatus('starting');
                const rootPath = useAppStore.getState().projectRoot;
                await ipc.invoke('exthost:start', extensionId, rootPath || '');

                if (!cancelled) {
                    setHostStatus('starting');
                }
            } catch (err: any) {
                console.error(`[ExtensionTab] Failed to start host for ${extensionId}:`, err);
                if (!cancelled) setHostStatus('error');
            }
        })();

        return () => { cancelled = true; };
    }, [extensionId, hasWebview]);

    // Listen for extension host lifecycle events
    useEffect(() => {
        const onReady = (_event: any, data: { extensionId: string }) => {
            if (data.extensionId === extensionId) setHostStatus('ready');
        };
        const onActivated = (_event: any, data: { extensionId: string }) => {
            if (data.extensionId === extensionId) {
                setHostStatus('activated');
                // Extension activated — check if it already set webview HTML
                // (may have been set during activate() before this event)
                ipc.invoke('exthost:get-webview-url', extensionId)
                    .then((result: { panelId: string; url: string } | null) => {
                        if (result) {
                            setPanelId(result.panelId);
                            setWebviewUrl(result.url);
                        }
                    })
                    .catch(() => {});
            }
        };
        const onError = (_event: any, data: { extensionId: string; error: string }) => {
            if (data.extensionId === extensionId) {
                console.error(`[ExtensionTab] Host error for ${extensionId}:`, data.error);
                setHostStatus('error');
            }
        };
        const onStopped = (_event: any, data: { extensionId: string }) => {
            if (data.extensionId === extensionId) {
                setHostStatus('stopped');
                setWebviewUrl(null);
                setPanelId(null);
            }
        };

        ipc.on('exthost:ready', onReady);
        ipc.on('exthost:activated', onActivated);
        ipc.on('exthost:error', onError);
        ipc.on('exthost:stopped', onStopped);

        return () => {
            ipc.off('exthost:ready', onReady);
            ipc.off('exthost:activated', onActivated);
            ipc.off('exthost:error', onError);
            ipc.off('exthost:stopped', onStopped);
        };
    }, [extensionId]);

    // Listen for dynamic webview HTML URL from extension host
    useEffect(() => {
        const onWebviewHtml = (_event: any, data: { extensionId: string; panelId: string; url: string }) => {
            if (data.extensionId !== extensionId) return;
            console.log(`[ExtensionTab] Got dynamic webview URL for ${extensionId}: panelId=${data.panelId}`);
            setPanelId(data.panelId);
            setWebviewUrl(data.url);
        };

        // Also listen for view provider registration (gives us the panelId early)
        const onViewProvider = (_event: any, data: { extensionId: string; viewId: string; panelId: string }) => {
            if (data.extensionId !== extensionId) return;
            console.log(`[ExtensionTab] View provider registered: ${data.viewId} -> ${data.panelId}`);
            if (!panelId) setPanelId(data.panelId);
        };

        ipc.on('exthost:webview-html', onWebviewHtml);
        ipc.on('exthost:view-provider', onViewProvider);

        return () => {
            ipc.off('exthost:webview-html', onWebviewHtml);
            ipc.off('exthost:view-provider', onViewProvider);
        };
    }, [extensionId, panelId]);

    // Bridge: Extension host → Webview (messages)
    useEffect(() => {
        const onWebviewMessage = (_event: any, data: { extensionId: string; panelId: string; message: any }) => {
            if (data.extensionId !== extensionId) return;
            const iframe = iframeRef.current;
            if (iframe?.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'host-to-webview', payload: data.message }, '*');
            }
        };

        ipc.on('exthost:webview-message', onWebviewMessage);
        return () => { ipc.off('exthost:webview-message', onWebviewMessage); };
    }, [extensionId]);

    // Bridge: Webview → Extension host (messages)
    // The injected shim posts 'extension-to-host' messages to parent.
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.data?.type === 'extension-to-host' && panelId) {
                ipc.invoke('exthost:webview-message', extensionId, panelId, event.data.payload).catch(() => {});
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [extensionId, panelId]);

    const handleReload = useCallback(async () => {
        // Restart the extension host and reload the webview
        try {
            await ipc.invoke('exthost:stop', extensionId);
        } catch {}
        setHostStatus('stopped');
        setWebviewUrl(null);
        setPanelId(null);
        setIframeKey(prev => prev + 1);
        // Re-start
        setTimeout(async () => {
            try {
                setHostStatus('starting');
                const rootPath = useAppStore.getState().projectRoot;
                await ipc.invoke('exthost:start', extensionId, rootPath || '');
            } catch {
                setHostStatus('error');
            }
        }, 500);
    }, [extensionId]);

    const handleUninstall = useCallback(async () => {
        if (!ext) return;
        try { await ipc.invoke('exthost:stop', ext.id); } catch {}
        await ipc.invoke('extensions:uninstall', ext.id);
        const { openTabs, closeTab } = useAppStore.getState();
        const idx = openTabs.findIndex(t => t.path === `ext://${ext.id}`);
        if (idx >= 0) closeTab(idx);
    }, [ext]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
                <Loader2 size={32} className="animate-spin opacity-40" />
            </div>
        );
    }

    if (!ext) {
        return (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
                <div className="text-center">
                    <Puzzle size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm">Extension not found</p>
                </div>
            </div>
        );
    }

    const commands = ext.contributions?.commands || [];
    const themes = ext.contributions?.themes || [];
    const languages = ext.contributions?.languages || [];

    const statusColor = {
        stopped: 'text-[var(--text-muted)]',
        starting: 'text-yellow-400',
        ready: 'text-yellow-400',
        activated: 'text-green-400',
        error: 'text-red-400',
    }[hostStatus];

    return (
        <div className="h-full flex flex-col bg-[var(--bg-primary)]">
            {/* Thin toolbar */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border-secondary)] shrink-0 bg-[var(--bg-primary)]/80">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded overflow-hidden shrink-0 bg-[var(--bg-tertiary)] flex items-center justify-center">
                        {ext.iconUrl ? (
                            <img src={ext.iconUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <Puzzle size={12} className="text-[var(--text-muted)]" />
                        )}
                    </div>
                    <span className="text-xs font-medium text-[var(--text-secondary)] truncate">{ext.displayName}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">v{ext.version}</span>
                    {hasWebview && (
                        <span title={`Host: ${hostStatus}`}><Circle size={6} className={`shrink-0 fill-current ${statusColor}`} /></span>
                    )}
                </div>

                <div className="flex items-center gap-1 ml-auto">
                    {hasWebview && (
                        <div className="flex bg-[var(--bg-tertiary)] rounded p-0.5 mr-1">
                            <button
                                onClick={() => setViewMode('webview')}
                                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                                    viewMode === 'webview'
                                        ? 'bg-[var(--bg-primary)] text-[var(--text-primary)]'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                }`}
                            >
                                Extension
                            </button>
                            <button
                                onClick={() => setViewMode('details')}
                                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                                    viewMode === 'details'
                                        ? 'bg-[var(--bg-primary)] text-[var(--text-primary)]'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                }`}
                            >
                                Details
                            </button>
                        </div>
                    )}
                    {viewMode === 'webview' && hasWebview && (
                        <button onClick={handleReload} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]" title="Reload Extension">
                            <RefreshCw size={12} />
                        </button>
                    )}
                    <button
                        onClick={() => ipc.invoke('shell:open-external', ext.extensionPath).catch(() => {})}
                        className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
                        title="Open Folder"
                    >
                        <FolderOpen size={12} />
                    </button>
                    <button onClick={handleUninstall} className="p-1 rounded hover:bg-[var(--error)]/10 text-[var(--text-muted)] hover:text-[var(--error)]" title="Uninstall">
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>

            {/* Content area */}
            <div className="flex-1 min-h-0 relative">
                {viewMode === 'webview' && hasWebview ? (
                    <WebviewFrame key={iframeKey} url={webviewUrl} iframeRef={iframeRef} hostStatus={hostStatus} />
                ) : (
                    <DetailsView ext={ext} commands={commands} themes={themes} languages={languages} />
                )}
            </div>
        </div>
    );
};

/**
 * Loads an extension webview via the singularity-ext:// custom protocol.
 * The URL is provided dynamically by the extension host after the extension
 * sets webview.html in its resolveWebviewView() callback.
 */
const WebviewFrame: React.FC<{
    url: string | null;
    iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
    hostStatus: HostStatus;
}> = ({ url, iframeRef, hostStatus }) => {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    // Reset loaded/error state when URL changes
    useEffect(() => {
        setLoaded(false);
        setError(false);
    }, [url]);

    // No URL yet — show loading state
    if (!url) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-[var(--bg-primary)]">
                <Loader2 size={24} className="animate-spin text-[var(--accent-primary)] opacity-60" />
                <span className="text-[10px] text-[var(--text-muted)] mt-2">
                    {hostStatus === 'starting' || hostStatus === 'ready'
                        ? 'Starting extension host...'
                        : hostStatus === 'activated'
                        ? 'Waiting for webview...'
                        : hostStatus === 'error'
                        ? 'Extension host error'
                        : 'Initializing...'}
                </span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
                <div className="text-center">
                    <Puzzle size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm">Failed to load extension webview</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full relative">
            {!loaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-primary)] z-10">
                    <Loader2 size={24} className="animate-spin text-[var(--accent-primary)] opacity-60" />
                    <span className="text-[10px] text-[var(--text-muted)] mt-2">Loading webview...</span>
                </div>
            )}
            <iframe
                ref={iframeRef}
                src={url}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
                onLoad={() => setLoaded(true)}
                onError={() => setError(true)}
                style={{ backgroundColor: '#0d0d12' }}
            />
        </div>
    );
};

/** Static details/info view — fallback when no webview is available */
const DetailsView: React.FC<{
    ext: InstalledExtension;
    commands: { command: string; title: string }[];
    themes: { label: string }[];
    languages: { id: string }[];
}> = ({ ext, commands, themes, languages }) => {
    const [readme, setReadme] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const readmePath = await ipc.invoke('extensions:get-resource-path', ext.id, 'README.md');
                const content = await ipc.invoke('fs:readFile', readmePath);
                if (content && content.length > 0) setReadme(content);
            } catch { /* no readme */ }
        })();
    }, [ext.id]);

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto p-8">
                <div className="flex items-start gap-5 mb-8">
                    <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-[var(--bg-tertiary)] flex items-center justify-center">
                        {ext.iconUrl ? (
                            <img src={ext.iconUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <Puzzle size={32} className="text-[var(--text-muted)]" />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-xl font-bold text-[var(--text-primary)] mb-1">{ext.displayName}</h1>
                        <div className="text-sm text-[var(--text-muted)] mb-2">
                            {getPublisher(ext)} &middot; v{ext.version}
                        </div>
                        <p className="text-sm text-[var(--text-secondary)]">{ext.description}</p>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-8">
                    {commands.length > 0 && (
                        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-secondary)]">
                            <div className="text-2xl font-bold text-[var(--text-primary)]">{commands.length}</div>
                            <div className="text-xs text-[var(--text-muted)]">Commands</div>
                        </div>
                    )}
                    {themes.length > 0 && (
                        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-secondary)]">
                            <div className="text-2xl font-bold text-[var(--text-primary)]">{themes.length}</div>
                            <div className="text-xs text-[var(--text-muted)]">Themes</div>
                        </div>
                    )}
                    {languages.length > 0 && (
                        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-secondary)]">
                            <div className="text-2xl font-bold text-[var(--text-primary)]">{languages.length}</div>
                            <div className="text-xs text-[var(--text-muted)]">Languages</div>
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    <div className="text-xs text-[var(--text-muted)]">
                        <div>Installed: {new Date(ext.installedAt).toLocaleDateString()}</div>
                        <div className="mt-1 font-mono text-[10px] truncate" title={ext.extensionPath}>{ext.extensionPath}</div>
                    </div>

                    {readme && (
                        <div className="border-t border-[var(--border-secondary)] pt-6">
                            <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">README</h2>
                            <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words font-sans leading-relaxed max-h-[500px] overflow-y-auto">
                                {readme}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ExtensionTab;
