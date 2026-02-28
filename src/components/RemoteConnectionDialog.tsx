/**
 * Remote Connection Dialog
 *
 * Modal for configuring SSH connection parameters:
 * host, port, username, auth method, private key path, default directory.
 */

import React, { useState, useEffect } from 'react';
import { X, Server, Key, Lock, UserCheck } from 'lucide-react';
import type { RemoteConnectionConfig, AuthMethod } from '../stores/remoteStore';

interface RemoteConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: RemoteConnectionConfig, password?: string) => void;
  onSave: (config: RemoteConnectionConfig) => void;
  editConfig?: RemoteConnectionConfig | null;
}

const RemoteConnectionDialog: React.FC<RemoteConnectionDialogProps> = ({
  isOpen,
  onClose,
  onConnect,
  onSave,
  editConfig,
}) => {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [defaultDirectory, setDefaultDirectory] = useState('');

  useEffect(() => {
    if (editConfig) {
      setName(editConfig.name);
      setHost(editConfig.host);
      setPort(editConfig.port);
      setUsername(editConfig.username);
      setAuthMethod(editConfig.authMethod);
      setPrivateKeyPath(editConfig.privateKeyPath || '');
      setDefaultDirectory(editConfig.defaultDirectory || '');
    } else {
      setName('');
      setHost('');
      setPort(22);
      setUsername('');
      setAuthMethod('password');
      setPassword('');
      setPrivateKeyPath('');
      setDefaultDirectory('');
    }
  }, [editConfig, isOpen]);

  if (!isOpen) return null;

  const buildConfig = (): RemoteConnectionConfig => ({
    id: editConfig?.id || `ssh-${Date.now()}`,
    name: name || `${username}@${host}`,
    host,
    port,
    username,
    authMethod,
    privateKeyPath: authMethod === 'privateKey' ? privateKeyPath : undefined,
    defaultDirectory: defaultDirectory || undefined,
  });

  const isValid = host.trim() && username.trim();

  const handleConnect = () => {
    if (!isValid) return;
    const config = buildConfig();
    onConnect(config, password || undefined);
  };

  const handleSave = () => {
    if (!isValid) return;
    onSave(buildConfig());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[480px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-secondary)]">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-[var(--accent-primary)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {editConfig ? 'Edit Connection' : 'New SSH Connection'}
            </span>
          </div>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Connection Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Server"
              className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          {/* Host + Port */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-[var(--text-muted)] mb-1">Host</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100"
                className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs text-[var(--text-muted)] mb-1">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 22)}
                className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
              className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          {/* Auth Method */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Authentication</label>
            <div className="flex gap-2">
              {([
                { id: 'password' as AuthMethod, label: 'Password', icon: Lock },
                { id: 'privateKey' as AuthMethod, label: 'SSH Key', icon: Key },
                { id: 'agent' as AuthMethod, label: 'SSH Agent', icon: UserCheck },
              ]).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setAuthMethod(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors ${
                    authMethod === id
                      ? 'bg-[var(--accent-primary)]/20 border-[var(--accent-primary)] text-[var(--accent-primary)]'
                      : 'bg-[var(--bg-tertiary)] border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Password / Passphrase */}
          {(authMethod === 'password' || authMethod === 'privateKey') && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                {authMethod === 'password' ? 'Password' : 'Passphrase (optional)'}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={authMethod === 'password' ? 'Enter password' : 'Key passphrase (if any)'}
                className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}

          {/* Private Key Path */}
          {authMethod === 'privateKey' && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Private Key Path</label>
              <input
                type="text"
                value={privateKeyPath}
                onChange={(e) => setPrivateKeyPath(e.target.value)}
                placeholder="~/.ssh/id_rsa"
                className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}

          {/* Default Directory */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Default Directory</label>
            <input
              type="text"
              value={defaultDirectory}
              onChange={(e) => setDefaultDirectory(e.target.value)}
              placeholder="/home/user/project"
              className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-secondary)]">
          <button
            onClick={handleSave}
            disabled={!isValid}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors"
          >
            Save
          </button>
          <button
            onClick={handleConnect}
            disabled={!isValid}
            className="px-4 py-1.5 text-xs font-medium rounded bg-[var(--accent-primary)] text-white hover:brightness-110 disabled:opacity-40 transition-colors"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
};

export default RemoteConnectionDialog;
