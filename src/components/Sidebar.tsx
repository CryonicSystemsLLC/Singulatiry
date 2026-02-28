import React from 'react';
import FileExplorer from './FileExplorer';
import SearchPane from './panes/SearchPane';
import ExtensionsPane from './panes/ExtensionsPane';
import DebugPane from './panes/DebugPane';
import GitPane from './panes/GitPane';
import GitHubPane from './panes/GitHubPane';
import RemotePane from './panes/RemotePane';
import SidebarExtensionView from './SidebarExtensionView';
import { SidebarView } from './ActivityBar';

interface SidebarProps {
    activeView: SidebarView;
    onFileSelect: (path: string, content: string) => void;
    rootPath: string | null;
    onRootChange: (path: string) => void;
}

const ipc = window.ipcRenderer;

const Sidebar = React.memo<SidebarProps>(({ activeView, onFileSelect, rootPath, onRootChange }) => {
    const [loadedViews, setLoadedViews] = React.useState<Set<string>>(new Set(['explorer']));
    const [extensionViews, setExtensionViews] = React.useState<string[]>([]);

    React.useEffect(() => {
        setLoadedViews(prev => {
            if (prev.has(activeView)) return prev;
            return new Set(prev).add(activeView);
        });
    }, [activeView]);

    // Load all sidebar extension views and refresh on install/uninstall
    const loadExtensionViews = React.useCallback(async () => {
        try {
            const installed: any[] = await ipc.invoke('extensions:list-installed');
            const ids = installed
                .filter((ext: any) => ext.contributions?.viewsContainers?.length > 0)
                .map((ext: any) => `ext:${ext.id}`);
            setExtensionViews(ids);
        } catch {}
    }, []);

    React.useEffect(() => {
        loadExtensionViews();
        const handler = () => { loadExtensionViews(); };
        globalThis.addEventListener('singularity:refresh-activity-bar', handler);
        return () => globalThis.removeEventListener('singularity:refresh-activity-bar', handler);
    }, [loadExtensionViews]);

    return (
        <div className="w-full h-full glass flex flex-col border-r border-[var(--border-secondary)]">
            <div style={{ display: activeView === 'explorer' ? 'block' : 'none', height: '100%' }}>
                <FileExplorer onFileSelect={onFileSelect} rootPath={rootPath} onRootChange={onRootChange} />
            </div>
            <div style={{ display: activeView === 'search' ? 'block' : 'none', height: '100%' }}>
                {loadedViews.has('search') && <SearchPane rootPath={rootPath} />}
            </div>
            <div style={{ display: activeView === 'extensions' ? 'block' : 'none', height: '100%' }}>
                {loadedViews.has('extensions') && <ExtensionsPane />}
            </div>
            <div style={{ display: activeView === 'debug' ? 'block' : 'none', height: '100%' }}>
                {loadedViews.has('debug') && <DebugPane rootPath={rootPath} />}
            </div>
            <div style={{ display: activeView === 'git' ? 'block' : 'none', height: '100%' }}>
                {loadedViews.has('git') && <GitPane rootPath={rootPath} />}
            </div>
            <div style={{ display: activeView === 'github' ? 'block' : 'none', height: '100%' }}>
                {loadedViews.has('github') && <GitHubPane rootPath={rootPath} />}
            </div>
            <div style={{ display: activeView === 'remote' ? 'block' : 'none', height: '100%' }}>
                {loadedViews.has('remote') && <RemotePane rootPath={rootPath} onRootChange={onRootChange} />}
            </div>

            {/* Extension sidebar panels — pre-rendered with display:none so iframes load in background */}
            {extensionViews.map(viewId => (
                <div key={viewId} style={{ display: activeView === viewId ? 'block' : 'none', height: '100%' }}>
                    <SidebarExtensionView extensionId={viewId.replace('ext:', '')} />
                </div>
            ))}
        </div>
    );
});

export default Sidebar;
