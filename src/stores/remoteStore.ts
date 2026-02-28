/**
 * Remote SSH connection store (Zustand)
 */

import { create } from 'zustand';

export type AuthMethod = 'password' | 'privateKey' | 'agent';

export interface RemoteConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  defaultDirectory?: string;
  remoteOS?: string;
}

export interface RemoteConnectionState {
  id: string;
  config: RemoteConnectionConfig;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error?: string;
  remoteOS?: string;
}

interface RemoteStore {
  /** ID of the active remote connection, null = local mode */
  activeConnectionId: string | null;
  /** Current connection state */
  connectionState: RemoteConnectionState | null;
  /** Saved connection configs */
  savedConnections: RemoteConnectionConfig[];
  /** Loading state */
  isConnecting: boolean;

  connect: (config: RemoteConnectionConfig, password?: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  loadSavedConnections: () => Promise<void>;
  saveConnection: (config: RemoteConnectionConfig) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  setConnectionState: (state: RemoteConnectionState | null) => void;
}

export const useRemoteStore = create<RemoteStore>((set, get) => ({
  activeConnectionId: null,
  connectionState: null,
  savedConnections: [],
  isConnecting: false,

  connect: async (config, password) => {
    set({ isConnecting: true });
    try {
      const result = await window.ipcRenderer.invoke('remote:connect', config, password);
      if (result.success) {
        set({
          activeConnectionId: config.id,
          connectionState: result.state,
          isConnecting: false,
        });
        return true;
      } else {
        set({
          connectionState: result.state || null,
          isConnecting: false,
        });
        return false;
      }
    } catch (err) {
      set({ isConnecting: false });
      return false;
    }
  },

  disconnect: async () => {
    const { activeConnectionId } = get();
    if (activeConnectionId) {
      await window.ipcRenderer.invoke('remote:disconnect', activeConnectionId);
    }
    set({
      activeConnectionId: null,
      connectionState: null,
    });
  },

  loadSavedConnections: async () => {
    const configs = await window.ipcRenderer.invoke('remote:list-configs');
    set({ savedConnections: configs || [] });
  },

  saveConnection: async (config) => {
    await window.ipcRenderer.invoke('remote:save-config', config);
    await get().loadSavedConnections();
  },

  deleteConnection: async (id) => {
    await window.ipcRenderer.invoke('remote:delete-config', id);
    await get().loadSavedConnections();
  },

  setConnectionState: (state) => {
    set({ connectionState: state });
  },
}));

// Listen for state-change events from the main process (reconnection, etc.)
if (typeof window !== 'undefined' && window.ipcRenderer) {
  window.ipcRenderer.on('remote:state-change', (_event: any, state: RemoteConnectionState) => {
    const store = useRemoteStore.getState();
    if (store.activeConnectionId === state.id) {
      useRemoteStore.setState({ connectionState: state });
    }
  });

  // Listen for remote file change events and broadcast to subscribers
  window.ipcRenderer.on('remote:files-changed', (_event: any, data: {
    root: string;
    changed: string[];
    added: string[];
    deleted: string[];
  }) => {
    // Dispatch a custom event that FileExplorer can listen to
    window.dispatchEvent(new CustomEvent('remote-files-changed', { detail: data }));
  });
}
