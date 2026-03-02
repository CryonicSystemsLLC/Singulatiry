import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Github, RefreshCw, Settings, Loader2, GitPullRequest,
  CircleDot, Bell, Zap, ChevronLeft, MessageSquare,
  Check, X, ExternalLink, ChevronDown, Search, GitBranch,
  FolderDown, Star, Lock, ArrowUp, ArrowDown, Plus,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

interface GitHubPaneProps {
  rootPath: string | null;
}

interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
  html_url: string;
}

interface PR {
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  body: string | null;
  draft: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
  labels: { name: string; color: string }[];
}

interface Issue {
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  body: string | null;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatar_url: string }[];
  comments: number;
}

interface Comment {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  created_at: string;
  html_url: string;
}

interface Notification {
  id: string;
  unread: boolean;
  reason: string;
  subject: { title: string; type: string; url: string | null };
  repository: { full_name: string };
  updated_at: string;
}

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_branch: string;
  head_sha: string;
  created_at: string;
  event: string;
}

interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

interface RepoEntry {
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
}

interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

type Tab = 'prs' | 'issues' | 'notifs' | 'actions' | 'branches';

// ============================================================
// Helpers
// ============================================================

const ipc = window.ipcRenderer;

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function runStatusIcon(status: string, conclusion: string | null) {
  if (status === 'completed') {
    if (conclusion === 'success') return <Check size={14} className="text-[var(--success)]" />;
    if (conclusion === 'failure') return <X size={14} className="text-[var(--error)]" />;
    if (conclusion === 'cancelled') return <X size={14} className="text-[var(--text-muted)]" />;
    return <Check size={14} className="text-[var(--warning)]" />;
  }
  if (status === 'in_progress' || status === 'queued' || status === 'waiting') {
    return <Loader2 size={14} className="animate-spin text-[var(--warning)]" />;
  }
  return <CircleDot size={14} className="text-[var(--text-muted)]" />;
}

function Label({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: `#${color}30`, color: `#${color}`, border: `1px solid #${color}50` }}
    >
      {name}
    </span>
  );
}

// ============================================================
// TokenSetup
// ============================================================

function TokenSetup({ onAuthenticated }: { onAuthenticated: (user: GitHubUser) => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setError('');
    setValidating(true);
    try {
      const user = await ipc.invoke('github:validate-token', token.trim());
      await ipc.invoke('github:set-token', token.trim());
      onAuthenticated(user);
    } catch (err: any) {
      setError(err.message || 'Invalid token');
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <Github size={48} className="text-[var(--text-muted)] mb-4" />
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Connect to GitHub</h3>
      <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[240px]">
        Enter a Personal Access Token with <code className="text-[var(--accent-primary)]">repo</code> and <code className="text-[var(--accent-primary)]">notifications</code> scopes.
      </p>
      <form onSubmit={handleSubmit} className="w-full max-w-[280px] space-y-3">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded-md px-3 py-2 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-muted)]"
        />
        {error && <p className="text-xs text-[var(--error)]">{error}</p>}
        <button
          type="submit"
          disabled={validating || !token.trim()}
          className="w-full bg-[var(--accent-primary)] text-[var(--text-primary)] text-xs font-medium py-2 rounded-md hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {validating ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} />}
          {validating ? 'Validating...' : 'Connect'}
        </button>
      </form>
    </div>
  );
}

// ============================================================
// Main GitHubPane
// ============================================================

const GitHubPane: React.FC<GitHubPaneProps> = ({ rootPath }) => {
  // Auth state
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Repo state
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [repoError, setRepoError] = useState('');

  // Repo picker state
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [repoSearchResults, setRepoSearchResults] = useState<RepoEntry[]>([]);
  const [userRepos, setUserRepos] = useState<RepoEntry[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [manualRepoInput, setManualRepoInput] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repoPickerRef = useRef<HTMLDivElement>(null);

  // Clone state
  const [showClone, setShowClone] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneTarget, setCloneTarget] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneResult, setCloneResult] = useState<string | null>(null);

  // Branches state
  const [ghBranches, setGhBranches] = useState<GitHubBranch[]>([]);

  // Create branch state
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [branchResult, setBranchResult] = useState<string | null>(null);

  // Push/Pull state
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('prs');

  // List states
  const [prs, setPrs] = useState<PR[]>([]);
  const [prFilter, setPrFilter] = useState<'open' | 'closed'>('open');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>('open');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);

  // Detail states
  const [selectedPR, setSelectedPR] = useState<PR | null>(null);
  const [prFiles, setPrFiles] = useState<ChangedFile[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Init: check token ---
  useEffect(() => {
    (async () => {
      try {
        const has = await ipc.invoke('github:has-token');
        setHasToken(has);
        if (has) {
          const u = await ipc.invoke('github:validate-token');
          setUser(u);
        }
      } catch {
        setHasToken(false);
      }
    })();
  }, []);

  // --- Detect remote ---
  useEffect(() => {
    if (!rootPath || !hasToken) return;
    (async () => {
      try {
        const remote = await ipc.invoke('github:detect-remote', rootPath);
        if (remote) {
          setOwner(remote.owner);
          setRepo(remote.repo);
          setRepoError('');
        } else {
          setRepoError('No GitHub remote found');
        }
      } catch {
        setRepoError('Failed to detect remote');
      }
    })();
  }, [rootPath, hasToken]);

  // --- Fetch data for active tab ---
  const fetchTabData = useCallback(async () => {
    if (!owner || !repo) return;
    setLoading(true);
    try {
      switch (activeTab) {
        case 'prs': {
          const data = await ipc.invoke('github:list-prs', owner, repo, prFilter);
          setPrs(data);
          break;
        }
        case 'issues': {
          const data = await ipc.invoke('github:list-issues', owner, repo, issueFilter);
          setIssues(data);
          break;
        }
        case 'notifs': {
          const data = await ipc.invoke('github:notifications');
          setNotifications(data);
          break;
        }
        case 'actions': {
          const data = await ipc.invoke('github:list-runs', owner, repo);
          setRuns(data);
          break;
        }
        case 'branches': {
          const data = await ipc.invoke('github:list-branches', owner, repo);
          setGhBranches(data);
          break;
        }
      }
    } catch (err: any) {
      console.error('GitHub fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, activeTab, prFilter, issueFilter]);

  useEffect(() => {
    if (hasToken && owner && repo) {
      fetchTabData();
    }
  }, [hasToken, owner, repo, fetchTabData]);

  // --- 30s polling ---
  useEffect(() => {
    if (!hasToken || !owner || !repo) return;
    pollRef.current = setInterval(fetchTabData, 30000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasToken, owner, repo, fetchTabData]);

  // --- Fetch user repos for picker ---
  const loadUserRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const data = await ipc.invoke('github:list-user-repos');
      setUserRepos(data);
    } catch {
      // silent
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  // --- Search repos (debounced) ---
  useEffect(() => {
    if (!repoSearchQuery.trim()) {
      setRepoSearchResults([]);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const data = await ipc.invoke('github:search-repos', repoSearchQuery.trim());
        setRepoSearchResults(data);
      } catch {
        setRepoSearchResults([]);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [repoSearchQuery]);

  // --- Close repo picker on outside click ---
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (repoPickerRef.current && !repoPickerRef.current.contains(e.target as Node)) {
        setShowRepoPicker(false);
      }
    };
    if (showRepoPicker) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showRepoPicker]);

  // --- Select repo ---
  const selectRepo = useCallback((entry: RepoEntry) => {
    setOwner(entry.owner);
    setRepo(entry.name);
    setRepoError('');
    setShowRepoPicker(false);
    setCloneUrl(entry.clone_url);
    // Reset tab data
    setPrs([]);
    setIssues([]);
    setGhBranches([]);
    setRuns([]);
  }, []);

  // --- Manual repo entry ---
  const handleManualRepo = useCallback(() => {
    const parts = manualRepoInput.trim().split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      setOwner(parts[0]);
      setRepo(parts[1]);
      setRepoError('');
      setShowRepoPicker(false);
      setManualRepoInput('');
      setPrs([]);
      setIssues([]);
      setGhBranches([]);
      setRuns([]);
    }
  }, [manualRepoInput]);

  // --- Clone ---
  const handleClone = useCallback(async () => {
    if (!cloneUrl.trim() || !cloneTarget.trim()) return;
    setIsCloning(true);
    setCloneResult(null);
    try {
      const result = await ipc.invoke('git:clone', cloneUrl.trim(), cloneTarget.trim());
      setCloneResult(`Cloned to ${result.path}`);
      setTimeout(() => setCloneResult(null), 6000);
    } catch (e: any) {
      setCloneResult(`Clone failed: ${e.message}`);
    } finally {
      setIsCloning(false);
    }
  }, [cloneUrl, cloneTarget]);

  // --- Create branch ---
  const handleCreateBranch = useCallback(async () => {
    if (!rootPath || !newBranchName.trim() || isCreatingBranch) return;
    setIsCreatingBranch(true);
    setBranchResult(null);
    try {
      await ipc.invoke('git:branch-create', rootPath, newBranchName.trim(), true);
      setBranchResult(`Switched to new branch: ${newBranchName.trim()}`);
      setNewBranchName('');
      setShowCreateBranch(false);
      // Refresh branches tab if active
      if (activeTab === 'branches' && owner && repo) {
        const data = await ipc.invoke('github:list-branches', owner, repo);
        setGhBranches(data);
      }
      setTimeout(() => setBranchResult(null), 4000);
    } catch (e: any) {
      setBranchResult(`Branch failed: ${e.message}`);
      setTimeout(() => setBranchResult(null), 6000);
    } finally {
      setIsCreatingBranch(false);
    }
  }, [rootPath, newBranchName, isCreatingBranch, activeTab, owner, repo]);

  // --- Push ---
  const handlePush = useCallback(async () => {
    if (!rootPath || isPushing) return;
    setIsPushing(true);
    setSyncResult(null);
    try {
      await ipc.invoke('git:push', rootPath);
      setSyncResult('Pushed successfully');
      setTimeout(() => setSyncResult(null), 4000);
    } catch (e: any) {
      setSyncResult(`Push failed: ${e.message}`);
      setTimeout(() => setSyncResult(null), 6000);
    } finally {
      setIsPushing(false);
    }
  }, [rootPath, isPushing]);

  // --- Pull ---
  const handlePull = useCallback(async () => {
    if (!rootPath || isPulling) return;
    setIsPulling(true);
    setSyncResult(null);
    try {
      await ipc.invoke('git:pull', rootPath);
      setSyncResult('Pulled successfully');
      setTimeout(() => setSyncResult(null), 4000);
    } catch (e: any) {
      setSyncResult(`Pull failed: ${e.message}`);
      setTimeout(() => setSyncResult(null), 6000);
    } finally {
      setIsPulling(false);
    }
  }, [rootPath, isPulling]);

  // --- Set as remote ---
  const handleSetAsRemote = useCallback(async () => {
    if (!rootPath || !owner || !repo) return;
    try {
      const remotes = await ipc.invoke('git:remote-list', rootPath);
      const hasOrigin = remotes.some((r: any) => r.name === 'origin');
      const remoteName = hasOrigin ? 'github' : 'origin';
      const url = `https://github.com/${owner}/${repo}.git`;
      await ipc.invoke('git:remote-add', rootPath, remoteName, url);
      setShowSettings(false);
    } catch (e: any) {
      console.error('Failed to add remote:', e);
    }
  }, [rootPath, owner, repo]);

  // --- PR detail ---
  const openPRDetail = useCallback(async (pr: PR) => {
    setSelectedPR(pr);
    setComments([]);
    setPrFiles([]);
    try {
      const [files, cmts] = await Promise.all([
        ipc.invoke('github:pr-files', owner, repo, pr.number),
        ipc.invoke('github:issue-comments', owner, repo, pr.number),
      ]);
      setPrFiles(files);
      setComments(cmts);
    } catch (err) {
      console.error('Failed to load PR detail:', err);
    }
  }, [owner, repo]);

  // --- Issue detail ---
  const openIssueDetail = useCallback(async (issue: Issue) => {
    setSelectedIssue(issue);
    setComments([]);
    try {
      const cmts = await ipc.invoke('github:issue-comments', owner, repo, issue.number);
      setComments(cmts);
    } catch (err) {
      console.error('Failed to load issue detail:', err);
    }
  }, [owner, repo]);

  // --- Add comment ---
  const handleAddComment = useCallback(async (number: number) => {
    if (!newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const cmt = await ipc.invoke('github:add-comment', owner, repo, number, newComment.trim());
      setComments(prev => [...prev, cmt]);
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setSubmittingComment(false);
    }
  }, [owner, repo, newComment]);

  // --- Mark notification read ---
  const markRead = useCallback(async (id: string) => {
    try {
      await ipc.invoke('github:mark-notification-read', id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, unread: false } : n));
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  }, []);

  // --- Disconnect ---
  const handleDisconnect = useCallback(async () => {
    await ipc.invoke('github:remove-token');
    setHasToken(false);
    setUser(null);
    setShowSettings(false);
    setOwner('');
    setRepo('');
  }, []);

  // --- Open external link ---
  const openExternal = useCallback((url: string) => {
    window.ipcRenderer.invoke('shell:open-external', url).catch(() => {
      window.open(url, '_blank');
    });
  }, []);

  // --- Token setup ---
  if (hasToken === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-[var(--accent-primary)]" />
      </div>
    );
  }

  if (!hasToken) {
    return (
      <div className="flex flex-col h-full p-4 overflow-hidden">
        <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase mb-4 tracking-wider">GitHub</h2>
        <TokenSetup onAuthenticated={(u) => { setUser(u); setHasToken(true); }} />
      </div>
    );
  }

  // --- Detail views ---
  if (selectedPR) {
    return (
      <div className="flex flex-col h-full p-4 overflow-hidden">
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <button onClick={() => setSelectedPR(null)} className="p-1 hover:bg-white/10 rounded">
            <ChevronLeft size={16} className="text-[var(--text-secondary)]" />
          </button>
          <GitPullRequest size={14} className="text-[var(--success)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">#{selectedPR.number} {selectedPR.title}</span>
          <button onClick={() => openExternal(selectedPR.html_url)} className="ml-auto p-1 hover:bg-white/10 rounded" title="Open in browser">
            <ExternalLink size={12} className="text-[var(--text-muted)]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 text-xs">
          {/* Meta */}
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${selectedPR.state === 'open' ? 'bg-[var(--success)]/20 text-[var(--success)]' : selectedPR.state === 'draft' ? 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]' : 'bg-[var(--error)]/20 text-[var(--error)]'}`}>
              {selectedPR.state === 'draft' ? 'Draft' : selectedPR.state}
            </span>
            <span>{selectedPR.user.login}</span>
            <span>&middot;</span>
            <span>{selectedPR.head.ref} &rarr; {selectedPR.base.ref}</span>
          </div>
          {selectedPR.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedPR.labels.map(l => <Label key={l.name} name={l.name} color={l.color} />)}
            </div>
          )}
          {/* Body */}
          {selectedPR.body && (
            <div className="bg-[var(--bg-tertiary)] rounded p-3 text-[var(--text-secondary)] whitespace-pre-wrap break-words">
              {selectedPR.body}
            </div>
          )}
          {/* Changed files */}
          {prFiles.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">
                Changed Files ({prFiles.length})
              </h4>
              <div className="space-y-0.5">
                {prFiles.map(f => (
                  <div key={f.filename} className="flex items-center gap-2 py-0.5 text-[var(--text-secondary)]">
                    <span className="text-[var(--success)] text-[10px]">+{f.additions}</span>
                    <span className="text-[var(--error)] text-[10px]">-{f.deletions}</span>
                    <span className="truncate">{f.filename}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Comments */}
          <div>
            <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">
              Comments ({comments.length})
            </h4>
            {comments.map(c => (
              <div key={c.id} className="bg-[var(--bg-tertiary)] rounded p-2 mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-[var(--text-primary)]">{c.user.login}</span>
                  <span className="text-[var(--text-muted)]">{timeAgo(c.created_at)}</span>
                </div>
                <div className="text-[var(--text-secondary)] whitespace-pre-wrap break-words">{c.body}</div>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-muted)]"
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddComment(selectedPR.number)}
              />
              <button
                onClick={() => handleAddComment(selectedPR.number)}
                disabled={submittingComment || !newComment.trim()}
                className="bg-[var(--accent-primary)] text-[var(--text-primary)] px-2 py-1.5 rounded text-xs disabled:opacity-50 hover:opacity-90"
              >
                {submittingComment ? <Loader2 size={12} className="animate-spin" /> : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedIssue) {
    return (
      <div className="flex flex-col h-full p-4 overflow-hidden">
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <button onClick={() => setSelectedIssue(null)} className="p-1 hover:bg-white/10 rounded">
            <ChevronLeft size={16} className="text-[var(--text-secondary)]" />
          </button>
          <CircleDot size={14} className={selectedIssue.state === 'open' ? 'text-[var(--success)]' : 'text-[var(--error)]'} />
          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">#{selectedIssue.number} {selectedIssue.title}</span>
          <button onClick={() => openExternal(selectedIssue.html_url)} className="ml-auto p-1 hover:bg-white/10 rounded" title="Open in browser">
            <ExternalLink size={12} className="text-[var(--text-muted)]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 text-xs">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${selectedIssue.state === 'open' ? 'bg-[var(--success)]/20 text-[var(--success)]' : 'bg-[var(--error)]/20 text-[var(--error)]'}`}>
              {selectedIssue.state}
            </span>
            <span>{selectedIssue.user.login}</span>
            <span>&middot;</span>
            <span>{timeAgo(selectedIssue.created_at)}</span>
          </div>
          {selectedIssue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedIssue.labels.map(l => <Label key={l.name} name={l.name} color={l.color} />)}
            </div>
          )}
          {selectedIssue.assignees.length > 0 && (
            <div className="flex items-center gap-1 text-[var(--text-muted)]">
              <span>Assignees:</span>
              {selectedIssue.assignees.map(a => (
                <span key={a.login} className="text-[var(--text-secondary)]">{a.login}</span>
              ))}
            </div>
          )}
          {selectedIssue.body && (
            <div className="bg-[var(--bg-tertiary)] rounded p-3 text-[var(--text-secondary)] whitespace-pre-wrap break-words">
              {selectedIssue.body}
            </div>
          )}
          {/* Comments */}
          <div>
            <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">
              Comments ({comments.length})
            </h4>
            {comments.map(c => (
              <div key={c.id} className="bg-[var(--bg-tertiary)] rounded p-2 mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-[var(--text-primary)]">{c.user.login}</span>
                  <span className="text-[var(--text-muted)]">{timeAgo(c.created_at)}</span>
                </div>
                <div className="text-[var(--text-secondary)] whitespace-pre-wrap break-words">{c.body}</div>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-muted)]"
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddComment(selectedIssue.number)}
              />
              <button
                onClick={() => handleAddComment(selectedIssue.number)}
                disabled={submittingComment || !newComment.trim()}
                className="bg-[var(--accent-primary)] text-[var(--text-primary)] px-2 py-1.5 rounded text-xs disabled:opacity-50 hover:opacity-90"
              >
                {submittingComment ? <Loader2 size={12} className="animate-spin" /> : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Main list view ---
  const tabs: { id: Tab; icon: typeof GitPullRequest; label: string }[] = [
    { id: 'prs', icon: GitPullRequest, label: 'PRs' },
    { id: 'issues', icon: CircleDot, label: 'Issues' },
    { id: 'notifs', icon: Bell, label: 'Notifs' },
    { id: 'actions', icon: Zap, label: 'Actions' },
    { id: 'branches', icon: GitBranch, label: 'Branches' },
  ];

  const unreadCount = notifications.filter(n => n.unread).length;

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">GitHub</h2>
        <div className="flex items-center gap-1">
          <button onClick={fetchTabData} className="p-1 hover:bg-white/10 rounded" title="Refresh">
            <RefreshCw size={14} className={`text-[var(--text-muted)] ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className="p-1 hover:bg-white/10 rounded" title="Settings">
            <Settings size={14} className="text-[var(--text-muted)]" />
          </button>
        </div>
      </div>

      {/* Settings dropdown */}
      {showSettings && (
        <div className="mb-3 p-3 bg-[var(--bg-tertiary)] rounded space-y-2 shrink-0">
          {user && (
            <div className="flex items-center gap-2 text-xs">
              <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full" />
              <span className="text-[var(--text-primary)] font-medium">{user.login}</span>
              {user.name && <span className="text-[var(--text-muted)]">({user.name})</span>}
            </div>
          )}
          {owner && repo && rootPath && (
            <button
              onClick={handleSetAsRemote}
              className="text-[10px] text-[var(--accent-primary)] hover:underline block"
            >
              Set {owner}/{repo} as remote
            </button>
          )}
          <button
            onClick={handleDisconnect}
            className="text-[10px] text-[var(--error)] hover:underline"
          >
            Disconnect
          </button>
        </div>
      )}

      {/* Repo selector */}
      <div className="mb-3 shrink-0 relative" ref={repoPickerRef}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowRepoPicker(!showRepoPicker);
              if (!showRepoPicker) loadUserRepos();
            }}
            className="flex items-center gap-1.5 text-xs min-w-0 flex-1 hover:bg-white/5 rounded px-1.5 py-1 transition-colors"
          >
            <Github size={12} className="text-[var(--text-muted)] shrink-0" />
            {owner && repo ? (
              <span className="text-[var(--text-secondary)] font-medium truncate">{owner}/{repo}</span>
            ) : (
              <span className="text-[var(--text-muted)]">Select repository...</span>
            )}
            <ChevronDown size={12} className="text-[var(--text-muted)] shrink-0" />
          </button>
          <button
            onClick={() => { setShowClone(!showClone); }}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded transition-colors shrink-0"
            title="Clone"
          >
            <FolderDown size={14} />
          </button>
          {rootPath && (
            <button
              onClick={() => setShowCreateBranch(!showCreateBranch)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded transition-colors shrink-0"
              title="Create new branch"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        {repoError && !owner && (
          <div className="text-[10px] text-[var(--warning)] mt-1">{repoError}</div>
        )}

        {/* Repo picker overlay */}
        {showRepoPicker && (
          <div className="absolute left-0 right-0 top-[34px] z-50 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md shadow-lg max-h-[360px] flex flex-col overflow-hidden">
            {/* Search */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-secondary)]">
              <Search size={12} className="text-[var(--text-muted)] shrink-0" />
              <input
                value={repoSearchQuery}
                onChange={(e) => setRepoSearchQuery(e.target.value)}
                placeholder="Search repositories..."
                className="flex-1 bg-transparent text-xs text-[var(--text-primary)] focus:outline-none placeholder-[var(--text-muted)]"
                autoFocus
              />
              {repoSearchQuery && (
                <button onClick={() => setRepoSearchQuery('')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Manual entry */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-secondary)]">
              <input
                value={manualRepoInput}
                onChange={(e) => setManualRepoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualRepo()}
                placeholder="owner/repo"
                className="flex-1 bg-transparent text-xs text-[var(--text-primary)] focus:outline-none placeholder-[var(--text-muted)]"
              />
              <button
                onClick={handleManualRepo}
                disabled={!manualRepoInput.includes('/')}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-primary)] text-[var(--text-primary)] disabled:opacity-40 hover:opacity-90"
              >
                Go
              </button>
            </div>

            <div className="overflow-y-auto">
              {/* Search results */}
              {repoSearchQuery && repoSearchResults.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase px-2 py-1 tracking-wider">Search Results</div>
                  {repoSearchResults.map((r) => (
                    <RepoRow key={r.full_name} repo={r} onSelect={selectRepo} />
                  ))}
                </div>
              )}

              {/* User repos */}
              {!repoSearchQuery && (
                <div>
                  <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase px-2 py-1 tracking-wider">Your Repositories</div>
                  {loadingRepos && (
                    <div className="flex justify-center py-3">
                      <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
                    </div>
                  )}
                  {!loadingRepos && userRepos.map((r) => (
                    <RepoRow key={r.full_name} repo={r} onSelect={selectRepo} />
                  ))}
                  {!loadingRepos && userRepos.length === 0 && (
                    <div className="text-xs text-[var(--text-muted)] text-center py-3">No repositories found</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Push / Pull bar — always visible when repo is connected */}
      {rootPath && (
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <button
            onClick={handlePush}
            disabled={isPushing}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-md bg-[var(--accent-primary)] text-[var(--text-primary)] hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {isPushing ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
            Push
          </button>
          <button
            onClick={handlePull}
            disabled={isPulling}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors"
          >
            {isPulling ? <Loader2 size={14} className="animate-spin" /> : <ArrowDown size={14} />}
            Pull
          </button>
        </div>
      )}

      {/* Sync result banner */}
      {syncResult && (
        <div className={`mb-3 px-2 py-1 rounded text-[10px] shrink-0 ${syncResult.includes('failed') ? 'bg-[var(--error)]/10 border border-[var(--error)]/20 text-[var(--error)]' : 'bg-[var(--success)]/10 border border-[var(--success)]/20 text-[var(--success)]'}`}>
          {syncResult}
        </div>
      )}

      {/* Clone section */}
      {showClone && (
        <div className="mb-3 p-3 bg-[var(--bg-tertiary)] rounded space-y-2 shrink-0">
          <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Clone Repository</div>
          <input
            value={cloneUrl}
            onChange={(e) => setCloneUrl(e.target.value)}
            placeholder="https://github.com/owner/repo.git"
            className="w-full bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-muted)]"
          />
          <input
            value={cloneTarget}
            onChange={(e) => setCloneTarget(e.target.value)}
            placeholder="Target directory (e.g., C:\Projects\my-repo)"
            className="w-full bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-muted)]"
          />
          <div className="flex gap-2">
            <button
              onClick={handleClone}
              disabled={isCloning || !cloneUrl.trim() || !cloneTarget.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded bg-[var(--accent-primary)] text-[var(--text-primary)] hover:opacity-90 disabled:opacity-40"
            >
              {isCloning ? <Loader2 size={11} className="animate-spin" /> : <FolderDown size={11} />}
              {isCloning ? 'Cloning...' : 'Clone'}
            </button>
            <button
              onClick={() => { setShowClone(false); setCloneResult(null); }}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2"
            >
              Cancel
            </button>
          </div>
          {cloneResult && (
            <div className={`text-[10px] ${cloneResult.startsWith('Clone failed') ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}>
              {cloneResult}
            </div>
          )}
        </div>
      )}

      {/* Create branch inline */}
      {showCreateBranch && (
        <div className="flex items-center gap-1.5 mb-3 shrink-0">
          <GitBranch size={12} className="text-[var(--text-muted)] shrink-0" />
          <input
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateBranch()}
            placeholder="New branch name..."
            className="flex-1 bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-muted)]"
            autoFocus
          />
          <button
            onClick={handleCreateBranch}
            disabled={!newBranchName.trim() || isCreatingBranch}
            className="px-2.5 py-1.5 text-[10px] font-medium rounded bg-[var(--accent-primary)] text-[var(--text-primary)] hover:opacity-90 disabled:opacity-40"
          >
            {isCreatingBranch ? <Loader2 size={11} className="animate-spin" /> : 'Create'}
          </button>
          <button
            onClick={() => { setShowCreateBranch(false); setNewBranchName(''); }}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Branch / sync result banner */}
      {branchResult && (
        <div className={`mb-3 px-2 py-1 rounded text-[10px] shrink-0 ${branchResult.includes('failed') ? 'bg-[var(--error)]/10 border border-[var(--error)]/20 text-[var(--error)]' : 'bg-[var(--success)]/10 border border-[var(--success)]/20 text-[var(--success)]'}`}>
          {branchResult}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-0.5 mb-3 shrink-0 bg-[var(--bg-tertiary)] rounded p-0.5">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1 text-[10px] font-medium py-1.5 rounded transition-colors relative ${
              activeTab === id
                ? 'bg-[var(--bg-primary)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon size={12} />
            {label}
            {id === 'notifs' && unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-[var(--accent-primary)] text-[var(--text-primary)] text-[8px] w-3.5 h-3.5 rounded-full flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin text-[var(--accent-primary)]" />
          </div>
        )}

        {/* ---- PRs Tab ---- */}
        {activeTab === 'prs' && !loading && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setPrFilter('open')}
                className={`text-[10px] px-2 py-0.5 rounded ${prFilter === 'open' ? 'bg-[var(--accent-primary)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-white/5'}`}
              >
                Open
              </button>
              <button
                onClick={() => setPrFilter('closed')}
                className={`text-[10px] px-2 py-0.5 rounded ${prFilter === 'closed' ? 'bg-[var(--accent-primary)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-white/5'}`}
              >
                Closed
              </button>
            </div>
            {prs.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center py-4">No pull requests</p>}
            {prs.map(pr => (
              <button
                key={pr.number}
                onClick={() => openPRDetail(pr)}
                className="w-full text-left p-2 hover:bg-white/5 rounded group"
              >
                <div className="flex items-start gap-2">
                  <GitPullRequest size={14} className={`mt-0.5 shrink-0 ${pr.state === 'open' ? 'text-[var(--success)]' : pr.state === 'draft' ? 'text-[var(--text-muted)]' : 'text-[var(--error)]'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--text-primary)] font-medium truncate">{pr.title}</div>
                    <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                      <span>#{pr.number}</span>
                      <span>{pr.user.login}</span>
                      <span>{timeAgo(pr.updated_at)}</span>
                    </div>
                    {pr.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {pr.labels.slice(0, 3).map(l => <Label key={l.name} name={l.name} color={l.color} />)}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ---- Issues Tab ---- */}
        {activeTab === 'issues' && !loading && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setIssueFilter('open')}
                className={`text-[10px] px-2 py-0.5 rounded ${issueFilter === 'open' ? 'bg-[var(--accent-primary)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-white/5'}`}
              >
                Open
              </button>
              <button
                onClick={() => setIssueFilter('closed')}
                className={`text-[10px] px-2 py-0.5 rounded ${issueFilter === 'closed' ? 'bg-[var(--accent-primary)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-white/5'}`}
              >
                Closed
              </button>
            </div>
            {issues.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center py-4">No issues</p>}
            {issues.map(issue => (
              <button
                key={issue.number}
                onClick={() => openIssueDetail(issue)}
                className="w-full text-left p-2 hover:bg-white/5 rounded"
              >
                <div className="flex items-start gap-2">
                  <CircleDot size={14} className={`mt-0.5 shrink-0 ${issue.state === 'open' ? 'text-[var(--success)]' : 'text-[var(--error)]'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--text-primary)] font-medium truncate">{issue.title}</div>
                    <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                      <span>#{issue.number}</span>
                      <span>{issue.user.login}</span>
                      <span>{timeAgo(issue.updated_at)}</span>
                      {issue.comments > 0 && (
                        <span className="flex items-center gap-0.5">
                          <MessageSquare size={10} /> {issue.comments}
                        </span>
                      )}
                    </div>
                    {issue.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {issue.labels.slice(0, 3).map(l => <Label key={l.name} name={l.name} color={l.color} />)}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ---- Notifications Tab ---- */}
        {activeTab === 'notifs' && !loading && (
          <div className="space-y-1">
            {notifications.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center py-4">No notifications</p>}
            {notifications.map(n => (
              <div
                key={n.id}
                className={`p-2 rounded text-xs ${n.unread ? 'bg-[var(--accent-primary)]/5' : 'hover:bg-white/5'}`}
              >
                <div className="flex items-start gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.unread ? 'bg-[var(--accent-primary)]' : 'bg-transparent'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[var(--text-primary)] font-medium truncate">{n.subject.title}</div>
                    <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                      <span>{n.repository.full_name}</span>
                      <span>{n.subject.type}</span>
                      <span>{timeAgo(n.updated_at)}</span>
                    </div>
                  </div>
                  {n.unread && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="p-1 hover:bg-white/10 rounded shrink-0"
                      title="Mark as read"
                    >
                      <Check size={12} className="text-[var(--text-muted)]" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---- Actions Tab ---- */}
        {activeTab === 'actions' && !loading && (
          <div className="space-y-1">
            {runs.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center py-4">No workflow runs</p>}
            {runs.map(run => (
              <button
                key={run.id}
                onClick={() => openExternal(run.html_url)}
                className="w-full text-left p-2 hover:bg-white/5 rounded"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">{runStatusIcon(run.status, run.conclusion)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--text-primary)] font-medium truncate">{run.name}</div>
                    <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                      <span>{run.head_branch}</span>
                      <span>{run.event}</span>
                      <span>{timeAgo(run.created_at)}</span>
                    </div>
                  </div>
                  <ExternalLink size={10} className="text-[var(--text-muted)] mt-1 shrink-0 opacity-0 group-hover:opacity-100" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ---- Branches Tab ---- */}
        {activeTab === 'branches' && !loading && (
          <div className="space-y-1">
            {ghBranches.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center py-4">No branches</p>}
            {ghBranches.map(branch => (
              <div
                key={branch.name}
                className="flex items-center gap-2 p-2 hover:bg-white/5 rounded text-xs"
              >
                <GitBranch size={14} className="text-[var(--text-muted)] shrink-0" />
                <span className="text-[var(--text-primary)] font-medium truncate flex-1">{branch.name}</span>
                {branch.protected && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--warning)]/20 text-[var(--warning)] shrink-0">
                    protected
                  </span>
                )}
                <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">{branch.sha}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// RepoRow sub-component
// ============================================================

function RepoRow({ repo, onSelect }: { repo: RepoEntry; onSelect: (r: RepoEntry) => void }) {
  return (
    <button
      onClick={() => onSelect(repo)}
      className="w-full text-left px-2 py-1.5 hover:bg-white/5 transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-primary)] font-medium truncate flex-1">{repo.full_name}</span>
        {repo.private && <Lock size={10} className="text-[var(--warning)] shrink-0" />}
        {repo.stargazers_count > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-[var(--text-muted)] shrink-0">
            <Star size={9} /> {repo.stargazers_count}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        {repo.language && <span className="text-[9px] text-[var(--accent-primary)]">{repo.language}</span>}
        {repo.description && (
          <span className="text-[10px] text-[var(--text-muted)] truncate">{repo.description}</span>
        )}
      </div>
    </button>
  );
}

export default GitHubPane;
