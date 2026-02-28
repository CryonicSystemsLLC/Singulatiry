/**
 * MCP JSON-RPC 2.0 over stdio transport
 *
 * Spawns an MCP server as a child process and communicates via
 * newline-delimited JSON-RPC 2.0 on stdin/stdout.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// JSON-RPC 2.0 types
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface TransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  requestTimeoutMs?: number;
}

export class StdioTransport extends EventEmitter {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, Array<(params: unknown) => void>>();
  private inputBuffer = '';
  private _connected = false;
  private requestTimeoutMs: number;
  private options: TransportOptions;

  constructor(options: TransportOptions) {
    super();
    this.options = options;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  get connected(): boolean {
    return this._connected;
  }

  start(): void {
    if (this.process) return;

    const { command, args = [], env = {}, cwd } = this.options;

    // Windows: use shell:true so that .cmd/.bat scripts (npx, node, etc.) resolve
    this.process = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
    });

    this.process.stdout!.setEncoding('utf-8');
    this.process.stderr!.setEncoding('utf-8');

    // Read newline-delimited JSON from stdout
    this.process.stdout!.on('data', (chunk: string) => {
      this.inputBuffer += chunk;
      let newlineIdx: number;
      while ((newlineIdx = this.inputBuffer.indexOf('\n')) >= 0) {
        const line = this.inputBuffer.substring(0, newlineIdx).trim();
        this.inputBuffer = this.inputBuffer.substring(newlineIdx + 1);
        if (line) {
          this.handleLine(line);
        }
      }
    });

    this.process.stderr!.on('data', (data: string) => {
      // MCP servers may log to stderr — forward as events
      this.emit('stderr', data);
    });

    this.process.on('error', (err) => {
      this._connected = false;
      this.rejectAllPending(err);
      this.emit('error', err);
    });

    this.process.on('exit', (code, signal) => {
      this._connected = false;
      this.rejectAllPending(new Error(`MCP server exited (code=${code}, signal=${signal})`));
      this.process = null;
      this.emit('exit', code, signal);
    });

    this._connected = true;
    this.emit('started');
  }

  /**
   * Send a JSON-RPC request and wait for the response
   */
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process || !this._connected) {
      throw new Error('Transport not connected');
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method} (${this.requestTimeoutMs}ms)`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.write(request);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.process || !this._connected) return;

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };

    this.write(notification);
  }

  /**
   * Register a handler for server-initiated notifications
   */
  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const handlers = this.notificationHandlers.get(method) || [];
    handlers.push(handler);
    this.notificationHandlers.set(method, handlers);

    return () => {
      const current = this.notificationHandlers.get(method);
      if (current) {
        const idx = current.indexOf(handler);
        if (idx >= 0) current.splice(idx, 1);
      }
    };
  }

  /**
   * Gracefully close the transport
   */
  close(): void {
    this._connected = false;
    this.rejectAllPending(new Error('Transport closed'));

    if (this.process) {
      this.process.stdin!.end();
      // Give the process a moment to exit gracefully, then force kill
      const forceKillTimer = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
          this.process = null;
        }
      }, 3000);

      this.process.once('exit', () => {
        clearTimeout(forceKillTimer);
        this.process = null;
      });

      this.process.kill('SIGTERM');
    }
  }

  private write(message: JsonRpcMessage): void {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit('parse-error', line);
      return;
    }

    // Response to a pending request
    if ('id' in message && message.id != null) {
      const pending = this.pending.get(message.id as number);
      if (pending) {
        this.pending.delete(message.id as number);
        clearTimeout(pending.timer);

        const response = message as JsonRpcResponse;
        if (response.error) {
          pending.reject(
            new Error(`MCP error ${response.error.code}: ${response.error.message}`)
          );
        } else {
          pending.resolve(response.result);
        }
        return;
      }
    }

    // Server-initiated notification (no 'id' field)
    if ('method' in message && !('id' in message)) {
      const notification = message as JsonRpcNotification;
      const handlers = this.notificationHandlers.get(notification.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(notification.params);
          } catch (err) {
            console.error(`MCP notification handler error (${notification.method}):`, err);
          }
        }
      }
      this.emit('notification', notification);
      return;
    }

    // Unhandled message
    this.emit('unhandled', message);
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
