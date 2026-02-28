/**
 * Remote terminal via SSH shell channel.
 * Creates a duplex stream that pipes to/from the renderer process.
 */

import { ClientChannel } from 'ssh2';
import { BrowserWindow } from 'electron';
import { getSSHManager } from './connection';

let remoteShellChannel: ClientChannel | null = null;

/**
 * Create a remote terminal shell session.
 * Returns true on success.
 */
export async function createRemoteTerminal(connId: string, win: BrowserWindow | null): Promise<boolean> {
  try {
    // Close existing remote shell if any
    destroyRemoteTerminal();

    const manager = getSSHManager();
    const channel = await manager.createShell(connId);
    remoteShellChannel = channel;

    channel.on('data', (data: Buffer) => {
      win?.webContents.send('terminal:incoming', data.toString());
    });

    channel.stderr.on('data', (data: Buffer) => {
      win?.webContents.send('terminal:incoming', data.toString());
    });

    channel.on('close', () => {
      win?.webContents.send('terminal:incoming', '\r\nRemote session ended.\r\n');
      remoteShellChannel = null;
    });

    return true;
  } catch (e: any) {
    console.error('Failed to create remote terminal:', e);
    return false;
  }
}

/**
 * Write data to the remote terminal shell.
 */
export function writeRemoteTerminal(data: string): void {
  if (remoteShellChannel && remoteShellChannel.writable) {
    remoteShellChannel.write(data);
  }
}

/**
 * Check if a remote shell is currently active.
 */
export function hasRemoteTerminal(): boolean {
  return remoteShellChannel !== null;
}

/**
 * Destroy the remote terminal shell.
 */
export function destroyRemoteTerminal(): void {
  if (remoteShellChannel) {
    try { remoteShellChannel.close(); } catch { /* ignore */ }
    remoteShellChannel = null;
  }
}
