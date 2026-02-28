import React, { useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { Check, X, FileCode } from 'lucide-react';

interface FileChange {
  path: string;
  originalContent: string;
  newContent: string;
}

interface DiffViewerProps {
  changes: FileChange[];
  onAccept: (path: string, content: string) => void;
  onReject: (path: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
}

const DiffViewer: React.FC<DiffViewerProps> = ({
  changes, onAccept, onReject, onAcceptAll, onRejectAll, onClose
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, 'accepted' | 'rejected'>>({});

  const activeChange = changes[activeIndex];
  const pendingCount = changes.filter(c => !decisions[c.path]).length;

  const handleAccept = (change: FileChange) => {
    onAccept(change.path, change.newContent);
    setDecisions(d => ({ ...d, [change.path]: 'accepted' }));
  };

  const handleReject = (change: FileChange) => {
    onReject(change.path);
    setDecisions(d => ({ ...d, [change.path]: 'rejected' }));
  };

  const detectLanguage = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', rs: 'rust', go: 'go', json: 'json', html: 'html',
      css: 'css', scss: 'scss', md: 'markdown', yaml: 'yaml', yml: 'yaml'
    };
    return map[ext] || 'plaintext';
  };

  if (changes.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm">
      <div className="w-[90vw] h-[85vh] bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <FileCode size={18} className="text-[var(--accent-primary)]" />
            <span className="text-[var(--text-primary)] font-semibold">Review AI Changes</span>
            <span className="text-xs text-[var(--text-muted)]">
              {changes.length} file{changes.length > 1 ? 's' : ''} changed, {pendingCount} pending
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { onAcceptAll(); onClose(); }}
              className="px-3 py-1.5 text-xs bg-[var(--success)] hover:bg-[var(--success)] text-[var(--text-primary)] rounded"
            >
              Accept All
            </button>
            <button
              onClick={() => { onRejectAll(); onClose(); }}
              className="px-3 py-1.5 text-xs bg-[var(--error)] hover:bg-[var(--error)] text-[var(--text-primary)] rounded"
            >
              Reject All
            </button>
            <button onClick={onClose} className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* File list */}
          <div className="w-56 border-r border-[var(--border-primary)] overflow-auto shrink-0">
            {changes.map((change, i) => {
              const name = change.path.split(/[\\/]/).pop() || change.path;
              const decision = decisions[change.path];
              return (
                <button
                  key={change.path}
                  onClick={() => setActiveIndex(i)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left ${
                    i === activeIndex ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {decision === 'accepted' ? (
                    <Check size={12} className="text-[var(--success)] shrink-0" />
                  ) : decision === 'rejected' ? (
                    <X size={12} className="text-[var(--error)] shrink-0" />
                  ) : (
                    <FileCode size={12} className="text-[var(--text-muted)] shrink-0" />
                  )}
                  <span className="truncate">{name}</span>
                </button>
              );
            })}
          </div>

          {/* Diff editor */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-primary)]">
              <span className="text-xs text-[var(--text-secondary)] truncate">{activeChange?.path}</span>
              {activeChange && !decisions[activeChange.path] && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAccept(activeChange)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--success)] hover:bg-[var(--success)] text-[var(--text-primary)] rounded"
                  >
                    <Check size={12} /> Accept
                  </button>
                  <button
                    onClick={() => handleReject(activeChange)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--error)]/30 hover:bg-[var(--error)] text-[var(--error)] hover:text-[var(--text-primary)] rounded"
                  >
                    <X size={12} /> Reject
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1">
              {activeChange && (
                <DiffEditor
                  original={activeChange.originalContent}
                  modified={activeChange.newContent}
                  language={detectLanguage(activeChange.path)}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    scrollBeyondLastLine: false
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(DiffViewer);
