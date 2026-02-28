/**
 * Remote Path Dialog
 *
 * Simple modal for entering a remote filesystem path when in SSH mode.
 * Replaces the native OS directory picker since that can't browse remote filesystems.
 */

import React, { useState, useRef, useEffect } from 'react';
import { FolderOpen, X } from 'lucide-react';

interface RemotePathDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (path: string) => void;
  defaultPath?: string;
}

const RemotePathDialog: React.FC<RemotePathDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  defaultPath = '',
}) => {
  const [remotePath, setRemotePath] = useState(defaultPath);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setRemotePath(defaultPath);
      // Focus input after render
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, defaultPath]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const trimmed = remotePath.trim();
    if (trimmed) {
      onConfirm(trimmed);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[440px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)]">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-[var(--accent-primary)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Open Remote Folder</span>
          </div>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          <label className="block text-xs text-[var(--text-muted)] mb-2">
            Enter the absolute path on the remote machine:
          </label>
          <input
            ref={inputRef}
            type="text"
            value={remotePath}
            onChange={(e) => setRemotePath(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="/home/user/project"
            className="w-full px-3 py-2 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded focus:border-[var(--accent-primary)] focus:outline-none font-mono"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-secondary)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!remotePath.trim()}
            className="px-4 py-1.5 text-xs font-medium rounded bg-[var(--accent-primary)] text-white hover:brightness-110 disabled:opacity-40 transition-colors"
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
};

export default RemotePathDialog;
