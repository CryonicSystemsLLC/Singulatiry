import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GitBranch, Plus, Minus, RefreshCw, Loader2, Sparkles, Check } from 'lucide-react';

interface GitPaneProps {
  rootPath: string | null;
}

interface GitFileEntry {
  path: string;
  status: string;
  staged: boolean;
  statusLabel: string;
}

interface GitStatus {
  branch: string;
  files: GitFileEntry[];
  error?: string;
}

/**
 * Returns appropriate color classes for a git status indicator
 */
function statusColor(status: string, staged: boolean): string {
  if (staged) return 'text-[var(--success)]';
  if (status === '?') return 'text-[var(--text-muted)]';
  if (status === 'D') return 'text-[var(--error)]';
  return 'text-[var(--warning)]';
}

/**
 * Returns the background pill color for the status badge
 */
function statusBadgeBg(status: string, staged: boolean): string {
  if (staged) return 'bg-[var(--success)]/20 text-[var(--success)]';
  if (status === '?') return 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]';
  if (status === 'D') return 'bg-[var(--error)]/20 text-[var(--error)]';
  return 'bg-[var(--warning)]/20 text-[var(--warning)]';
}

/**
 * Extract just the filename from a path
 */
function fileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1];
}

const GitPane = React.memo<GitPaneProps>(({ rootPath }) => {
  const [gitStatus, setGitStatus] = useState<GitStatus>({ branch: '', files: [] });
  const [commitMessage, setCommitMessage] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [commitResult, setCommitResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch git status
  const refresh = useCallback(async () => {
    if (!rootPath) {
      setGitStatus({ branch: '', files: [] });
      return;
    }

    setIsRefreshing(true);
    try {
      const result = await window.ipcRenderer.invoke('git:status', rootPath);
      setGitStatus(result);
      if (result.error) {
        setError(result.error);
      } else {
        setError(null);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to get git status');
      setGitStatus({ branch: '', files: [] });
    } finally {
      setIsRefreshing(false);
    }
  }, [rootPath]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    refresh();

    intervalRef.current = setInterval(refresh, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [refresh]);

  // Stage a file
  const stageFile = useCallback(async (filePath: string) => {
    if (!rootPath) return;
    try {
      await window.ipcRenderer.invoke('git:stage', rootPath, [filePath]);
      await refresh();
    } catch (e: any) {
      setError(`Failed to stage: ${e.message}`);
    }
  }, [rootPath, refresh]);

  // Unstage a file
  const unstageFile = useCallback(async (filePath: string) => {
    if (!rootPath) return;
    try {
      await window.ipcRenderer.invoke('git:unstage', rootPath, [filePath]);
      await refresh();
    } catch (e: any) {
      setError(`Failed to unstage: ${e.message}`);
    }
  }, [rootPath, refresh]);

  // Stage all files
  const stageAll = useCallback(async () => {
    if (!rootPath) return;
    const unstaged = gitStatus.files.filter((f) => !f.staged);
    if (unstaged.length === 0) return;
    try {
      await window.ipcRenderer.invoke('git:stage', rootPath, unstaged.map((f) => f.path));
      await refresh();
    } catch (e: any) {
      setError(`Failed to stage all: ${e.message}`);
    }
  }, [rootPath, gitStatus.files, refresh]);

  // Unstage all files
  const unstageAll = useCallback(async () => {
    if (!rootPath) return;
    const staged = gitStatus.files.filter((f) => f.staged);
    if (staged.length === 0) return;
    try {
      await window.ipcRenderer.invoke('git:unstage', rootPath, staged.map((f) => f.path));
      await refresh();
    } catch (e: any) {
      setError(`Failed to unstage all: ${e.message}`);
    }
  }, [rootPath, gitStatus.files, refresh]);

  // Commit staged changes
  const handleCommit = useCallback(async () => {
    if (!rootPath || !commitMessage.trim()) return;

    const stagedFiles = gitStatus.files.filter((f) => f.staged);
    if (stagedFiles.length === 0) {
      setError('No staged changes to commit');
      return;
    }

    setIsCommitting(true);
    setCommitResult(null);
    setError(null);

    try {
      const hash = await window.ipcRenderer.invoke('git:commit', rootPath, commitMessage.trim());
      setCommitResult(`Committed: ${hash}`);
      setCommitMessage('');
      await refresh();

      // Clear result after 4 seconds
      setTimeout(() => setCommitResult(null), 4000);
    } catch (e: any) {
      setError(`Commit failed: ${e.message}`);
    } finally {
      setIsCommitting(false);
    }
  }, [rootPath, commitMessage, gitStatus.files, refresh]);

  // Generate AI commit message
  const generateMessage = useCallback(async () => {
    if (!rootPath) return;

    const stagedFiles = gitStatus.files.filter((f) => f.staged);
    if (stagedFiles.length === 0) {
      setError('Stage some changes first to generate a message');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Get the staged diff
      const diff = await window.ipcRenderer.invoke('git:diff', rootPath, true);

      if (!diff || diff.trim().length === 0) {
        setError('No staged diff available for message generation');
        setIsGenerating(false);
        return;
      }

      // Truncate diff if too large to avoid token limits
      const truncatedDiff = diff.length > 8000 ? diff.substring(0, 8000) + '\n... (truncated)' : diff;

      const response = await (window as any).modelService.chat({
        messages: [
          {
            role: 'system',
            content: `You are a git commit message generator. Given a diff, write a concise conventional commit message.
Use the format: type(scope): description

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Keep the first line under 72 characters
- Be specific about what changed
- Do NOT include backticks, quotes, or markdown formatting
- Return ONLY the commit message, nothing else`,
          },
          {
            role: 'user',
            content: `Generate a commit message for this diff:\n\n${truncatedDiff}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 200,
      });

      if (response && response.content) {
        // Clean up the response - strip any quotes or backticks the model might add
        let msg = response.content.trim();
        msg = msg.replace(/^["'`]+|["'`]+$/g, '');
        msg = msg.replace(/^```[\s\S]*?```$/gm, '').trim();
        setCommitMessage(msg);

        // Focus the textarea
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }
    } catch (e: any) {
      setError(`Failed to generate message: ${e.message}`);
    } finally {
      setIsGenerating(false);
    }
  }, [rootPath, gitStatus.files]);

  // Group files by status
  const stagedFiles = gitStatus.files.filter((f) => f.staged);
  const modifiedFiles = gitStatus.files.filter((f) => !f.staged && f.status !== '?');
  const untrackedFiles = gitStatus.files.filter((f) => !f.staged && f.status === '?');

  // Handle Ctrl+Enter for commit
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  if (!rootPath) {
    return (
      <div className="flex flex-col h-full p-4">
        <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">Source Control</h2>
        <div className="text-xs text-[var(--text-muted)] text-center mt-8">Open a folder to use git</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with branch */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch size={14} className="text-[var(--accent-primary)] shrink-0" />
          <span className="text-xs font-semibold text-[var(--text-secondary)] truncate">
            {gitStatus.branch || 'No branch'}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={isRefreshing}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded"
          title="Refresh"
        >
          <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 px-2 py-1 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded text-[10px] text-[var(--error)]">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-[var(--error)] hover:text-[var(--text-primary)]">&times;</button>
        </div>
      )}

      {/* Success banner */}
      {commitResult && (
        <div className="mx-4 mb-2 px-2 py-1 bg-[var(--success)]/10 border border-[var(--success)]/20 rounded text-[10px] text-[var(--success)] flex items-center gap-1">
          <Check size={10} />
          {commitResult}
        </div>
      )}

      {/* File lists */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2">
        {/* Staged Changes */}
        {stagedFiles.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] font-bold text-[var(--success)] uppercase tracking-wider">
                Staged ({stagedFiles.length})
              </span>
              <button
                onClick={unstageAll}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Unstage All"
              >
                <Minus size={12} />
              </button>
            </div>
            {stagedFiles.map((file) => (
              <FileRow
                key={`staged-${file.path}`}
                file={file}
                onAction={() => unstageFile(file.path)}
                actionIcon="unstage"
              />
            ))}
          </div>
        )}

        {/* Modified (unstaged) */}
        {modifiedFiles.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] font-bold text-[var(--warning)] uppercase tracking-wider">
                Changes ({modifiedFiles.length})
              </span>
              <button
                onClick={stageAll}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Stage All"
              >
                <Plus size={12} />
              </button>
            </div>
            {modifiedFiles.map((file) => (
              <FileRow
                key={`modified-${file.path}`}
                file={file}
                onAction={() => stageFile(file.path)}
                actionIcon="stage"
              />
            ))}
          </div>
        )}

        {/* Untracked */}
        {untrackedFiles.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                Untracked ({untrackedFiles.length})
              </span>
              <button
                onClick={() => {
                  if (!rootPath) return;
                  window.ipcRenderer
                    .invoke('git:stage', rootPath, untrackedFiles.map((f) => f.path))
                    .then(() => refresh());
                }}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Stage All Untracked"
              >
                <Plus size={12} />
              </button>
            </div>
            {untrackedFiles.map((file) => (
              <FileRow
                key={`untracked-${file.path}`}
                file={file}
                onAction={() => stageFile(file.path)}
                actionIcon="stage"
              />
            ))}
          </div>
        )}

        {/* Clean state */}
        {gitStatus.files.length === 0 && !error && (
          <div className="text-xs text-[var(--text-muted)] text-center mt-8 px-4">
            No changes detected in working tree
          </div>
        )}
      </div>

      {/* Commit section */}
      <div className="shrink-0 border-t border-[var(--border-secondary)] p-3 space-y-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Commit message (${navigator.platform.toUpperCase().includes('MAC') ? '⌘' : 'Ctrl'}+Enter to commit)`}
            rows={3}
            className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded-md px-3 py-2 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-muted)] resize-none"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={generateMessage}
            disabled={isGenerating || stagedFiles.length === 0}
            className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-1 justify-center"
            title="Generate AI commit message from staged diff"
          >
            {isGenerating ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Sparkles size={11} />
            )}
            {isGenerating ? 'Generating...' : 'Generate Message'}
          </button>

          <button
            onClick={handleCommit}
            disabled={isCommitting || !commitMessage.trim() || stagedFiles.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--accent-primary)] text-[var(--text-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Commit staged changes"
          >
            {isCommitting ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Check size={11} />
            )}
            Commit
          </button>
        </div>
      </div>
    </div>
  );
});

// ============================================================
// FileRow sub-component
// ============================================================

interface FileRowProps {
  file: GitFileEntry;
  onAction: () => void;
  actionIcon: 'stage' | 'unstage';
}

const FileRow = React.memo<FileRowProps>(({ file, onAction, actionIcon }) => {
  return (
    <div className="flex items-center justify-between group hover:bg-white/5 px-2 py-1 rounded mx-1">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          className={`text-[10px] font-mono font-bold w-4 text-center shrink-0 ${statusColor(file.status, file.staged)}`}
        >
          {file.status}
        </span>
        <span
          className="text-xs text-[var(--text-secondary)] truncate"
          title={file.path}
        >
          {fileName(file.path)}
        </span>
        <span
          className={`text-[9px] px-1 rounded shrink-0 ${statusBadgeBg(file.status, file.staged)}`}
        >
          {file.statusLabel}
        </span>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-all shrink-0"
        title={actionIcon === 'stage' ? 'Stage' : 'Unstage'}
      >
        {actionIcon === 'stage' ? <Plus size={12} /> : <Minus size={12} />}
      </button>
    </div>
  );
});

export default GitPane;
