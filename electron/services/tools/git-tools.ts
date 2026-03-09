/**
 * Git Tools - Version control operations for the agent and IPC handlers
 * Uses child_process.execFile for safety (no shell injection)
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Tool, ToolResult, defineTool } from './registry';

const execFileAsync = promisify(execFile);

/**
 * Build a PATH string that includes common git binary locations.
 * On Windows, Git for Windows may not be on PATH when Electron launches from a shortcut.
 * On macOS, /usr/local/bin (Homebrew) and Xcode CLI paths may be missing.
 * On Linux, git is usually at /usr/bin but we add common extras just in case.
 */
function getGitEnv(): NodeJS.ProcessEnv {
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const currentPath = process.env.PATH || process.env.Path || '';
  const extraDirs: string[] = [];

  if (process.platform === 'win32') {
    const winGitDirs = [
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\Git\\bin',
      'C:\\Program Files\\Git\\mingw64\\bin',
      'C:\\Program Files (x86)\\Git\\cmd',
    ];
    for (const d of winGitDirs) {
      if (!currentPath.includes(d) && existsSync(d)) extraDirs.push(d);
    }
  } else if (process.platform === 'darwin') {
    const macDirs = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'];
    for (const d of macDirs) {
      if (!currentPath.includes(d)) extraDirs.push(d);
    }
  } else {
    const linuxDirs = ['/usr/bin', '/usr/local/bin'];
    for (const d of linuxDirs) {
      if (!currentPath.includes(d)) extraDirs.push(d);
    }
  }

  const newPath = extraDirs.length > 0
    ? extraDirs.join(pathSep) + pathSep + currentPath
    : currentPath;

  return { ...process.env, PATH: newPath };
}

/**
 * Helper: run a git command safely using execFile
 */
async function runGit(args: string[], cwd: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024, // 10MB
    windowsHide: true,
    env: getGitEnv(),
  });
}

// ============================================================
// Agent Tools (registered in the ToolRegistry)
// ============================================================

/**
 * git_status - Get working tree status
 */
export const gitStatusTool = defineTool<{ showBranch?: boolean }>(
  'git_status',
  'Get the current git working tree status including branch info, staged changes, unstaged changes, and untracked files.',
  {
    type: 'object',
    properties: {
      showBranch: {
        type: 'boolean',
        description: 'Include branch tracking info (default: true)',
        default: true,
      },
    },
  },
  async (_params, context): Promise<ToolResult> => {
    try {
      const { stdout } = await runGit(
        ['status', '--porcelain', '-b'],
        context.projectRoot,
      );

      const lines = stdout.trim().split('\n').filter(Boolean);
      let branch = '';
      const staged: string[] = [];
      const modified: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        if (line.startsWith('## ')) {
          branch = line.substring(3);
          continue;
        }

        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.substring(3);

        if (indexStatus === '?' && workTreeStatus === '?') {
          untracked.push(filePath);
        } else {
          if (indexStatus !== ' ' && indexStatus !== '?') {
            staged.push(`${indexStatus} ${filePath}`);
          }
          if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
            modified.push(`${workTreeStatus} ${filePath}`);
          }
        }
      }

      return {
        success: true,
        data: {
          branch,
          staged,
          modified,
          untracked,
          clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
          raw: stdout,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Git status failed: ${error.message}`,
          code: 'GIT_STATUS_ERROR',
          recoverable: true,
        },
      };
    }
  },
);

/**
 * git_diff - Get diff of changes
 */
export const gitDiffTool = defineTool<{ staged?: boolean; file?: string }>(
  'git_diff',
  'Get the diff of working tree changes. Use staged=true to see staged changes, or provide a specific file path.',
  {
    type: 'object',
    properties: {
      staged: {
        type: 'boolean',
        description: 'Show staged (cached) changes instead of unstaged (default: false)',
        default: false,
      },
      file: {
        type: 'string',
        description: 'Specific file to diff (optional)',
      },
    },
  },
  async (params, context): Promise<ToolResult> => {
    try {
      const args = ['diff'];
      if (params.staged) {
        args.push('--staged');
      }
      if (params.file) {
        args.push('--', params.file);
      }

      const { stdout } = await runGit(args, context.projectRoot);

      return {
        success: true,
        data: {
          diff: stdout,
          staged: !!params.staged,
          file: params.file || null,
          empty: stdout.trim().length === 0,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Git diff failed: ${error.message}`,
          code: 'GIT_DIFF_ERROR',
          recoverable: true,
        },
      };
    }
  },
);

/**
 * git_commit - Commit staged changes
 */
export const gitCommitTool = defineTool<{ message: string }>(
  'git_commit',
  'Commit currently staged changes with the provided commit message.',
  {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The commit message',
      },
    },
    required: ['message'],
  },
  async (params, context): Promise<ToolResult> => {
    if (!params.message || params.message.trim().length === 0) {
      return {
        success: false,
        error: {
          message: 'Commit message cannot be empty',
          code: 'INVALID_INPUT',
          recoverable: true,
        },
      };
    }

    try {
      const { stdout } = await runGit(
        ['commit', '-m', params.message],
        context.projectRoot,
      );

      // Extract commit hash from output
      const hashMatch = stdout.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
      const commitHash = hashMatch ? hashMatch[1] : null;

      return {
        success: true,
        data: {
          hash: commitHash,
          message: params.message,
          output: stdout.trim(),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Git commit failed: ${error.stderr || error.message}`,
          code: 'GIT_COMMIT_ERROR',
          recoverable: true,
        },
      };
    }
  },
);

/**
 * git_log - Get commit log
 */
export const gitLogTool = defineTool<{ count?: number; format?: string }>(
  'git_log',
  'Get recent commit log entries. Returns oneline format by default.',
  {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of commits to show (default: 20)',
        default: 20,
      },
      format: {
        type: 'string',
        description: 'Log format: "oneline", "short", or "full" (default: "oneline")',
        default: 'oneline',
        enum: ['oneline', 'short', 'full'],
      },
    },
  },
  async (params, context): Promise<ToolResult> => {
    try {
      const count = Math.min(Math.max(params.count || 20, 1), 100);
      const args = ['log', `--oneline`, `-n`, String(count)];

      if (params.format === 'short') {
        args[1] = '--format=short';
      } else if (params.format === 'full') {
        args[1] = '--format=fuller';
      }

      const { stdout } = await runGit(args, context.projectRoot);

      const entries = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const spaceIdx = line.indexOf(' ');
          return {
            hash: spaceIdx > 0 ? line.substring(0, spaceIdx) : line,
            message: spaceIdx > 0 ? line.substring(spaceIdx + 1) : '',
          };
        });

      return {
        success: true,
        data: {
          entries,
          count: entries.length,
          raw: stdout,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Git log failed: ${error.message}`,
          code: 'GIT_LOG_ERROR',
          recoverable: true,
        },
      };
    }
  },
);

/**
 * git_branch - List or create branches
 */
export const gitBranchTool = defineTool<{ create?: string; delete?: string; all?: boolean }>(
  'git_branch',
  'List branches, create a new branch, or delete an existing branch.',
  {
    type: 'object',
    properties: {
      create: {
        type: 'string',
        description: 'Name of new branch to create (optional)',
      },
      delete: {
        type: 'string',
        description: 'Name of branch to delete (optional)',
      },
      all: {
        type: 'boolean',
        description: 'Show remote branches too (default: false)',
        default: false,
      },
    },
  },
  async (params, context): Promise<ToolResult> => {
    try {
      // Create branch
      if (params.create) {
        const name = params.create.trim();
        if (!/^[a-zA-Z0-9_\-/.]+$/.test(name)) {
          return {
            success: false,
            error: {
              message: 'Invalid branch name. Use only alphanumeric characters, hyphens, underscores, slashes, and dots.',
              code: 'INVALID_INPUT',
              recoverable: true,
            },
          };
        }
        const { stdout } = await runGit(['branch', name], context.projectRoot);
        return {
          success: true,
          data: { created: name, output: stdout.trim() },
        };
      }

      // Delete branch
      if (params.delete) {
        const name = params.delete.trim();
        const { stdout } = await runGit(['branch', '-d', name], context.projectRoot);
        return {
          success: true,
          data: { deleted: name, output: stdout.trim() },
        };
      }

      // List branches
      const args = ['branch'];
      if (params.all) {
        args.push('-a');
      }
      const { stdout } = await runGit(args, context.projectRoot);

      let current = '';
      const branches: string[] = [];

      for (const line of stdout.split('\n').filter(Boolean)) {
        const trimmed = line.trim();
        if (line.startsWith('* ')) {
          current = trimmed.substring(2);
          branches.push(current);
        } else {
          branches.push(trimmed);
        }
      }

      return {
        success: true,
        data: { current, branches },
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Git branch failed: ${error.stderr || error.message}`,
          code: 'GIT_BRANCH_ERROR',
          recoverable: true,
        },
      };
    }
  },
);

/**
 * git_checkout - Switch branches or restore files
 */
export const gitCheckoutTool = defineTool<{ branch: string; create?: boolean }>(
  'git_checkout',
  'Switch to a different branch. Optionally create a new branch with create=true.',
  {
    type: 'object',
    properties: {
      branch: {
        type: 'string',
        description: 'Branch name to switch to',
      },
      create: {
        type: 'boolean',
        description: 'Create the branch if it does not exist (default: false)',
        default: false,
      },
    },
    required: ['branch'],
  },
  async (params, context): Promise<ToolResult> => {
    const name = params.branch.trim();
    if (!name) {
      return {
        success: false,
        error: {
          message: 'Branch name cannot be empty',
          code: 'INVALID_INPUT',
          recoverable: true,
        },
      };
    }

    if (!/^[a-zA-Z0-9_\-/.]+$/.test(name)) {
      return {
        success: false,
        error: {
          message: 'Invalid branch name. Use only alphanumeric characters, hyphens, underscores, slashes, and dots.',
          code: 'INVALID_INPUT',
          recoverable: true,
        },
      };
    }

    try {
      const args = params.create
        ? ['checkout', '-b', name]
        : ['checkout', name];

      const { stdout, stderr } = await runGit(args, context.projectRoot);

      return {
        success: true,
        data: {
          branch: name,
          created: !!params.create,
          output: (stdout || stderr).trim(),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Git checkout failed: ${error.stderr || error.message}`,
          code: 'GIT_CHECKOUT_ERROR',
          recoverable: true,
        },
      };
    }
  },
);

/**
 * git_stash - Stash or pop changes
 */
export const gitStashTool = defineTool<{ action?: string; message?: string }>(
  'git_stash',
  'Stash or restore uncommitted changes. Actions: push (default), pop, list, drop.',
  {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Stash action: "push", "pop", "list", or "drop" (default: "push")',
        default: 'push',
        enum: ['push', 'pop', 'list', 'drop'],
      },
      message: {
        type: 'string',
        description: 'Optional message for stash push',
      },
    },
  },
  async (params, context): Promise<ToolResult> => {
    const action = params.action || 'push';

    try {
      let args: string[];

      switch (action) {
        case 'push': {
          args = ['stash', 'push'];
          if (params.message) {
            args.push('-m', params.message);
          }
          break;
        }
        case 'pop': {
          args = ['stash', 'pop'];
          break;
        }
        case 'list': {
          args = ['stash', 'list'];
          break;
        }
        case 'drop': {
          args = ['stash', 'drop'];
          break;
        }
        default: {
          return {
            success: false,
            error: {
              message: `Unknown stash action: ${action}. Use push, pop, list, or drop.`,
              code: 'INVALID_INPUT',
              recoverable: true,
            },
          };
        }
      }

      const { stdout, stderr } = await runGit(args, context.projectRoot);

      return {
        success: true,
        data: {
          action,
          output: (stdout || stderr).trim(),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Git stash ${action} failed: ${error.stderr || error.message}`,
          code: 'GIT_STASH_ERROR',
          recoverable: true,
        },
      };
    }
  },
);

// ============================================================
// All git tools for registry
// ============================================================

export const GIT_TOOLS: Tool[] = [
  gitStatusTool,
  gitDiffTool,
  gitCommitTool,
  gitLogTool,
  gitBranchTool,
  gitCheckoutTool,
  gitStashTool,
];

/**
 * Register all git tools to a registry
 */
export function registerGitTools(registry: { register: (tool: Tool) => void }): void {
  for (const tool of GIT_TOOLS) {
    registry.register(tool);
  }
}

// ============================================================
// IPC Handlers for renderer process
// ============================================================

export interface GitFileEntry {
  path: string;
  status: string;       // M, A, D, R, C, U, ?
  staged: boolean;
  statusLabel: string;   // Modified, Added, Deleted, etc.
}

function parseStatusCode(code: string): string {
  switch (code) {
    case 'M': return 'Modified';
    case 'A': return 'Added';
    case 'D': return 'Deleted';
    case 'R': return 'Renamed';
    case 'C': return 'Copied';
    case 'U': return 'Unmerged';
    case '?': return 'Untracked';
    default: return 'Unknown';
  }
}

export const gitIpcHandlers: Record<string, (...args: any[]) => Promise<any>> = {
  'git:status': async (_event: any, projectRoot: string) => {
    if (!projectRoot) {
      return { branch: '', files: [], error: 'No project root provided' };
    }

    try {
      const { stdout } = await runGit(['status', '--porcelain', '-b'], projectRoot);
      const lines = stdout.trim().split('\n').filter(Boolean);

      let branch = '';
      const files: GitFileEntry[] = [];

      for (const line of lines) {
        if (line.startsWith('## ')) {
          // Parse branch: "## main...origin/main" or "## main"
          const branchPart = line.substring(3);
          branch = branchPart.split('...')[0];
          continue;
        }

        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.substring(3);

        // Untracked
        if (indexStatus === '?' && workTreeStatus === '?') {
          files.push({
            path: filePath,
            status: '?',
            staged: false,
            statusLabel: 'Untracked',
          });
          continue;
        }

        // Staged changes (index has a status)
        if (indexStatus !== ' ' && indexStatus !== '?') {
          files.push({
            path: filePath,
            status: indexStatus,
            staged: true,
            statusLabel: parseStatusCode(indexStatus),
          });
        }

        // Unstaged working tree changes
        if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
          // Only add unstaged entry if we did not already add a staged entry for the same file
          // with the same status, or if the statuses differ
          const alreadyAdded = files.find(
            (f) => f.path === filePath && f.staged && f.status === workTreeStatus,
          );
          if (!alreadyAdded) {
            files.push({
              path: filePath,
              status: workTreeStatus,
              staged: false,
              statusLabel: parseStatusCode(workTreeStatus),
            });
          }
        }
      }

      return { branch, files };
    } catch (error: any) {
      return { branch: '', files: [], error: error.message };
    }
  },

  'git:diff': async (_event: any, projectRoot: string, staged?: boolean) => {
    if (!projectRoot) {
      return '';
    }

    try {
      const args = staged ? ['diff', '--staged'] : ['diff'];
      const { stdout } = await runGit(args, projectRoot);
      return stdout;
    } catch (error: any) {
      return '';
    }
  },

  'git:commit': async (_event: any, projectRoot: string, message: string) => {
    if (!projectRoot) {
      throw new Error('No project root provided');
    }
    if (!message || message.trim().length === 0) {
      throw new Error('Commit message cannot be empty');
    }

    try {
      const { stdout } = await runGit(['commit', '-m', message], projectRoot);
      // Extract hash: "[main abc1234] message"
      const hashMatch = stdout.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
      return hashMatch ? hashMatch[1] : stdout.trim();
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },

  'git:log': async (_event: any, projectRoot: string, count?: number) => {
    if (!projectRoot) {
      return [];
    }

    try {
      const n = Math.min(Math.max(count || 20, 1), 200);
      const { stdout } = await runGit(
        ['log', '--oneline', '-n', String(n)],
        projectRoot,
      );

      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const spaceIdx = line.indexOf(' ');
          return {
            hash: spaceIdx > 0 ? line.substring(0, spaceIdx) : line,
            message: spaceIdx > 0 ? line.substring(spaceIdx + 1) : '',
          };
        });
    } catch (error: any) {
      return [];
    }
  },

  'git:branch-list': async (_event: any, projectRoot: string) => {
    if (!projectRoot) {
      return { current: '', branches: [] };
    }

    try {
      const { stdout } = await runGit(['branch'], projectRoot);

      let current = '';
      const branches: string[] = [];

      for (const line of stdout.split('\n').filter(Boolean)) {
        const trimmed = line.trim();
        if (line.startsWith('* ')) {
          current = trimmed.substring(2);
          branches.push(current);
        } else {
          branches.push(trimmed);
        }
      }

      return { current, branches };
    } catch (error: any) {
      return { current: '', branches: [], error: error.message };
    }
  },

  'git:stage': async (_event: any, projectRoot: string, files: string[]) => {
    if (!projectRoot) {
      return { success: false, error: 'No project root provided' };
    }
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, error: 'No files provided' };
    }

    try {
      await runGit(['add', '--', ...files], projectRoot);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message };
    }
  },

  'git:unstage': async (_event: any, projectRoot: string, files: string[]) => {
    if (!projectRoot) {
      return { success: false, error: 'No project root provided' };
    }
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, error: 'No files provided' };
    }

    try {
      await runGit(['reset', 'HEAD', '--', ...files], projectRoot);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message };
    }
  },

  'git:push': async (_event: any, projectRoot: string, remote?: string, branch?: string, setUpstream?: boolean) => {
    if (!projectRoot) throw new Error('No project root provided');
    const args = ['push'];
    if (setUpstream) args.push('-u');
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    try {
      const { stdout, stderr } = await runGit(args, projectRoot, 60000);
      return { success: true, output: (stdout || stderr).trim() };
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },

  'git:pull': async (_event: any, projectRoot: string, remote?: string, branch?: string) => {
    if (!projectRoot) throw new Error('No project root provided');
    const args = ['pull'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    try {
      const { stdout, stderr } = await runGit(args, projectRoot, 60000);
      return { success: true, output: (stdout || stderr).trim() };
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },

  'git:fetch': async (_event: any, projectRoot: string, remote?: string) => {
    if (!projectRoot) throw new Error('No project root provided');
    const args = remote ? ['fetch', remote] : ['fetch', '--all', '--prune'];
    try {
      const { stdout, stderr } = await runGit(args, projectRoot, 60000);
      return { success: true, output: (stdout || stderr).trim() };
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },

  'git:remote-list': async (_event: any, projectRoot: string) => {
    if (!projectRoot) return [];
    try {
      const { stdout } = await runGit(['remote', '-v'], projectRoot);
      const remotes: { name: string; fetchUrl: string; pushUrl: string }[] = [];
      const seen = new Map<string, { fetchUrl: string; pushUrl: string }>();
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
        if (!match) continue;
        const [, name, url, type] = match;
        if (!seen.has(name)) seen.set(name, { fetchUrl: '', pushUrl: '' });
        const entry = seen.get(name)!;
        if (type === 'fetch') entry.fetchUrl = url;
        else entry.pushUrl = url;
      }
      for (const [name, urls] of seen) {
        remotes.push({ name, ...urls });
      }
      return remotes;
    } catch {
      return [];
    }
  },

  'git:remote-add': async (_event: any, projectRoot: string, name: string, url: string) => {
    if (!projectRoot) throw new Error('No project root provided');
    if (!name || !url) throw new Error('Remote name and URL are required');
    try {
      await runGit(['remote', 'add', name, url], projectRoot);
      return { success: true };
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },

  'git:remote-remove': async (_event: any, projectRoot: string, name: string) => {
    if (!projectRoot) throw new Error('No project root provided');
    if (!name) throw new Error('Remote name is required');
    try {
      await runGit(['remote', 'remove', name], projectRoot);
      return { success: true };
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },

  'git:checkout': async (_event: any, projectRoot: string, branch: string, create?: boolean) => {
    if (!projectRoot) throw new Error('No project root provided');
    if (!branch || !branch.trim()) throw new Error('Branch name is required');
    const name = branch.trim();
    if (!/^[a-zA-Z0-9_\-/.]+$/.test(name)) {
      throw new Error('Invalid branch name');
    }
    const args = create ? ['checkout', '-b', name] : ['checkout', name];
    try {
      const { stdout, stderr } = await runGit(args, projectRoot);
      return { success: true, branch: name, output: (stdout || stderr).trim() };
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },

  'git:branch-create': async (_event: any, projectRoot: string, name: string, checkout?: boolean) => {
    if (!projectRoot) throw new Error('No project root provided');
    if (!name || !name.trim()) throw new Error('Branch name is required');
    const branchName = name.trim();
    if (!/^[a-zA-Z0-9_\-/.]+$/.test(branchName)) {
      throw new Error('Invalid branch name');
    }
    try {
      if (checkout) {
        const { stdout, stderr } = await runGit(['checkout', '-b', branchName], projectRoot);
        return { success: true, branch: branchName, output: (stdout || stderr).trim() };
      }
      const { stdout } = await runGit(['branch', branchName], projectRoot);
      return { success: true, branch: branchName, output: stdout.trim() };
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },

  'git:branch-delete': async (_event: any, projectRoot: string, name: string, force?: boolean) => {
    if (!projectRoot) throw new Error('No project root provided');
    if (!name || !name.trim()) throw new Error('Branch name is required');
    const flag = force ? '-D' : '-d';
    try {
      const { stdout, stderr } = await runGit(['branch', flag, name.trim()], projectRoot);
      return { success: true, output: (stdout || stderr).trim() };
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },

  'git:branch-list-all': async (_event: any, projectRoot: string) => {
    if (!projectRoot) return { current: '', branches: [] };
    try {
      // Get current branch
      const { stdout: headOut } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot);
      const current = headOut.trim();

      // Get all branches with tracking info
      const { stdout } = await runGit(
        ['for-each-ref', '--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(objectname:short)', 'refs/heads/', 'refs/remotes/'],
        projectRoot,
      );

      interface BranchInfo {
        name: string;
        current: boolean;
        remote: boolean;
        upstream: string;
        ahead: number;
        behind: number;
        sha: string;
      }

      const branches: BranchInfo[] = [];
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const [name, upstream, track, sha] = line.split('\t');
        if (!name || name === 'HEAD' || name.endsWith('/HEAD')) continue;

        const isRemote = name.includes('/');
        let ahead = 0;
        let behind = 0;
        if (track) {
          const aheadMatch = track.match(/ahead (\d+)/);
          const behindMatch = track.match(/behind (\d+)/);
          if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
          if (behindMatch) behind = parseInt(behindMatch[1], 10);
        }

        branches.push({
          name,
          current: name === current,
          remote: isRemote,
          upstream: upstream || '',
          ahead,
          behind,
          sha: sha || '',
        });
      }

      return { current, branches };
    } catch (error: any) {
      return { current: '', branches: [], error: error.message };
    }
  },

  'git:clone': async (_event: any, url: string, targetDir: string) => {
    if (!url || !url.trim()) throw new Error('Clone URL is required');
    if (!targetDir || !targetDir.trim()) throw new Error('Target directory is required');
    try {
      const resolvedDir = path.resolve(targetDir.trim());
      const { stdout, stderr } = await runGit(['clone', url.trim(), resolvedDir], '.', 120000);
      return { success: true, path: resolvedDir, output: (stdout || stderr).trim() };
    } catch (error: any) {
      throw new Error(error.stderr || error.message);
    }
  },
};

export default GIT_TOOLS;
