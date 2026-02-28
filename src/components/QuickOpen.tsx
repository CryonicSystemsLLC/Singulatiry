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
    const listRef = useRef<HTMLDivElement>(null);

    const filteredFiles = files.filter(file => {
        const relativePath = projectRoot ? file.replace(projectRoot, '') : file;
        return relativePath.toLowerCase().includes(query.toLowerCase());
    }).slice(0, 50);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Focus trap
    useEffect(() => {
        if (!isOpen) return;
        const handleTab = (e: KeyboardEvent) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        document.addEventListener('keydown', handleTab);
        return () => document.removeEventListener('keydown', handleTab);
    }, [isOpen]);

    // Scroll selected item into view
    useEffect(() => {
        const item = listRef.current?.children[selectedIndex] as HTMLElement;
        item?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

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
        <div
            className="fixed inset-0 z-50 flex justify-center pt-20"
            onClick={onClose}
            role="presentation"
        >
            <div
                className="w-[600px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-2xl flex flex-col max-h-[400px]"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Quick open file"
            >
                <div className="p-3 border-b border-[var(--border-primary)] flex items-center gap-3">
                    <Search size={18} className="text-[var(--text-secondary)]" aria-hidden="true" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                        onKeyDown={handleKeyDown}
                        placeholder="Search files by name..."
                        className="flex-1 bg-transparent text-[var(--text-primary)] focus:outline-none text-sm placeholder-[var(--text-muted)]"
                        role="combobox"
                        aria-expanded={true}
                        aria-controls="quickopen-list"
                        aria-activedescendant={filteredFiles[selectedIndex] ? `qo-item-${selectedIndex}` : undefined}
                        aria-autocomplete="list"
                    />
                    <kbd className="text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded">Esc to close</kbd>
                </div>

                <div
                    ref={listRef}
                    className="overflow-y-auto py-2"
                    id="quickopen-list"
                    role="listbox"
                    aria-label="Files"
                >
                    {filteredFiles.length === 0 ? (
                        <div className="text-center text-[var(--text-muted)] text-sm py-4" role="status">No matching files found</div>
                    ) : (
                        filteredFiles.map((file, index) => {
                            const displayPath = projectRoot ? file.replace(projectRoot, '') : file;
                            const filename = displayPath.split(/[/\\]/).pop();
                            const dir = displayPath.substring(0, displayPath.length - (filename?.length || 0));

                            return (
                                <div
                                    key={file}
                                    id={`qo-item-${index}`}
                                    className={`px-3 py-2 flex items-center gap-3 cursor-pointer text-sm ${
                                        index === selectedIndex
                                            ? 'bg-[var(--accent-primary)] text-[var(--text-primary)]'
                                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                    }`}
                                    onClick={() => { onSelect(file); onClose(); }}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    role="option"
                                    aria-selected={index === selectedIndex}
                                >
                                    <File size={14} className={index === selectedIndex ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'} aria-hidden="true" />
                                    <div className="flex flex-col truncate">
                                        <span className="font-medium truncate">{filename}</span>
                                        <span className={`text-xs truncate ${index === selectedIndex ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>{dir}</span>
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
