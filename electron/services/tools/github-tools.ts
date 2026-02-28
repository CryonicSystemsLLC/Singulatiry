/**
 * GitHub Tools - GitHub REST API integration via IPC handlers
 * Uses Node.js fetch + PAT stored in SecureKeyStorage
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getKeyStorage } from '../keychain';

const execFileAsync = promisify(execFile);

const GITHUB_API = 'https://api.github.com';
const GITHUB_PROVIDER = 'github';

// ============================================================
// Types
// ============================================================

interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
  html_url: string;
}

interface GitHubPR {
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
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  labels: { name: string; color: string }[];
}

interface GitHubIssue {
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

interface GitHubComment {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  created_at: string;
  html_url: string;
}

interface GitHubNotification {
  id: string;
  unread: boolean;
  reason: string;
  subject: { title: string; type: string; url: string | null };
  repository: { full_name: string };
  updated_at: string;
}

interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_branch: string;
  head_sha: string;
  created_at: string;
  updated_at: string;
  event: string;
}

interface GitHubChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

// ============================================================
// Helpers
// ============================================================

async function getToken(): Promise<string | null> {
  const storage = getKeyStorage();
  return storage.getKey(GITHUB_PROVIDER);
}

async function githubFetch(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<any> {
  const token = options.token !== undefined ? options.token : await getToken();
  if (!token) {
    throw new Error('GitHub token not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (resp.status === 401) throw new Error('Invalid or expired GitHub token');
    if (resp.status === 403) {
      const remaining = resp.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const resetAt = resp.headers.get('x-ratelimit-reset');
        const resetDate = resetAt ? new Date(parseInt(resetAt) * 1000).toLocaleTimeString() : 'soon';
        throw new Error(`GitHub rate limit exceeded. Resets at ${resetDate}`);
      }
      throw new Error('GitHub access forbidden');
    }
    if (resp.status === 404) throw new Error('GitHub resource not found');
    if (!resp.ok) throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);

    if (resp.status === 204) return null;
    return resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

function mapPR(pr: any): GitHubPR {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.draft ? 'draft' : pr.state,
    user: { login: pr.user.login, avatar_url: pr.user.avatar_url },
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    html_url: pr.html_url,
    body: pr.body,
    draft: pr.draft || false,
    head: { ref: pr.head.ref, sha: pr.head.sha },
    base: { ref: pr.base.ref },
    mergeable_state: pr.mergeable_state,
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changed_files,
    labels: (pr.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
  };
}

function mapIssue(issue: any): GitHubIssue {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    user: { login: issue.user.login, avatar_url: issue.user.avatar_url },
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    html_url: issue.html_url,
    body: issue.body,
    labels: (issue.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
    assignees: (issue.assignees || []).map((a: any) => ({ login: a.login, avatar_url: a.avatar_url })),
    comments: issue.comments || 0,
  };
}

function mapComment(c: any): GitHubComment {
  return {
    id: c.id,
    user: { login: c.user.login, avatar_url: c.user.avatar_url },
    body: c.body,
    created_at: c.created_at,
    html_url: c.html_url,
  };
}

function mapNotification(n: any): GitHubNotification {
  return {
    id: n.id,
    unread: n.unread,
    reason: n.reason,
    subject: { title: n.subject.title, type: n.subject.type, url: n.subject.url },
    repository: { full_name: n.repository.full_name },
    updated_at: n.updated_at,
  };
}

function mapWorkflowRun(r: any): GitHubWorkflowRun {
  return {
    id: r.id,
    name: r.name || r.display_title,
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    head_branch: r.head_branch,
    head_sha: r.head_sha,
    created_at: r.created_at,
    updated_at: r.updated_at,
    event: r.event,
  };
}

/**
 * Detect GitHub remote from a local git repository
 */
async function detectGitHubRemote(cwd: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      timeout: 5000,
      windowsHide: true,
    });
    const url = stdout.trim();

    // SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = url.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// IPC Handlers
// ============================================================

export const githubIpcHandlers: Record<string, (...args: any[]) => Promise<any>> = {
  // --- Token management ---
  'github:has-token': async (): Promise<boolean> => {
    const token = await getToken();
    return token !== null && token.length > 0;
  },

  'github:set-token': async (_event: any, token: string): Promise<void> => {
    const storage = getKeyStorage();
    await storage.setKey(GITHUB_PROVIDER, token);
  },

  'github:remove-token': async (): Promise<void> => {
    const storage = getKeyStorage();
    await storage.deleteKey(GITHUB_PROVIDER);
  },

  'github:validate-token': async (_event: any, token?: string): Promise<GitHubUser> => {
    const t = token || (await getToken());
    const user = await githubFetch('/user', { token: t });
    return {
      login: user.login,
      avatar_url: user.avatar_url,
      name: user.name,
      html_url: user.html_url,
    };
  },

  // --- Repository detection ---
  'github:detect-remote': async (_event: any, cwd: string): Promise<{ owner: string; repo: string } | null> => {
    return detectGitHubRemote(cwd);
  },

  'github:repo-info': async (_event: any, owner: string, repo: string): Promise<any> => {
    const data = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    return {
      full_name: data.full_name,
      description: data.description,
      private: data.private,
      default_branch: data.default_branch,
      stargazers_count: data.stargazers_count,
      open_issues_count: data.open_issues_count,
      html_url: data.html_url,
    };
  },

  // --- Pull Requests ---
  'github:list-prs': async (
    _event: any,
    owner: string,
    repo: string,
    state: string = 'open'
  ): Promise<GitHubPR[]> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&per_page=30&sort=updated&direction=desc`
    );
    return data.map(mapPR);
  },

  'github:get-pr': async (
    _event: any,
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubPR> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`
    );
    return mapPR(data);
  },

  'github:create-pr': async (
    _event: any,
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body?: string
  ): Promise<GitHubPR> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      { method: 'POST', body: { title, head, base, body: body || '' } }
    );
    return mapPR(data);
  },

  'github:pr-files': async (
    _event: any,
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubChangedFile[]> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=100`
    );
    return data.map((f: any) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
    }));
  },

  // --- Issues ---
  'github:list-issues': async (
    _event: any,
    owner: string,
    repo: string,
    state: string = 'open'
  ): Promise<GitHubIssue[]> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${state}&per_page=30&sort=updated&direction=desc`
    );
    // Filter out pull requests (GitHub API returns PRs as issues too)
    return data.filter((i: any) => !i.pull_request).map(mapIssue);
  },

  'github:get-issue': async (
    _event: any,
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubIssue> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`
    );
    return mapIssue(data);
  },

  'github:create-issue': async (
    _event: any,
    owner: string,
    repo: string,
    title: string,
    body?: string,
    labels?: string[]
  ): Promise<GitHubIssue> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      { method: 'POST', body: { title, body: body || '', labels: labels || [] } }
    );
    return mapIssue(data);
  },

  // --- Comments ---
  'github:issue-comments': async (
    _event: any,
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubComment[]> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments?per_page=50`
    );
    return data.map(mapComment);
  },

  'github:add-comment': async (
    _event: any,
    owner: string,
    repo: string,
    number: number,
    body: string
  ): Promise<GitHubComment> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`,
      { method: 'POST', body: { body } }
    );
    return mapComment(data);
  },

  // --- Notifications ---
  'github:notifications': async (): Promise<GitHubNotification[]> => {
    const data = await githubFetch('/notifications?per_page=30');
    return data.map(mapNotification);
  },

  'github:mark-notification-read': async (_event: any, threadId: string): Promise<void> => {
    await githubFetch(`/notifications/threads/${threadId}`, { method: 'PATCH' });
  },

  // --- Actions ---
  'github:list-runs': async (
    _event: any,
    owner: string,
    repo: string
  ): Promise<GitHubWorkflowRun[]> => {
    const data = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=20`
    );
    return (data.workflow_runs || []).map(mapWorkflowRun);
  },
};
