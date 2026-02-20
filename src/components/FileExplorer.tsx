import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, File, FolderOpen } from 'lucide-react';

interface FileNode {
    name: string;
    isDirectory: boolean;
    path: string;
    children?: FileNode[];
    isOpen?: boolean;
}

interface FileExplorerProps {
    onFileSelect: (path: string, content: string) => void;
    rootPath: string | null;
    onRootChange: (path: string) => void;
}

const FileExplorer = React.memo<FileExplorerProps>(({ onFileSelect, rootPath, onRootChange }) => {
    // const [rootPath, setRootPath] = useState<string | null>(null); // Lifted up
    const [files, setFiles] = useState<FileNode[]>([]);
    const [loading, setLoading] = useState(false);

    // Initial load if rootPath exists
    React.useEffect(() => {
        if (rootPath) {
            loadDirectory(rootPath);
        } else {
            setFiles([]);
        }
    }, [rootPath]);

    const handleOpenFolder = async () => {
        try {
            const path = await window.ipcRenderer.invoke('dialog:openDirectory');
            if (path) {
                onRootChange(path);
                // loadDirectory(path); // useEffect will trigger
            }
        } catch (error) {
            console.error(error);
        }
    };

    const loadDirectory = async (path: string) => {
        setLoading(true);
        try {
            const entries = await window.ipcRenderer.invoke('fs:readDir', path);
            // Sort: Directories first, then files
            const sorted = entries.sort((a: { isDirectory: boolean; name: string; }, b: { isDirectory: boolean; name: string; }) => {
                if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
                return a.isDirectory ? -1 : 1;
            });
            setFiles(sorted);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleFileClick = async (file: FileNode) => {
        if (file.isDirectory) {
            // TODO: Implement recursive directory expansion
        } else {
            try {
                const content = await window.ipcRenderer.invoke('fs:readFile', file.path);
                onFileSelect(file.path, content);
            } catch (err) {
                console.error(err);
            }
        }
    };

    return (
        <div className="flex flex-col h-full text-gray-300">
            <div className="p-2 border-b border-[#27272a] flex justify-between items-center">
                <span className="text-xs font-bold tracking-wider text-gray-500 uppercase">Explorer</span>
                <button
                    onClick={handleOpenFolder}
                    className="text-xs bg-[#27272a] hover:bg-[#3f3f46] px-2 py-1 rounded text-white transition-colors"
                >
                    Open
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {!rootPath && (
                    <div className="text-xs text-center mt-10 text-gray-500">
                        No folder opened.
                    </div>
                )}

                {loading && <div className="text-xs text-center mt-2">Loading...</div>}

                {files.map((file) => (
                    <FileTreeItem key={file.path} node={file} onFileSelect={handleFileClick} />
                ))}
            </div>
        </div>
    );
});

const FileTreeItem: React.FC<{ node: FileNode; onFileSelect: (node: FileNode) => void }> = ({ node, onFileSelect }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [children, setChildren] = useState<FileNode[] | null>(null);

    const handleClick = async () => {
        if (node.isDirectory) {
            if (!isOpen && !children) {
                // Load children
                try {
                    const entries = await window.ipcRenderer.invoke('fs:readDir', node.path);
                    const sorted = entries.sort((a: { isDirectory: boolean; name: string; }, b: { isDirectory: boolean; name: string; }) => {
                        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
                        return a.isDirectory ? -1 : 1;
                    });
                    setChildren(sorted);
                } catch (e) {
                    console.error(e);
                }
            }
            setIsOpen(!isOpen);
        } else {
            onFileSelect(node);
        }
    };

    return (
        <div className="text-sm select-none">
            <div
                className={`flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-[#27272a] ${isOpen ? 'text-white' : 'text-gray-400'}`}
                onClick={handleClick}
            >
                <div className="w-4 flex justify-center">
                    {node.isDirectory && (
                        isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                    )}
                </div>
                {node.isDirectory ? (
                    isOpen ? <FolderOpen size={14} color="#60a5fa" /> : <Folder size={14} color="#60a5fa" />
                ) : (
                    <File size={14} className="text-gray-500" />
                )}
                <span className="truncate">{node.name}</span>
            </div>

            {isOpen && children && (
                <div className="pl-4 border-l border-[#27272a] ml-2">
                    {children.map(child => (
                        <FileTreeItem key={child.path} node={child} onFileSelect={onFileSelect} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default FileExplorer;
