/**
 * Remote git operations via SSH exec.
 * Mirrors the local git-tools IPC responses using exec('git ...') on the remote.
 */

import { getSSHManager } from './connection';

export interface RemoteGitStatus {
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface RemoteGitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Get git status from remote repository.
 */
export async function remoteGitStatus(connId: string, cwd: string): Promise<RemoteGitStatus> {
  const manager = getSSHManager();
  const result = await manager.exec(connId, 'git status --porcelain -b', cwd);

  const lines = result.stdout.trim().split('\n').filter(Boolean);
  let branch = '';
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  let ahead = 0;
  let behind = 0;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      branch = line.substring(3);
      const trackMatch = branch.match(/\[ahead (\d+)(?:, behind (\d+))?\]/);
      const behindMatch = branch.match(/\[behind (\d+)\]/);
      if (trackMatch) {
        ahead = parseInt(trackMatch[1], 10);
        behind = trackMatch[2] ? parseInt(trackMatch[2], 10) : 0;
      }
      if (behindMatch) {
        behind = parseInt(behindMatch[1], 10);
      }
      branch = branch.split('...')[0];
      continue;
    }
    const indexStatus = line[0];
    const workStatus = line[1];
    const file = line.substring(3);

    if (indexStatus === '?' && workStatus === '?') {
      untracked.push(file);
    } else {
      if (indexStatus && indexStatus !== ' ' && indexStatus !== '?') staged.push(file);
      if (workStatus && workStatus !== ' ' && workStatus !== '?') modified.push(file);
    }
  }

  return { branch, staged, modified, untracked, ahead, behind };
}

/**
 * Get git log from remote repository.
 */
export async function remoteGitLog(
  connId: string,
  cwd: string,
  count: number = 50
): Promise<RemoteGitLogEntry[]> {
  const manager = getSSHManager();
  const sep = '|||';
  const result = await manager.exec(
    connId,
    `git log --pretty=format:"%H${sep}%h${sep}%s${sep}%an${sep}%ai" -n ${count}`,
    cwd
  );

  if (result.code !== 0 || !result.stdout.trim()) return [];

  return result.stdout.trim().split('\n').filter(Boolean).map(line => {
    const [hash, shortHash, message, author, date] = line.split(sep);
    return { hash, shortHash, message, author, date };
  });
}

/**
 * Stage files on remote.
 */
export async function remoteGitStage(connId: string, cwd: string, files: string[]): Promise<void> {
  const manager = getSSHManager();
  const escaped = files.map(f => `"${f.replace(/"/g, '\\"')}"`).join(' ');
  const result = await manager.exec(connId, `git add ${escaped}`, cwd);
  if (result.code !== 0) throw new Error(result.stderr || 'git add failed');
}

/**
 * Unstage files on remote.
 */
export async function remoteGitUnstage(connId: string, cwd: string, files: string[]): Promise<void> {
  const manager = getSSHManager();
  const escaped = files.map(f => `"${f.replace(/"/g, '\\"')}"`).join(' ');
  const result = await manager.exec(connId, `git reset HEAD ${escaped}`, cwd);
  if (result.code !== 0) throw new Error(result.stderr || 'git reset failed');
}

/**
 * Commit on remote.
 */
export async function remoteGitCommit(connId: string, cwd: string, message: string): Promise<string> {
  const manager = getSSHManager();
  const escaped = message.replace(/"/g, '\\"');
  const result = await manager.exec(connId, `git commit -m "${escaped}"`, cwd);
  if (result.code !== 0) throw new Error(result.stderr || 'git commit failed');
  return result.stdout;
}

/**
 * Get diff on remote.
 */
export async function remoteGitDiff(connId: string, cwd: string, file?: string, staged?: boolean): Promise<string> {
  const manager = getSSHManager();
  let cmd = 'git diff';
  if (staged) cmd += ' --cached';
  if (file) cmd += ` -- "${file.replace(/"/g, '\\"')}"`;
  const result = await manager.exec(connId, cmd, cwd);
  return result.stdout;
}
