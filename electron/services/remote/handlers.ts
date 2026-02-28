/**
 * Remote SSH IPC handlers.
 *
 * Registers IPC channels for remote connection management:
 *   remote:connect, remote:disconnect, remote:get-state, remote:list-states,
 *   remote:save-config, remote:list-configs, remote:delete-config
 *
 * SSH credentials (passwords/passphrases) are stored via SecureKeyStorage (keychain.ts).
 */

import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { getSSHManager } from './connection';
import { setActiveRemoteConnection, getActiveRemoteConnection } from './router';
import { destroyRemoteTerminal } from './terminal-remote';
import { getKeyStorage } from '../keychain';
import { getRemoteFileWatcher } from './file-watcher';
import { RemoteConnectionConfig } from './types';

const store = new Store({ name: 'remote-connections' });

function getSavedConfigs(): RemoteConnectionConfig[] {
  return store.get('connections', []) as RemoteConnectionConfig[];
}

function setSavedConfigs(configs: RemoteConnectionConfig[]): void {
  store.set('connections', configs);
}

/** Key name for storing SSH credentials in SecureKeyStorage */
function sshCredentialKey(connId: string): string {
  return `ssh:${connId}`;
}

/**
 * Register all remote IPC handlers.
 */
export function registerRemoteHandlers(): void {
  const manager = getSSHManager();
  const keyStorage = getKeyStorage();

  // Forward connection state changes to renderer
  manager.on('state-change', (state) => {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      win.webContents.send('remote:state-change', state);
    }
  });

  // ─── Connection Lifecycle ───────────────────────────────────

  ipcMain.handle('remote:connect', async (_, config: RemoteConnectionConfig, password?: string) => {
    try {
      // If no password provided, try to retrieve from SecureKeyStorage
      let credential = password;
      if (!credential && config.authMethod !== 'agent') {
        const stored = await keyStorage.getKey(sshCredentialKey(config.id));
        if (stored) credential = stored;
      }

      const state = await manager.connect(config, credential);
      setActiveRemoteConnection(config.id);

      // Store credential for future reconnects / sessions
      if (password && config.authMethod !== 'agent') {
        await keyStorage.setKey(sshCredentialKey(config.id), password);
      }

      // Start remote file watcher on the default directory
      if (config.defaultDirectory) {
        getRemoteFileWatcher().start(config.defaultDirectory);
      }

      return { success: true, state };
    } catch (errState: any) {
      return { success: false, state: errState, error: errState.error || 'Connection failed' };
    }
  });

  ipcMain.handle('remote:disconnect', async (_, connId?: string) => {
    const id = connId || getActiveRemoteConnection();
    if (!id) return { success: false, error: 'No active connection' };

    getRemoteFileWatcher().stop();
    destroyRemoteTerminal();
    await manager.disconnect(id);

    if (getActiveRemoteConnection() === id) {
      setActiveRemoteConnection(null);
    }
    return { success: true };
  });

  ipcMain.handle('remote:get-state', (_, connId?: string) => {
    const id = connId || getActiveRemoteConnection();
    if (!id) return null;
    return manager.getState(id);
  });

  ipcMain.handle('remote:list-states', () => {
    return manager.getAllStates();
  });

  ipcMain.handle('remote:get-active', () => {
    return getActiveRemoteConnection();
  });

  ipcMain.handle('remote:set-active', (_, connId: string | null) => {
    setActiveRemoteConnection(connId);
    return { success: true };
  });

  // ─── Saved Configurations ──────────────────────────────────

  ipcMain.handle('remote:save-config', (_, config: RemoteConnectionConfig) => {
    const configs = getSavedConfigs();
    const idx = configs.findIndex(c => c.id === config.id);
    if (idx >= 0) {
      configs[idx] = config;
    } else {
      configs.push(config);
    }
    setSavedConfigs(configs);
    return { success: true };
  });

  ipcMain.handle('remote:list-configs', () => {
    return getSavedConfigs();
  });

  ipcMain.handle('remote:delete-config', async (_, configId: string) => {
    const configs = getSavedConfigs().filter(c => c.id !== configId);
    setSavedConfigs(configs);
    // Also remove stored credential
    await keyStorage.deleteKey(sshCredentialKey(configId));
    return { success: true };
  });

  // ─── Credential management ─────────────────────────────────

  ipcMain.handle('remote:has-credential', async (_, connId: string) => {
    return keyStorage.hasKey(sshCredentialKey(connId));
  });

  ipcMain.handle('remote:clear-credential', async (_, connId: string) => {
    await keyStorage.deleteKey(sshCredentialKey(connId));
    return { success: true };
  });

  // ─── File Watcher ───────────────────────────────────────────

  ipcMain.handle('remote:watch-start', (_, remotePath: string) => {
    getRemoteFileWatcher().start(remotePath);
    return { success: true };
  });

  ipcMain.handle('remote:watch-stop', () => {
    getRemoteFileWatcher().stop();
    return { success: true };
  });
}
