import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { useRemoteStore } from '../stores/remoteStore';
import RemotePathDialog from './RemotePathDialog';
import { getFileIcon } from '../utils/fileIcons';

interface FileNode {
    name: string;
    isDirectory: boolean;
    path: string;
}

interface TreeNode extends FileNode {
    depth: number;
    isOpen: boolean;
    hasChildren: boolean;
    childrenLoaded: boolean;
}

interface FileExplorerProps {
    onFileSelect: (path: string, content: string) => void;
    rootPath: string | null;
    onRootChange: (path: string) => void;
}

const sortEntries = (entries: FileNode[]) =>
    entries.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
        return a.isDirectory ? -1 : 1;
    });

const TreeRow: React.FC<{
    node: TreeNode;
    index: number;
    isFocused: boolean;
    onItemClick: (node: TreeNode, index: number) => void;
}> = ({ node, index, isFocused, onItemClick }) => (
    <div
        style={{ paddingLeft: node.depth * 16 + 8, height: 28 }}
        className={`flex items-center gap-1 px-2 cursor-pointer select-none text-sm shrink-0
            hover:bg-[var(--bg-tertiary)]
            ${isFocused ? 'bg-[var(--bg-tertiary)] outline outline-1 outline-[var(--accent-primary)]' : ''}
            ${node.isOpen ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
        onClick={() => onItemClick(node, index)}
        role="treeitem"
        aria-expanded={node.isDirectory ? node.isOpen : undefined}
        aria-selected={isFocused}
        aria-level={node.depth + 1}
        tabIndex={isFocused ? 0 : -1}
    >
        <div className="w-4 flex-shrink-0 flex justify-center">
            {node.isDirectory && (
                node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            )}
        </div>
        {node.isDirectory ? (
            node.isOpen ? <FolderOpen size={14} color="#60a5fa" /> : <Folder size={14} color="#60a5fa" />
        ) : (
            (() => { const { Icon, color } = getFileIcon(node.name); return <Icon size={14} color={color} />; })()
        )}
        <span className="truncate">{node.name}</span>
    </div>
);

const FileExplorer = React.memo<FileExplorerProps>(({ onFileSelect, rootPath, onRootChange }) => {
    const [flatTree, setFlatTree] = useState<TreeNode[]>([]);
    const [childrenMap, setChildrenMap] = useState<Map<string, FileNode[]>>(new Map());
    const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [focusIndex, setFocusIndex] = useState(-1);
    const [remotePathOpen, setRemotePathOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const remoteActive = useRemoteStore(s => s.activeConnectionId) !== null;
    const remoteConfig = useRemoteStore(s => s.connectionState?.config);

    // Load root directory
    useEffect(() => {
        if (rootPath) {
            loadDirectory(rootPath).then(entries => {
                setChildrenMap(new Map([[rootPath, entries]]));
                setOpenDirs(new Set());
            });
        } else {
            setFlatTree([]);
            setChildrenMap(new Map());
            setOpenDirs(new Set());
        }
    }, [rootPath]);

    // Refresh when remote files change (polled by RemoteFileWatcher)
    useEffect(() => {
        if (!remoteActive || !rootPath) return;
        const handler = () => {
            loadDirectory(rootPath).then(entries => {
                setChildrenMap(prev => new Map(prev).set(rootPath, entries));
            });
        };
        window.addEventListener('remote-files-changed', handler);
        return () => window.removeEventListener('remote-files-changed', handler);
    }, [remoteActive, rootPath]);

    // Rebuild flat tree whenever openDirs or childrenMap change
    useEffect(() => {
        if (!rootPath) return;
        const rootChildren = childrenMap.get(rootPath);
        if (!rootChildren) return;

        const flat: TreeNode[] = [];
        const buildFlat = (entries: FileNode[], depth: number) => {
            for (const entry of entries) {
                const isOpen = openDirs.has(entry.path);
                const children = childrenMap.get(entry.path);
                flat.push({
                    ...entry,
                    depth,
                    isOpen,
                    hasChildren: entry.isDirectory,
                    childrenLoaded: !!children,
                });
                if (isOpen && children) {
                    buildFlat(children, depth + 1);
                }
            }
        };
        buildFlat(rootChildren, 0);
        setFlatTree(flat);
    }, [rootPath, openDirs, childrenMap]);

    const loadDirectory = async (dirPath: string): Promise<FileNode[]> => {
        setLoading(true);
        try {
            const entries = await window.ipcRenderer.invoke('fs:readDir', dirPath);
            return sortEntries(entries);
        } catch (err) {
            console.error(err);
            return [];
        } finally {
            setLoading(false);
        }
    };

    const handleOpenFolder = async () => {
        if (remoteActive) {
            // In remote mode, show a text input instead of native OS dialog
            setRemotePathOpen(true);
            return;
        }
        try {
            const path = await window.ipcRenderer.invoke('dialog:openDirectory');
            if (path) onRootChange(path);
        } catch (error) {
            console.error(error);
        }
    };

    const toggleDir = useCallback(async (node: TreeNode) => {
        if (!node.isDirectory) return;

        const newOpen = new Set(openDirs);
        if (newOpen.has(node.path)) {
            newOpen.delete(node.path);
        } else {
            newOpen.add(node.path);
            if (!childrenMap.has(node.path)) {
                const children = await loadDirectory(node.path);
                setChildrenMap(prev => new Map(prev).set(node.path, children));
            }
        }
        setOpenDirs(newOpen);
    }, [openDirs, childrenMap]);

    const handleItemClick = useCallback(async (node: TreeNode, index: number) => {
        setFocusIndex(index);
        if (node.isDirectory) {
            await toggleDir(node);
        } else {
            try {
                const content = await window.ipcRenderer.invoke('fs:readFile', node.path);
                onFileSelect(node.path, content);
            } catch (err) {
                console.error(err);
            }
        }
    }, [toggleDir, onFileSelect]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (flatTree.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusIndex(prev => Math.min(prev + 1, flatTree.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'ArrowRight': {
                e.preventDefault();
                const node = flatTree[focusIndex];
                if (node?.isDirectory && !node.isOpen) {
                    toggleDir(node);
                }
                break;
            }
            case 'ArrowLeft': {
                e.preventDefault();
                const node = flatTree[focusIndex];
                if (node?.isDirectory && node.isOpen) {
                    toggleDir(node);
                }
                break;
            }
            case 'Enter':
            case ' ': {
                e.preventDefault();
                const node = flatTree[focusIndex];
                if (node) handleItemClick(node, focusIndex);
                break;
            }
        }
    }, [flatTree, focusIndex, toggleDir, handleItemClick]);

    // Scroll focused item into view
    useEffect(() => {
        if (focusIndex >= 0 && scrollRef.current) {
            const row = scrollRef.current.children[focusIndex] as HTMLElement | undefined;
            row?.scrollIntoView({ block: 'nearest' });
        }
    }, [focusIndex]);

    return (
        <div className="flex flex-col h-full text-[var(--text-secondary)]">
            <div className="p-2 border-b border-[var(--border-primary)] flex justify-between items-center">
                <span className="text-xs font-bold tracking-wider text-[var(--text-muted)] uppercase">Explorer</span>
                <button
                    onClick={handleOpenFolder}
                    className="text-xs bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] px-2 py-1 rounded text-[var(--text-primary)] transition-colors"
                    aria-label="Open folder"
                >
                    Open
                </button>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto"
                onKeyDown={handleKeyDown}
                role="tree"
                aria-label="File explorer"
                tabIndex={0}
            >
                {!rootPath && (
                    <div className="text-xs text-center mt-10 text-[var(--text-muted)]">
                        No folder opened.
                    </div>
                )}

                {loading && flatTree.length === 0 && (
                    <div className="text-xs text-center mt-2" role="status">Loading...</div>
                )}

                {flatTree.map((node, index) => (
                    <TreeRow
                        key={node.path}
                        node={node}
                        index={index}
                        isFocused={index === focusIndex}
                        onItemClick={handleItemClick}
                    />
                ))}
            </div>

            {/* Remote path input (replaces native OS dialog in SSH mode) */}
            <RemotePathDialog
                isOpen={remotePathOpen}
                onClose={() => setRemotePathOpen(false)}
                onConfirm={(path) => onRootChange(path)}
                defaultPath={remoteConfig?.defaultDirectory || rootPath || ''}
            />
        </div>
    );
});

export default FileExplorer;
