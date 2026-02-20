import React from 'react';
import FileExplorer from './FileExplorer';
import SearchPane from './panes/SearchPane';
import ExtensionsPane from './panes/ExtensionsPane';
import DebugPane from './panes/DebugPane';
import { SidebarView } from './ActivityBar';

interface SidebarProps {
    activeView: SidebarView;
    onFileSelect: (path: string, content: string) => void;
    rootPath: string | null;
    onRootChange: (path: string) => void;
}

const Sidebar = React.memo<SidebarProps>(({ activeView, onFileSelect, rootPath, onRootChange }) => {
    const [loadedViews, setLoadedViews] = React.useState<Set<string>>(new Set(['explorer']));

    React.useEffect(() => {
        setLoadedViews(prev => {
            if (prev.has(activeView)) return prev;
            return new Set(prev).add(activeView);
        });
    }, [activeView]);

    return (
        <div className="w-64 h-full glass flex flex-col border-r border-white/5">
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
        </div>
    );
});

export default Sidebar;
