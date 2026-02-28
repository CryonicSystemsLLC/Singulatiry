/**
 * Remote Explorer Pane
 *
 * Sidebar pane for managing SSH connections:
 * - List saved connections
 * - Connect / disconnect
 * - Status indicator
 * - Add new connection
 */

import React, { useEffect, useState } from 'react';
import { useRemoteStore, RemoteConnectionConfig } from '../../stores/remoteStore';
import { useAppStore } from '../../stores/appStore';
import RemoteConnectionDialog from '../RemoteConnectionDialog';
import {
  Plus, Server, Plug, Unplug, Trash2, Edit, Wifi, WifiOff, Loader2,
} from 'lucide-react';

interface RemotePaneProps {
  rootPath: string | null;
  onRootChange: (path: string) => void;
}

const RemotePane: React.FC<RemotePaneProps> = ({ onRootChange }) => {
  const {
    activeConnectionId,
    connectionState,
    savedConnections,
    isConnecting,
    connect,
    disconnect,
    loadSavedConnections,
    saveConnection,
    deleteConnection,
  } = useRemoteStore();

  const setProjectRoot = useAppStore(s => s.setProjectRoot);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editConfig, setEditConfig] = useState<RemoteConnectionConfig | null>(null);

  useEffect(() => {
    loadSavedConnections();
  }, [loadSavedConnections]);

  const handleConnect = async (config: RemoteConnectionConfig, password?: string) => {
    setDialogOpen(false);
    const success = await connect(config, password);
    if (success) {
      // Switch project root to remote default directory
      const dir = config.defaultDirectory || `/home/${config.username}`;
      setProjectRoot(dir);
      onRootChange(dir);
      // Auto-save the connection config
      saveConnection(config);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
  };

  const handleEdit = (config: RemoteConnectionConfig) => {
    setEditConfig(config);
    setDialogOpen(true);
  };

  const handleNewConnection = () => {
    setEditConfig(null);
    setDialogOpen(true);
  };

  const handleQuickConnect = async (config: RemoteConnectionConfig) => {
    if (config.authMethod === 'agent') {
      // Agent auth doesn't need password
      const success = await connect(config);
      if (success) {
        const dir = config.defaultDirectory || `/home/${config.username}`;
        setProjectRoot(dir);
        onRootChange(dir);
      }
      return;
    }

    // Check if credential is already stored in SecureKeyStorage
    try {
      const hasCredential = await window.ipcRenderer.invoke('remote:has-credential', config.id);
      if (hasCredential) {
        // Auto-connect using stored credential (no password needed from user)
        const success = await connect(config);
        if (success) {
          const dir = config.defaultDirectory || `/home/${config.username}`;
          setProjectRoot(dir);
          onRootChange(dir);
          return;
        }
      }
    } catch { /* fall through to dialog */ }

    // No stored credential — open dialog for password entry
    setEditConfig(config);
    setDialogOpen(true);
  };

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)]">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Remote Explorer
        </span>
        <button
          onClick={handleNewConnection}
          className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="New Connection"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Active Connection Banner */}
      {connectionState && connectionState.status === 'connected' && (
        <div className="mx-3 mt-3 p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi size={12} className="text-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">Connected</span>
            </div>
            <button
              onClick={handleDisconnect}
              className="p-1 text-emerald-400/60 hover:text-red-400 transition-colors"
              title="Disconnect"
            >
              <Unplug size={12} />
            </button>
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-1">
            {connectionState.config.username}@{connectionState.config.host}
          </div>
          {connectionState.remoteOS && (
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
              OS: {connectionState.remoteOS}
            </div>
          )}
        </div>
      )}

      {/* Connecting state */}
      {isConnecting && (
        <div className="mx-3 mt-3 p-2.5 rounded-md bg-blue-500/10 border border-blue-500/30">
          <div className="flex items-center gap-2">
            <Loader2 size={12} className="text-blue-400 animate-spin" />
            <span className="text-xs text-blue-400">Connecting...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {connectionState && connectionState.status === 'error' && (
        <div className="mx-3 mt-3 p-2.5 rounded-md bg-red-500/10 border border-red-500/30">
          <div className="flex items-center gap-2">
            <WifiOff size={12} className="text-red-400" />
            <span className="text-xs text-red-400">Connection Failed</span>
          </div>
          <div className="text-[10px] text-red-300/70 mt-1">{connectionState.error}</div>
        </div>
      )}

      {/* Saved Connections */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 mt-1">
          Saved Connections
        </div>

        {savedConnections.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] text-center py-6">
            No saved connections.
            <br />
            Click + to add one.
          </div>
        )}

        {savedConnections.map((config) => {
          const isActive = activeConnectionId === config.id;
          return (
            <div
              key={config.id}
              className={`group flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                isActive
                  ? 'bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/30'
                  : 'hover:bg-[var(--bg-hover)] border border-transparent'
              }`}
              onClick={() => !isActive && !isConnecting && handleQuickConnect(config)}
            >
              <Server size={14} className={isActive ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                  {config.name || `${config.username}@${config.host}`}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] truncate">
                  {config.host}:{config.port}
                </div>
              </div>
              <div className="hidden group-hover:flex items-center gap-1">
                {!isActive && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleQuickConnect(config); }}
                    className="p-1 text-[var(--text-muted)] hover:text-emerald-400 transition-colors"
                    title="Connect"
                  >
                    <Plug size={11} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleEdit(config); }}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Edit"
                >
                  <Edit size={11} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConnection(config.id); }}
                  className="p-1 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Connection Dialog */}
      <RemoteConnectionDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConnect={handleConnect}
        onSave={saveConnection}
        editConfig={editConfig}
      />
    </div>
  );
};

export default RemotePane;
