/**
 * Terminal IPC Handlers
 *
 * Uses node-pty for real pseudoterminal support on all platforms.
 * - Windows: PowerShell via ConPTY
 * - macOS: zsh (or user's $SHELL) via PTY
 * - Linux: bash (or user's $SHELL) via PTY
 */

import os from 'node:os';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ipcMain, BrowserWindow } from 'electron';
import {
  isRemoteActive,
  getActiveRemoteConnection,
  createRemoteTerminal,
  writeRemoteTerminal,
  hasRemoteTerminal,
} from '../remote';

// node-pty is a native module — use createRequire because the project is ESM
const _require = createRequire(import.meta.url);
let pty: typeof import('node-pty');
try {
  pty = _require('node-pty');
} catch (e) {
  console.error('[Terminal] Failed to load node-pty:', e);
}

let terminalProcess: import('node-pty').IPty | null = null;

export function getTerminalProcess() {
  return terminalProcess;
}

export function killTerminalProcess() {
  if (terminalProcess) {
    try { terminalProcess.kill(); } catch { /* already dead */ }
    terminalProcess = null;
  }
}

/**
 * Detect the best shell for the current platform.
 * Returns { shell, args, env } ready for node-pty.spawn().
 */
function getShellConfig(): { shell: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {};
  // Copy process.env, filtering out undefined values (node-pty needs string values)
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }

  if (process.platform === 'win32') {
    // Windows: use PowerShell
    return {
      shell: 'powershell.exe',
      args: ['-NoLogo'],
      env,
    };
  }

  if (process.platform === 'darwin') {
    // macOS: prefer user's $SHELL, then zsh, then bash
    const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'];
    const shell = candidates.find(s => s && existsSync(s)) || '/bin/zsh';

    // Electron on macOS may launch with a sparse PATH — ensure common dirs are included
    const currentPath = env.PATH || '';
    const extraDirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
    const missing = extraDirs.filter(d => !currentPath.includes(d));
    if (missing.length > 0) {
      env.PATH = currentPath + ':' + missing.join(':');
    }

    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';

    return { shell, args: ['--login'], env };
  }

  // Linux: prefer user's $SHELL, then bash, then sh
  const candidates = [process.env.SHELL, '/bin/bash', '/usr/bin/bash', '/bin/zsh', '/bin/sh'];
  const shell = candidates.find(s => s && existsSync(s)) || '/bin/sh';

  const currentPath = env.PATH || '';
  const extraDirs = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const missing = extraDirs.filter(d => !currentPath.includes(d));
  if (missing.length > 0) {
    env.PATH = currentPath + ':' + missing.join(':');
  }

  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';

  return { shell, args: ['--login'], env };
}

export function registerTerminalHandlers(getWin: () => BrowserWindow | null) {
  ipcMain.handle('terminal:create', async (_event, cols?: number, rows?: number) => {
    if (isRemoteActive()) {
      return createRemoteTerminal(getActiveRemoteConnection()!, getWin());
    }

    killTerminalProcess();

    if (!pty) {
      console.error('[Terminal] node-pty not available');
      return false;
    }

    const { shell, args, env } = getShellConfig();
    const cwd = os.homedir() || process.cwd();

    console.log(`[Terminal] Spawning ${shell} on ${process.platform} (${cols || 80}x${rows || 24})`);

    try {
      terminalProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd,
        env,
      });

      terminalProcess.onData((data: string) => {
        getWin()?.webContents.send('terminal:incoming', data);
      });

      terminalProcess.onExit(({ exitCode }: { exitCode: number }) => {
        getWin()?.webContents.send('terminal:incoming', `\r\nSession Ended (Code: ${exitCode})\r\n`);
        terminalProcess = null;
      });

      return true;
    } catch (e: any) {
      console.error('[Terminal] Failed to spawn PTY:', e);
      return false;
    }
  });

  // Resize the PTY when xterm.js resizes
  ipcMain.on('terminal:resize', (_: any, cols: number, rows: number) => {
    if (terminalProcess && cols > 0 && rows > 0) {
      try {
        terminalProcess.resize(cols, rows);
      } catch {
        // Ignore resize errors on dead processes
      }
    }
  });

  ipcMain.on('terminal:write', (_: any, data: any) => {
    if (isRemoteActive() && hasRemoteTerminal()) {
      const sanitized = typeof data === 'string' ? data.replace(/\0/g, '') : data;
      writeRemoteTerminal(sanitized);
      return;
    }

    if (terminalProcess) {
      terminalProcess.write(typeof data === 'string' ? data : data.toString());
    }
  });
}
