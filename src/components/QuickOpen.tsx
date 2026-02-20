import React, { useState, useEffect, useRef } from 'react';
import { Search, File } from 'lucide-react';

interface QuickOpenProps {
    isOpen: boolean;
    onClose: () => void;
    files: string[];
    onSelect: (path: string) => void;
    projectRoot: string | null;
}

const QuickOpen: React.FC<QuickOpenProps> = ({ isOpen, onClose, files, onSelect, projectRoot }) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const filteredFiles = files.filter(file => {
        const relativePath = projectRoot ? file.replace(projectRoot, '') : file;
        return relativePath.toLowerCase().includes(query.toLowerCase());
    }).slice(0, 50); // Limit results

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, filteredFiles.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredFiles[selectedIndex]) {
                onSelect(filteredFiles[selectedIndex]);
                onClose();
            }
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-center pt-20" onClick={onClose}>
            <div
                className="w-[600px] bg-[#1e1e1e] border border-[#3f3f46] rounded-lg shadow-2xl flex flex-col max-h-[400px]"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-3 border-b border-[#27272a] flex items-center gap-3">
                    <Search size={18} className="text-gray-400" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                        onKeyDown={handleKeyDown}
                        placeholder="Search files by name..."
                        className="flex-1 bg-transparent text-white focus:outline-none text-sm placeholder-gray-500"
                    />
                    <span className="text-xs text-gray-500 bg-[#27272a] px-2 py-0.5 rounded">Esc to close</span>
                </div>

                <div className="overflow-y-auto py-2">
                    {filteredFiles.length === 0 ? (
                        <div className="text-center text-gray-500 text-sm py-4">No matching files found</div>
                    ) : (
                        filteredFiles.map((file, index) => {
                            const displayPath = projectRoot ? file.replace(projectRoot, '') : file;
                            // Just show filename in bold, path in gray
                            const filename = displayPath.split(/[/\\]/).pop();
                            const dir = displayPath.substring(0, displayPath.length - (filename?.length || 0));

                            return (
                                <div
                                    key={file}
                                    className={`px-3 py-2 flex items-center gap-3 cursor-pointer text-sm ${index === selectedIndex ? 'bg-[#007acc] text-white' : 'text-gray-300 hover:bg-[#2a2d2e]'}`}
                                    onClick={() => { onSelect(file); onClose(); }}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                >
                                    <File size={14} className={index === selectedIndex ? 'text-white' : 'text-gray-400'} />
                                    <div className="flex flex-col truncate">
                                        <span className="font-medium truncate">{filename}</span>
                                        <span className={`text-xs truncate ${index === selectedIndex ? 'text-gray-200' : 'text-gray-500'}`}>{dir}</span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default QuickOpen;
