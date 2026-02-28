import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search } from 'lucide-react';

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: string;
  icon?: React.ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, commands }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const lower = query.toLowerCase();
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(lower) ||
      cmd.category.toLowerCase().includes(lower)
    );
  }, [query, commands]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
          onClose();
        }
        break;
      case 'Escape':
        onClose();
        break;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="w-[520px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-primary)]">
          <Search size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-[var(--text-primary)] text-sm focus:outline-none placeholder-[var(--text-muted)]"
            role="combobox"
            aria-expanded={true}
            aria-controls="command-list"
            aria-activedescendant={filtered[selectedIndex] ? `cmd-${filtered[selectedIndex].id}` : undefined}
            aria-autocomplete="list"
          />
        </div>
        <div
          ref={listRef}
          id="command-list"
          className="max-h-[300px] overflow-auto py-1"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-[var(--text-muted)] text-sm" role="status">
              No commands found
            </div>
          )}
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              id={`cmd-${cmd.id}`}
              className={`flex items-center justify-between px-4 py-2 cursor-pointer ${
                i === selectedIndex ? 'bg-[var(--accent-bg)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              onClick={() => { cmd.action(); onClose(); }}
              onMouseEnter={() => setSelectedIndex(i)}
              role="option"
              aria-selected={i === selectedIndex}
            >
              <div className="flex items-center gap-3">
                <span className="text-[var(--text-muted)] w-5" aria-hidden="true">{cmd.icon}</span>
                <div>
                  <span className="text-sm">{cmd.label}</span>
                  <span className="text-xs text-[var(--text-muted)] ml-2">{cmd.category}</span>
                </div>
              </div>
              {cmd.shortcut && (
                <kbd className="text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
                  {cmd.shortcut}
                </kbd>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default React.memo(CommandPalette);
