/**
 * Remote File Watcher
 *
 * Poll-based file change detection over SSH.
 * Uses `find` + `stat` to detect modifications, then notifies the renderer
 * so FileExplorer can refresh.
 *
 * No `fs.watch` equivalent exists over SSH, so we poll at a configurable interval.
 */

import { BrowserWindow } from 'electron';
import { getSSHManager } from './connection';
import { getActiveRemoteConnection } from './router';

interface FileSnapshot {
  path: string;
  mtime: number;
  size: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5000; // 5 seconds

export class RemoteFileWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot = new Map<string, FileSnapshot>();
  private watchRoot: string | null = null;
  private pollInterval: number;

  constructor(pollInterval = DEFAULT_POLL_INTERVAL_MS) {
    this.pollInterval = pollInterval;
  }

  /**
   * Start watching a remote directory for changes.
   */
  start(remoteRoot: string): void {
    this.stop();
    this.watchRoot = remoteRoot;
    this.lastSnapshot.clear();

    // Do an initial snapshot immediately
    this.poll();

    this.timer = setInterval(() => this.poll(), this.pollInterval);
  }

  /**
   * Stop watching.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.watchRoot = null;
    this.lastSnapshot.clear();
  }

  /**
   * Check if the watcher is active.
   */
  isActive(): boolean {
    return this.timer !== null;
  }

  /**
   * Set the poll interval (takes effect on next start).
   */
  setPollInterval(ms: number): void {
    this.pollInterval = Math.max(2000, ms); // minimum 2 seconds
  }

  /**
   * Poll the remote filesystem for changes.
   */
  private async poll(): Promise<void> {
    const connId = getActiveRemoteConnection();
    if (!connId || !this.watchRoot) return;

    const manager = getSSHManager();

    try {
      // Get file listing with mtime and size (depth 2 for performance)
      const result = await manager.exec(
        connId,
        `find . -maxdepth 2 -type f -printf '%T@ %s %p\\n' 2>/dev/null | head -500`,
        this.watchRoot
      );

      if (result.code !== 0 || !result.stdout.trim()) return;

      const currentFiles = new Map<string, FileSnapshot>();
      const lines = result.stdout.trim().split('\n');

      for (const line of lines) {
        const match = line.match(/^(\d+\.?\d*)\s+(\d+)\s+(.+)$/);
        if (!match) continue;
        const mtime = parseFloat(match[1]);
        const size = parseInt(match[2], 10);
        const filePath = match[3];
        currentFiles.set(filePath, { path: filePath, mtime, size });
      }

      // Compare with last snapshot
      if (this.lastSnapshot.size === 0) {
        // First poll — just store the snapshot, no events
        this.lastSnapshot = currentFiles;
        return;
      }

      const changed: string[] = [];
      const added: string[] = [];
      const deleted: string[] = [];

      // Check for new/changed files
      for (const [filePath, current] of currentFiles) {
        const previous = this.lastSnapshot.get(filePath);
        if (!previous) {
          added.push(filePath);
        } else if (current.mtime !== previous.mtime || current.size !== previous.size) {
          changed.push(filePath);
        }
      }

      // Check for deleted files
      for (const filePath of this.lastSnapshot.keys()) {
        if (!currentFiles.has(filePath)) {
          deleted.push(filePath);
        }
      }

      this.lastSnapshot = currentFiles;

      // Notify renderer if anything changed
      if (changed.length > 0 || added.length > 0 || deleted.length > 0) {
        const wins = BrowserWindow.getAllWindows();
        for (const win of wins) {
          win.webContents.send('remote:files-changed', {
            root: this.watchRoot,
            changed,
            added,
            deleted,
          });
        }
      }
    } catch (err) {
      // Silently ignore poll errors (connection might be temporarily unavailable)
      console.warn('[RemoteFileWatcher] poll error:', (err as Error).message);
    }
  }
}

/** Singleton */
let watcher: RemoteFileWatcher | null = null;

export function getRemoteFileWatcher(): RemoteFileWatcher {
  if (!watcher) {
    watcher = new RemoteFileWatcher();
  }
  return watcher;
}
