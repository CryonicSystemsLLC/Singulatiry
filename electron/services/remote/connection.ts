/**
 * SSH Connection Manager
 *
 * Manages ssh2 Client lifecycle, SFTP subsystem, shell channels, and exec.
 * Credentials stored via SecureKeyStorage under ssh:{connId}:password / ssh:{connId}:passphrase.
 */

import { Client, SFTPWrapper, ClientChannel, ConnectConfig } from 'ssh2';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
  RemoteConnectionConfig,
  RemoteConnectionState,
  RemoteFileEntry,
  RemoteExecResult,
} from './types';

interface ManagedConnection {
  client: Client;
  sftp: SFTPWrapper;
  config: RemoteConnectionConfig;
  state: RemoteConnectionState;
  /** Stored password/passphrase for reconnection */
  password?: string;
  /** Whether we're currently attempting a reconnect */
  reconnecting: boolean;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 2000; // 2s, 4s, 8s exponential backoff

export class SSHConnectionManager extends EventEmitter {
  private connections = new Map<string, ManagedConnection>();

  constructor() {
    super();
  }

  /**
   * Build ssh2 ConnectConfig from our config + password.
   */
  private async buildConnectConfig(config: RemoteConnectionConfig, password?: string): Promise<ConnectConfig> {
    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 30000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
    };

    if (config.authMethod === 'password' && password) {
      connectConfig.password = password;
    } else if (config.authMethod === 'privateKey' && config.privateKeyPath) {
      const keyContent = await readFile(config.privateKeyPath, 'utf-8');
      connectConfig.privateKey = keyContent;
      if (password) {
        connectConfig.passphrase = password;
      }
    } else if (config.authMethod === 'agent') {
      connectConfig.agent = process.env.SSH_AUTH_SOCK;
    }

    return connectConfig;
  }

  /**
   * Connect to a remote host.
   * @param config Connection configuration
   * @param password Plain-text password or passphrase (retrieved from SecureKeyStorage by the caller)
   */
  async connect(config: RemoteConnectionConfig, password?: string): Promise<RemoteConnectionState> {
    // Disconnect existing connection with same id if any
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id);
    }

    const client = new Client();
    const connectConfig = await this.buildConnectConfig(config, password);

    const state: RemoteConnectionState = {
      id: config.id,
      config,
      status: 'connecting',
    };

    return new Promise<RemoteConnectionState>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        state.status = 'error';
        state.error = 'Connection timeout (30s)';
        reject(state);
      }, 30000);

      client.on('ready', async () => {
        clearTimeout(timeout);
        try {
          const sftp = await this.openSftp(client);
          // Detect remote OS
          const osResult = await this.execOnClient(client, 'uname -s');
          const remoteOS = osResult.stdout.trim().toLowerCase();
          config.remoteOS = remoteOS;
          state.status = 'connected';
          state.remoteOS = remoteOS;

          const managed: ManagedConnection = {
            client, sftp, config, state,
            password,
            reconnecting: false,
          };
          this.connections.set(config.id, managed);

          // Listen for unexpected disconnects to trigger auto-reconnect
          client.on('close', () => {
            if (managed.state.status === 'connected' && !managed.reconnecting) {
              this.handleUnexpectedDisconnect(config.id);
            }
          });

          this.emit('state-change', state);
          resolve(state);
        } catch (err: any) {
          client.end();
          state.status = 'error';
          state.error = err.message;
          reject(state);
        }
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        state.status = 'error';
        state.error = err.message;
        this.connections.delete(config.id);
        reject(state);
      });

      client.on('end', () => {
        // Only clean up if not reconnecting
        const managed = this.connections.get(config.id);
        if (!managed?.reconnecting) {
          this.connections.delete(config.id);
        }
      });

      client.connect(connectConfig);
    });
  }

  /**
   * Handle unexpected disconnect — attempt auto-reconnect with exponential backoff.
   */
  private async handleUnexpectedDisconnect(connId: string): Promise<void> {
    const managed = this.connections.get(connId);
    if (!managed || managed.reconnecting) return;

    managed.reconnecting = true;
    managed.state.status = 'connecting';
    managed.state.error = 'Connection lost, reconnecting...';
    this.emit('state-change', { ...managed.state });

    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[SSH] Reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS} for ${connId} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));

      try {
        // Check if user manually disconnected during backoff
        if (!this.connections.has(connId)) return;

        const newClient = new Client();
        const connectConfig = await this.buildConnectConfig(managed.config, managed.password);

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            newClient.end();
            reject(new Error('Reconnect timeout'));
          }, 15000);

          newClient.on('ready', async () => {
            clearTimeout(timeout);
            try {
              const sftp = await this.openSftp(newClient);
              managed.client = newClient;
              managed.sftp = sftp;
              managed.state.status = 'connected';
              managed.state.error = undefined;
              managed.reconnecting = false;

              // Re-attach close listener
              newClient.on('close', () => {
                if (managed.state.status === 'connected' && !managed.reconnecting) {
                  this.handleUnexpectedDisconnect(connId);
                }
              });

              this.emit('state-change', { ...managed.state });
              console.log(`[SSH] Reconnected to ${connId}`);
              resolve();
            } catch (err: any) {
              newClient.end();
              reject(err);
            }
          });

          newClient.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });

          newClient.connect(connectConfig);
        });

        return; // Success — exit retry loop
      } catch (err: any) {
        console.warn(`[SSH] Reconnect attempt ${attempt} failed:`, err.message);
      }
    }

    // All retries exhausted
    managed.reconnecting = false;
    managed.state.status = 'error';
    managed.state.error = `Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`;
    this.emit('state-change', { ...managed.state });
    this.connections.delete(connId);
  }

  /**
   * Disconnect a specific connection.
   */
  async disconnect(connId: string): Promise<void> {
    const conn = this.connections.get(connId);
    if (conn) {
      conn.client.end();
      this.connections.delete(connId);
    }
  }

  /**
   * Disconnect all connections.
   */
  async disconnectAll(): Promise<void> {
    for (const [id] of this.connections) {
      await this.disconnect(id);
    }
  }

  /**
   * Get the state of a connection.
   */
  getState(connId: string): RemoteConnectionState | null {
    return this.connections.get(connId)?.state ?? null;
  }

  /**
   * Get the active connection ID (if any).
   */
  getActiveConnectionId(): string | null {
    for (const [id, conn] of this.connections) {
      if (conn.state.status === 'connected') return id;
    }
    return null;
  }

  /**
   * List all connection states.
   */
  getAllStates(): RemoteConnectionState[] {
    return Array.from(this.connections.values()).map(c => c.state);
  }

  // ─── SFTP Operations ───────────────────────────────────────

  /**
   * Read directory via SFTP.
   */
  async readDir(connId: string, dirPath: string): Promise<RemoteFileEntry[]> {
    const conn = this.getConnection(connId);
    return new Promise((resolve, reject) => {
      conn.sftp.readdir(dirPath, (err, list) => {
        if (err) return reject(err);
        const entries: RemoteFileEntry[] = list
          .filter(item => item.filename !== '.' && item.filename !== '..')
          .map(item => ({
            name: item.filename,
            isDirectory: !!(item.attrs.mode && (item.attrs.mode & 0o040000)),
            path: dirPath.endsWith('/') ? dirPath + item.filename : dirPath + '/' + item.filename,
            size: item.attrs.size,
            modifiedAt: item.attrs.mtime ? item.attrs.mtime * 1000 : undefined,
          }));
        resolve(entries);
      });
    });
  }

  /**
   * Read file content via SFTP.
   */
  async readFile(connId: string, filePath: string): Promise<string> {
    const conn = this.getConnection(connId);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = conn.sftp.createReadStream(filePath, { encoding: undefined });
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
    });
  }

  /**
   * Write file content via SFTP.
   */
  async writeFile(connId: string, filePath: string, content: string): Promise<void> {
    const conn = this.getConnection(connId);
    return new Promise((resolve, reject) => {
      const stream = conn.sftp.createWriteStream(filePath);
      stream.on('close', () => resolve());
      stream.on('error', reject);
      stream.end(content, 'utf-8');
    });
  }

  // ─── Search & File Listing ─────────────────────────────────

  /**
   * Search files on remote via grep.
   */
  async search(connId: string, root: string, query: string): Promise<{ path: string; preview: string }[]> {
    const escaped = query.replace(/['"\\]/g, '\\$&');
    const result = await this.exec(connId, `grep -rn --include='*' -l "${escaped}" . 2>/dev/null | head -100`, root);
    if (result.code !== 0 || !result.stdout.trim()) return [];

    const files = result.stdout.trim().split('\n').filter(Boolean);
    const results: { path: string; preview: string }[] = [];

    for (const file of files.slice(0, 50)) {
      const fullPath = file.startsWith('./') ? path.posix.join(root, file.slice(2)) : file;
      const previewResult = await this.exec(
        connId,
        `grep -n "${escaped}" "${file}" 2>/dev/null | head -3`,
        root
      );
      const preview = previewResult.stdout.trim().split('\n')[0] || '';
      results.push({ path: fullPath, preview });
    }

    return results;
  }

  /**
   * List all files recursively on remote via find.
   */
  async listAllFiles(connId: string, root: string): Promise<string[]> {
    const result = await this.exec(
      connId,
      `find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' -maxdepth 4 2>/dev/null | head -5000`,
      root
    );
    if (result.code !== 0 || !result.stdout.trim()) return [];
    return result.stdout.trim().split('\n')
      .filter(Boolean)
      .map(f => f.startsWith('./') ? path.posix.join(root, f.slice(2)) : f);
  }

  // ─── Shell & Exec ──────────────────────────────────────────

  /**
   * Open an interactive shell channel (for terminal).
   */
  async createShell(connId: string): Promise<ClientChannel> {
    const conn = this.getConnection(connId);
    return new Promise((resolve, reject) => {
      conn.client.shell({ term: 'xterm-256color', cols: 120, rows: 30 }, (err, stream) => {
        if (err) return reject(err);
        resolve(stream);
      });
    });
  }

  /**
   * Execute a one-shot command on a connection.
   */
  async exec(connId: string, command: string, cwd?: string): Promise<RemoteExecResult> {
    const conn = this.getConnection(connId);
    const cmd = cwd ? `cd "${cwd}" && ${command}` : command;
    return this.execOnClient(conn.client, cmd);
  }

  // ─── Internal Helpers ──────────────────────────────────────

  private getConnection(connId: string): ManagedConnection {
    const conn = this.connections.get(connId);
    if (!conn) throw new Error(`No active connection: ${connId}`);
    if (conn.state.status !== 'connected') throw new Error(`Connection ${connId} is not connected (${conn.state.status})`);
    return conn;
  }

  private openSftp(client: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        resolve(sftp);
      });
    });
  }

  private execOnClient(client: Client, command: string): Promise<RemoteExecResult> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        stream.on('data', (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        stream.on('close', (code: number) => {
          resolve({ stdout, stderr, code: code ?? 0 });
        });
      });
    });
  }
}

/** Singleton instance */
let sshManager: SSHConnectionManager | null = null;

export function getSSHManager(): SSHConnectionManager {
  if (!sshManager) {
    sshManager = new SSHConnectionManager();
  }
  return sshManager;
}
