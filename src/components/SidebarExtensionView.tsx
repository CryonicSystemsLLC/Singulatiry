import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Puzzle, RefreshCw } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

type HostStatus = 'stopped' | 'starting' | 'ready' | 'activated' | 'error';

interface SidebarExtensionViewProps {
    extensionId: string;
}

const ipc = window.ipcRenderer;

/**
 * Renders an extension webview inside the sidebar panel.
 * Uses event-driven approach to receive webview URL from the extension host.
 */
const SidebarExtensionView: React.FC<SidebarExtensionViewProps> = ({ extensionId }) => {
    const [webviewUrl, setWebviewUrl] = useState<string | null>(null);
    const [panelId, setPanelId] = useState<string | null>(null);
    const [hostStatus, setHostStatus] = useState<HostStatus>('stopped');
    const [iframeKey, setIframeKey] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    const [restartCount, setRestartCount] = useState(0);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const panelIdRef = useRef<string | null>(null);

    useEffect(() => { panelIdRef.current = panelId; }, [panelId]);

    // Main effect: start host + listen for webview URL via events
    useEffect(() => {
        let cancelled = false;
        let gotUrl = false;

        // Try to get the webview URL (called once after start, and on events)
        const tryGetUrl = async () => {
            if (cancelled || gotUrl) return;
            try {
                const result: { panelId: string; url: string } | null =
                    await ipc.invoke('exthost:get-webview-url', extensionId);
                if (result && !cancelled && !gotUrl) {
                    gotUrl = true;
                    setPanelId(result.panelId);
                    setWebviewUrl(result.url);
                    setHostStatus('ready');
                }
            } catch {}
        };

        (async () => {
            try {
                const running = await ipc.invoke('exthost:is-running', extensionId);
                if (cancelled) return;

                if (!running) {
                    setHostStatus('starting');
                    const rootPath = useAppStore.getState().projectRoot;
                    await ipc.invoke('exthost:start', extensionId, rootPath || '');
                    if (cancelled) return;
                }

                setHostStatus('activated');
                // Try immediately in case webview is already available
                tryGetUrl();
            } catch (err: any) {
                if (!cancelled) setHostStatus('error');
            }
        })();

        // Event-driven: listen for webview HTML being set (instant notification)
        const onWebviewHtml = (_event: any, data: { extensionId: string; panelId: string; url: string }) => {
            if (data.extensionId !== extensionId || cancelled || gotUrl) return;
            gotUrl = true;
            setPanelId(data.panelId);
            setWebviewUrl(data.url);
            setHostStatus('ready');
        };

        // Event-driven: listen for view provider registration, then query URL
        const onViewProvider = (_event: any, data: { extensionId: string; viewId: string; panelId: string }) => {
            if (data.extensionId !== extensionId || cancelled || gotUrl) return;
            // View provider registered — HTML may follow shortly, try to get URL
            setTimeout(tryGetUrl, 50);
        };

        const onReady = (_event: any, data: { extensionId: string }) => {
            if (data.extensionId === extensionId && !cancelled) {
                setHostStatus('activated');
            }
        };

        const onActivated = (_event: any, data: { extensionId: string }) => {
            if (data.extensionId === extensionId && !cancelled) {
                setHostStatus('activated');
                tryGetUrl();
            }
        };

        const onError = (_event: any, data: { extensionId: string; error: string }) => {
            if (data.extensionId === extensionId && !cancelled) setHostStatus('error');
        };

        const onStopped = (_event: any, data: { extensionId: string }) => {
            if (data.extensionId === extensionId && !cancelled) {
                setHostStatus('stopped');
                setWebviewUrl(null);
                setPanelId(null);
                gotUrl = false;
            }
        };

        ipc.on('exthost:webview-html', onWebviewHtml);
        ipc.on('exthost:view-provider', onViewProvider);
        ipc.on('exthost:ready', onReady);
        ipc.on('exthost:activated', onActivated);
        ipc.on('exthost:error', onError);
        ipc.on('exthost:stopped', onStopped);

        // Safety: if no URL after 30s, show error
        const safetyTimer = setTimeout(() => {
            if (!gotUrl && !cancelled) setHostStatus('error');
        }, 30000);

        return () => {
            cancelled = true;
            clearTimeout(safetyTimer);
            ipc.off('exthost:webview-html', onWebviewHtml);
            ipc.off('exthost:view-provider', onViewProvider);
            ipc.off('exthost:ready', onReady);
            ipc.off('exthost:activated', onActivated);
            ipc.off('exthost:error', onError);
            ipc.off('exthost:stopped', onStopped);
        };
    }, [extensionId, restartCount]);

    // Bridge: Extension host → Webview
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

    // Bridge: Webview → Extension host
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.source !== iframeRef.current?.contentWindow) return;
            if (event.data?.type === 'extension-to-host' && panelIdRef.current) {
                ipc.invoke('exthost:webview-message', extensionId, panelIdRef.current, event.data.payload).catch(() => {});
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [extensionId]);

    // Reset loaded/error state when URL changes
    useEffect(() => {
        setLoaded(false);
        setError(false);
    }, [webviewUrl]);

    const handleReload = useCallback(async () => {
        try { await ipc.invoke('exthost:stop', extensionId); } catch {}
        setHostStatus('stopped');
        setWebviewUrl(null);
        setPanelId(null);
        setLoaded(false);
        setError(false);
        setIframeKey(prev => prev + 1);
        // Listen for exthost:stopped to trigger restart (with small fallback delay)
        setTimeout(() => {
            setRestartCount(prev => prev + 1);
        }, 200);
    }, [extensionId]);

    // No URL yet — show loading/error state
    if (!webviewUrl) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-[var(--bg-primary)]">
                {hostStatus === 'error' ? (
                    <>
                        <Puzzle size={32} className="text-[var(--text-muted)] opacity-30 mb-3" />
                        <span className="text-xs text-[var(--error)] mb-3">Extension host error</span>
                        <button
                            onClick={handleReload}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                        >
                            <RefreshCw size={12} /> Retry
                        </button>
                    </>
                ) : (
                    <>
                        <Loader2 size={24} className="animate-spin text-[var(--accent-primary)] opacity-60" />
                        <span className="text-[10px] text-[var(--text-muted)] mt-2">
                            {hostStatus === 'starting' || hostStatus === 'ready'
                                ? 'Starting extension...'
                                : hostStatus === 'activated'
                                ? 'Waiting for webview...'
                                : 'Initializing...'}
                        </span>
                    </>
                )}
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
                <Puzzle size={32} className="opacity-20 mb-3" />
                <p className="text-xs mb-3">Failed to load webview</p>
                <button
                    onClick={handleReload}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                >
                    <RefreshCw size={12} /> Reload
                </button>
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
                key={iframeKey}
                ref={iframeRef}
                src={webviewUrl}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
                onLoad={() => setLoaded(true)}
                onError={() => setError(true)}
                style={{ backgroundColor: '#0d0d12' }}
            />
        </div>
    );
};

export default SidebarExtensionView;
