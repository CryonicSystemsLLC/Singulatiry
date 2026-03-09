import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, Plus, Minus, RefreshCw, Loader2, Sparkles, Check,
  ChevronDown, ArrowUp, ArrowDown, Search, X,
} from 'lucide-react';

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

interface BranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string;
  ahead: number;
  behind: number;
  sha: string;
}

interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
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

  // Branch state
  const [allBranches, setAllBranches] = useState<BranchInfo[]>([]);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Push/pull state
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Push dialog state
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [pushRemote, setPushRemote] = useState('origin');
  const [pushBranch, setPushBranch] = useState('');
  const pushDialogRef = useRef<HTMLDivElement>(null);

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

  // Fetch branch list with tracking info + remotes
  const refreshBranches = useCallback(async () => {
    if (!rootPath) return;
    try {
      const [branchResult, remoteList] = await Promise.all([
        window.ipcRenderer.invoke('git:branch-list-all', rootPath),
        window.ipcRenderer.invoke('git:remote-list', rootPath),
      ]);
      if (branchResult.branches) setAllBranches(branchResult.branches);
      if (Array.isArray(remoteList)) setRemotes(remoteList);
    } catch {
      // silent
    }
  }, [rootPath]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    refresh();
    refreshBranches();

    intervalRef.current = setInterval(() => {
      refresh();
      refreshBranches();
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [refresh, refreshBranches]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowBranchDropdown(false);
      }
      if (pushDialogRef.current && !pushDialogRef.current.contains(e.target as Node)) {
        setShowPushDialog(false);
      }
    };
    if (showBranchDropdown || showPushDialog) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showBranchDropdown, showPushDialog]);

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
      await refreshBranches();

      // Clear result after 4 seconds
      setTimeout(() => setCommitResult(null), 4000);
    } catch (e: any) {
      setError(`Commit failed: ${e.message}`);
    } finally {
      setIsCommitting(false);
    }
  }, [rootPath, commitMessage, gitStatus.files, refresh, refreshBranches]);

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

  // Switch branch
  const switchBranch = useCallback(async (branchName: string) => {
    if (!rootPath) return;
    setShowBranchDropdown(false);
    try {
      // If remote branch like "origin/feature", strip remote prefix for checkout
      let checkoutName = branchName;
      if (branchName.includes('/')) {
        const parts = branchName.split('/');
        // e.g. origin/feature-x → feature-x
        checkoutName = parts.slice(1).join('/');
      }
      await window.ipcRenderer.invoke('git:checkout', rootPath, checkoutName);
      await refresh();
      await refreshBranches();
    } catch (e: any) {
      setError(`Switch failed: ${e.message}`);
    }
  }, [rootPath, refresh, refreshBranches]);

  // Create branch
  const createBranch = useCallback(async () => {
    if (!rootPath || !newBranchName.trim()) return;
    try {
      await window.ipcRenderer.invoke('git:branch-create', rootPath, newBranchName.trim(), true);
      setNewBranchName('');
      setShowCreateBranch(false);
      await refresh();
      await refreshBranches();
    } catch (e: any) {
      setError(`Create branch failed: ${e.message}`);
    }
  }, [rootPath, newBranchName, refresh, refreshBranches]);

  // Open push dialog
  const openPushDialog = useCallback(() => {
    setPushRemote(remotes.length > 0 ? remotes[0].name : 'origin');
    setPushBranch(gitStatus.branch || '');
    setShowPushDialog(true);
  }, [remotes, gitStatus.branch]);

  // Push with selected remote/branch
  const handlePush = useCallback(async (remote?: string, branch?: string) => {
    if (!rootPath || isPushing) return;
    const targetRemote = remote || pushRemote || 'origin';
    const targetBranch = branch || pushBranch || gitStatus.branch;
    setIsPushing(true);
    setShowPushDialog(false);
    setSyncResult(null);
    setError(null);
    try {
      // Check if current branch has upstream
      const currentBranch = allBranches.find((b) => b.current);
      const needsUpstream = !currentBranch?.upstream;
      await window.ipcRenderer.invoke(
        'git:push', rootPath, targetRemote, targetBranch, needsUpstream,
      );
      setSyncResult(`Pushed to ${targetRemote}/${targetBranch}`);
      await refreshBranches();
      setTimeout(() => setSyncResult(null), 4000);
    } catch (e: any) {
      setError(`Push failed: ${e.message}`);
    } finally {
      setIsPushing(false);
    }
  }, [rootPath, isPushing, pushRemote, pushBranch, allBranches, gitStatus.branch, refreshBranches]);

  // Pull
  const handlePull = useCallback(async () => {
    if (!rootPath || isPulling) return;
    setIsPulling(true);
    setSyncResult(null);
    setError(null);
    try {
      await window.ipcRenderer.invoke('git:pull', rootPath);
      setSyncResult('Pulled successfully');
      await refresh();
      await refreshBranches();
      setTimeout(() => setSyncResult(null), 4000);
    } catch (e: any) {
      setError(`Pull failed: ${e.message}`);
    } finally {
      setIsPulling(false);
    }
  }, [rootPath, isPulling, refresh, refreshBranches]);

  // Fetch
  const handleFetch = useCallback(async () => {
    if (!rootPath) return;
    try {
      await window.ipcRenderer.invoke('git:fetch', rootPath);
      await refreshBranches();
    } catch (e: any) {
      setError(`Fetch failed: ${e.message}`);
    }
  }, [rootPath, refreshBranches]);

  // Derived data
  const stagedFiles = gitStatus.files.filter((f) => f.staged);
  const modifiedFiles = gitStatus.files.filter((f) => !f.staged && f.status !== '?');
  const untrackedFiles = gitStatus.files.filter((f) => !f.staged && f.status === '?');

  const currentBranchInfo = allBranches.find((b) => b.current);
  const aheadCount = currentBranchInfo?.ahead || 0;
  const behindCount = currentBranchInfo?.behind || 0;

  const localBranches = allBranches.filter((b) => !b.remote);
  const remoteBranches = allBranches.filter((b) => b.remote);

  const filteredLocal = branchFilter
    ? localBranches.filter((b) => b.name.toLowerCase().includes(branchFilter.toLowerCase()))
    : localBranches;
  const filteredRemote = branchFilter
    ? remoteBranches.filter((b) => b.name.toLowerCase().includes(branchFilter.toLowerCase()))
    : remoteBranches;

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
      {/* Header with branch + push/pull */}
      <div className="flex items-center justify-between px-4 pt-4 pb-1 shrink-0">
        <div className="flex items-center gap-1 min-w-0 flex-1" ref={dropdownRef}>
          <GitBranch size={14} className="text-[var(--accent-primary)] shrink-0" />
          <button
            onClick={() => setShowBranchDropdown(!showBranchDropdown)}
            className="flex items-center gap-0.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate transition-colors"
            title="Switch branch"
          >
            <span className="truncate">{gitStatus.branch || 'No branch'}</span>
            <ChevronDown size={12} className="shrink-0" />
          </button>
          <button
            onClick={() => { setShowCreateBranch(true); setShowBranchDropdown(false); }}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5 rounded transition-colors shrink-0"
            title="New Branch"
          >
            <Plus size={12} />
          </button>

          {/* Branch dropdown */}
          {showBranchDropdown && (
            <div className="absolute left-0 right-0 top-[42px] mx-2 z-50 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md shadow-lg max-h-[320px] flex flex-col overflow-hidden">
              {/* Search */}
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-secondary)]">
                <Search size={12} className="text-[var(--text-muted)] shrink-0" />
                <input
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  placeholder="Filter branches..."
                  className="flex-1 bg-transparent text-xs text-[var(--text-primary)] focus:outline-none placeholder-[var(--text-muted)]"
                  autoFocus
                />
                {branchFilter && (
                  <button onClick={() => setBranchFilter('')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <X size={12} />
                  </button>
                )}
              </div>

              <div className="overflow-y-auto">
                {/* Local branches */}
                {filteredLocal.length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase px-2 py-1 tracking-wider">Local</div>
                    {filteredLocal.map((b) => (
                      <button
                        key={b.name}
                        onClick={() => switchBranch(b.name)}
                        disabled={b.current}
                        className={`w-full text-left px-2 py-1 text-xs flex items-center gap-2 ${
                          b.current
                            ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/5'
                            : 'text-[var(--text-secondary)] hover:bg-white/5'
                        }`}
                      >
                        <span className="truncate flex-1">{b.name}</span>
                        {b.current && <Check size={10} className="shrink-0" />}
                        {(b.ahead > 0 || b.behind > 0) && (
                          <span className="text-[9px] text-[var(--text-muted)] shrink-0 flex items-center gap-1">
                            {b.ahead > 0 && <span className="text-[var(--success)]">↑{b.ahead}</span>}
                            {b.behind > 0 && <span className="text-[var(--warning)]">↓{b.behind}</span>}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Remote branches */}
                {filteredRemote.length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase px-2 py-1 tracking-wider border-t border-[var(--border-secondary)]">Remote</div>
                    {filteredRemote.map((b) => (
                      <button
                        key={b.name}
                        onClick={() => switchBranch(b.name)}
                        className="w-full text-left px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-secondary)] truncate"
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                )}

                {filteredLocal.length === 0 && filteredRemote.length === 0 && (
                  <div className="text-xs text-[var(--text-muted)] text-center py-3">No matching branches</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Refresh */}
        <button
          onClick={() => { handleFetch(); refresh(); }}
          disabled={isRefreshing}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded shrink-0"
          title="Fetch & Refresh"
        >
          <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Push / Pull action bar */}
      <div className="flex items-center gap-2 px-4 pb-2 shrink-0 relative" ref={pushDialogRef}>
        <button
          onClick={openPushDialog}
          disabled={isPushing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors"
          title="Push to remote"
        >
          {isPushing ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
          Push
          {aheadCount > 0 && (
            <span className="text-[9px] font-bold bg-[var(--success)]/20 text-[var(--success)] px-1 rounded">{aheadCount}</span>
          )}
        </button>
        <button
          onClick={handlePull}
          disabled={isPulling}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors"
          title="Pull from remote"
        >
          {isPulling ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
          Pull
          {behindCount > 0 && (
            <span className="text-[9px] font-bold bg-[var(--warning)]/20 text-[var(--warning)] px-1 rounded">{behindCount}</span>
          )}
        </button>

        {/* Push dialog */}
        {showPushDialog && (
          <div className="absolute left-4 top-[36px] z-50 w-[240px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md shadow-lg p-3 space-y-2">
            <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Push to Remote</div>

            {/* Remote selector */}
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Remote</label>
              <select
                value={pushRemote}
                onChange={(e) => setPushRemote(e.target.value)}
                className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none"
              >
                {remotes.map((r) => (
                  <option key={r.name} value={r.name}>{r.name}</option>
                ))}
                {remotes.length === 0 && <option value="origin">origin</option>}
              </select>
            </div>

            {/* Branch selector */}
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Branch</label>
              <select
                value={pushBranch}
                onChange={(e) => setPushBranch(e.target.value)}
                className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none"
              >
                {localBranches.map((b) => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handlePush()}
                disabled={isPushing}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded bg-[var(--accent-primary)] text-[var(--btn-text)] hover:opacity-90 disabled:opacity-40"
              >
                {isPushing ? <Loader2 size={11} className="animate-spin" /> : <ArrowUp size={11} />}
                Push
              </button>
              <button
                onClick={() => setShowPushDialog(false)}
                className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Ahead/behind bar */}
      {currentBranchInfo?.upstream && (aheadCount > 0 || behindCount > 0) && (
        <div className="px-4 pb-1 shrink-0">
          <div className="text-[9px] text-[var(--text-muted)] flex items-center gap-2">
            {aheadCount > 0 && <span className="text-[var(--success)]">↑ {aheadCount} ahead</span>}
            {behindCount > 0 && <span className="text-[var(--warning)]">↓ {behindCount} behind</span>}
            {aheadCount === 0 && behindCount === 0 && <span>Up to date</span>}
          </div>
        </div>
      )}

      {/* Create branch inline */}
      {showCreateBranch && (
        <div className="mx-4 mb-2 flex items-center gap-1 shrink-0">
          <input
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createBranch()}
            placeholder="New branch name..."
            className="flex-1 bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded px-2 py-1 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-muted)]"
            autoFocus
          />
          <button
            onClick={createBranch}
            disabled={!newBranchName.trim()}
            className="text-[10px] px-2 py-1 rounded bg-[var(--accent-primary)] text-[var(--btn-text)] hover:opacity-90 disabled:opacity-40"
          >
            Create
          </button>
          <button
            onClick={() => { setShowCreateBranch(false); setNewBranchName(''); }}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 px-2 py-1 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded text-[10px] text-[var(--error)]">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-[var(--error)] hover:text-[var(--text-primary)]">&times;</button>
        </div>
      )}

      {/* Success banners */}
      {commitResult && (
        <div className="mx-4 mb-2 px-2 py-1 bg-[var(--success)]/10 border border-[var(--success)]/20 rounded text-[10px] text-[var(--success)] flex items-center gap-1">
          <Check size={10} />
          {commitResult}
        </div>
      )}
      {syncResult && (
        <div className="mx-4 mb-2 px-2 py-1 bg-[var(--success)]/10 border border-[var(--success)]/20 rounded text-[10px] text-[var(--success)] flex items-center gap-1">
          <Check size={10} />
          {syncResult}
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--accent-primary)] text-[var(--btn-text)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
