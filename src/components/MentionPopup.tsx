import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FileCode } from 'lucide-react';

interface MentionPopupProps {
  query: string;
  files: string[];
  projectRoot: string | null;
  position: { top: number; left: number };
  onSelect: (mention: string, displayName: string) => void;
  onClose: () => void;
}

const MentionPopup: React.FC<MentionPopupProps> = ({
  query, files, projectRoot, position, onSelect, onClose
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const lower = query.toLowerCase();
    const matches = files
      .filter(f => {
        const name = f.split(/[\\/]/).pop() || '';
        const relative = projectRoot ? f.replace(projectRoot, '') : f;
        return name.toLowerCase().includes(lower) || relative.toLowerCase().includes(lower);
      })
      .slice(0, 10);
    return matches;
  }, [query, files, projectRoot]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        case 'Tab':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            const path = filtered[selectedIndex];
            const name = path.split(/[\\/]/).pop() || path;
            onSelect(path, name);
          }
          break;
        case 'Escape':
          onClose();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, selectedIndex, onSelect, onClose]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={ref}
      className="fixed bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 max-h-48 overflow-auto py-1"
      style={{ top: position.top, left: position.left, width: 280 }}
    >
      {filtered.map((file, i) => {
        const name = file.split(/[\\/]/).pop() || file;
        const relative = projectRoot ? file.replace(projectRoot, '').replace(/^[\\/]/, '') : file;
        return (
          <button
            key={file}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left ${
              i === selectedIndex ? 'bg-[var(--accent-bg)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
            onClick={() => onSelect(file, name)}
          >
            <FileCode size={12} className="shrink-0 text-[var(--text-muted)]" />
            <div className="min-w-0">
              <div className="text-[var(--text-primary)] truncate">{name}</div>
              <div className="text-[10px] text-[var(--text-muted)] truncate">{relative}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default React.memo(MentionPopup);
