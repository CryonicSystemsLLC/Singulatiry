/**
 * Terminal IPC Handlers
 *
 * Local shell spawning and remote terminal routing.
 * Extracted from main.ts.
 */

import os from 'node:os';
import { spawn } from 'node:child_process';
import { ipcMain, BrowserWindow } from 'electron';
import {
  isRemoteActive,
  getActiveRemoteConnection,
  createRemoteTerminal,
  writeRemoteTerminal,
  hasRemoteTerminal,
} from '../remote';

let terminalProcess: any = null;

export function getTerminalProcess() {
  return terminalProcess;
}

export function killTerminalProcess() {
  if (terminalProcess) {
    try { terminalProcess.kill(); } catch { /* already dead */ }
    terminalProcess = null;
  }
}

export function registerTerminalHandlers(getWin: () => BrowserWindow | null) {
  ipcMain.handle('terminal:create', async () => {
    if (isRemoteActive()) {
      return createRemoteTerminal(getActiveRemoteConnection()!, getWin());
    }

    killTerminalProcess();

    const termShell =
      process.platform === 'win32' ? 'cmd.exe' :
      process.platform === 'darwin' ? '/bin/zsh' :
      '/bin/bash';
    const args = process.platform === 'win32' ? ['/Q'] : [];

    try {
      terminalProcess = spawn(termShell, args, {
        cwd: os.homedir() || process.cwd(),
        env: process.env,
        shell: false,
      });

      terminalProcess.stdout.on('data', (data: any) => {
        getWin()?.webContents.send('terminal:incoming', data.toString());
      });

      terminalProcess.stderr.on('data', (data: any) => {
        getWin()?.webContents.send('terminal:incoming', data.toString());
      });

      terminalProcess.on('error', (err: any) => {
        console.error('[Terminal] Spawn error:', err);
        getWin()?.webContents.send('terminal:incoming', `\r\nError launching shell: ${err.message}`);
      });

      terminalProcess.on('exit', (code: number) => {
        getWin()?.webContents.send('terminal:incoming', `\r\nSession Ended (Code: ${code})`);
        terminalProcess = null;
      });

      return true;
    } catch (e: any) {
      console.error('[Terminal] Failed to spawn:', e);
      return false;
    }
  });

  ipcMain.on('terminal:write', (_: any, data: any) => {
    if (isRemoteActive() && hasRemoteTerminal()) {
      const sanitized = typeof data === 'string' ? data.replace(/\0/g, '') : data;
      writeRemoteTerminal(sanitized);
      return;
    }

    if (terminalProcess?.stdin) {
      const sanitized = typeof data === 'string'
        ? data.replace(/\0/g, '').replace(/\x1b\[[\d;]*[a-zA-Z]/g, (m: string) => m)
        : data;
      terminalProcess.stdin.write(sanitized);
    }
  });
}
