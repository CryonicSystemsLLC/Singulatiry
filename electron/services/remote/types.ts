/**
 * Remote SSH connection types
 */

export type AuthMethod = 'password' | 'privateKey' | 'agent';

export interface RemoteConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  /** Path to private key file (for privateKey auth) */
  privateKeyPath?: string;
  /** Default directory to open on the remote machine */
  defaultDirectory?: string;
  /** Remote OS detected after connection (linux/darwin) */
  remoteOS?: string;
}

export interface RemoteConnectionState {
  id: string;
  config: RemoteConnectionConfig;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error?: string;
  remoteOS?: string;
}

export interface RemoteFileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
  size?: number;
  modifiedAt?: number;
}

export interface RemoteExecResult {
  stdout: string;
  stderr: string;
  code: number;
}
