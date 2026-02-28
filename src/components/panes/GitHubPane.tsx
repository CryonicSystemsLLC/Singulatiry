import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Github, RefreshCw, Settings, Loader2, GitPullRequest,
  CircleDot, Bell, Zap, ChevronLeft, MessageSquare,
  Check, X, ExternalLink,
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

type Tab = 'prs' | 'issues' | 'notifs' | 'actions';

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
          <button
            onClick={handleDisconnect}
            className="text-[10px] text-[var(--error)] hover:underline"
          >
            Disconnect
          </button>
        </div>
      )}

      {/* Repo info */}
      {owner && repo ? (
        <div className="text-xs text-[var(--text-muted)] mb-3 shrink-0 flex items-center gap-1">
          <Github size={12} />
          <span className="text-[var(--text-secondary)] font-medium">{owner}/{repo}</span>
        </div>
      ) : repoError ? (
        <div className="text-xs text-[var(--warning)] mb-3 shrink-0">{repoError}</div>
      ) : null}

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
      </div>
    </div>
  );
};

export default GitHubPane;
