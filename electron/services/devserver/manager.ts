/**
 * Dev Server Manager
 *
 * Manages development servers for projects - start, stop, restart, and monitor.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { findAvailablePort } from './port-finder';

export interface ServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  cwd: string;
  port: number;
  env?: Record<string, string>;
  healthCheck?: {
    url: string;
    interval: number;
    timeout: number;
  };
}

export interface ServerStatus {
  id: string;
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'error' | 'stopping';
  port?: number;
  pid?: number;
  startedAt?: Date;
  error?: string;
  url?: string;
  output: string[];
}

export type ServerEvent =
  | { type: 'started'; serverId: string; port: number; pid: number }
  | { type: 'stopped'; serverId: string }
  | { type: 'error'; serverId: string; error: string }
  | { type: 'output'; serverId: string; data: string }
  | { type: 'health_check'; serverId: string; healthy: boolean };

/**
 * Dev Server Manager
 */
export class DevServerManager extends EventEmitter {
  private servers: Map<string, {
    config: ServerConfig;
    process: ChildProcess | null;
    status: ServerStatus;
    healthCheckInterval?: NodeJS.Timeout;
  }> = new Map();

  private maxOutputLines = 1000;

  constructor() {
    super();
  }

  /**
   * Register a server configuration
   */
  registerServer(config: ServerConfig): void {
    if (this.servers.has(config.id)) {
      throw new Error(`Server '${config.id}' already registered`);
    }

    this.servers.set(config.id, {
      config,
      process: null,
      status: {
        id: config.id,
        name: config.name,
        status: 'stopped',
        port: config.port,
        output: []
      }
    });
  }

  /**
   * Start a server
   */
  async startServer(serverId: string): Promise<ServerStatus> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server '${serverId}' not found`);
    }

    if (server.status.status === 'running') {
      return server.status;
    }

    server.status.status = 'starting';
    server.status.error = undefined;
    server.status.output = [];

    try {
      // Find available port if needed
      const port = await findAvailablePort(server.config.port);
      server.config.port = port;
      server.status.port = port;

      // Prepare environment
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...server.config.env,
        PORT: String(port)
      };

      // Parse command
      const [cmd, ...defaultArgs] = server.config.command.split(' ');
      const args = [...defaultArgs, ...(server.config.args || [])];

      // Spawn process
      const child = spawn(cmd, args, {
        cwd: server.config.cwd,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      server.process = child;
      server.status.pid = child.pid;
      server.status.startedAt = new Date();

      // Handle stdout
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        this.appendOutput(serverId, text);
        this.emit('event', {
          type: 'output',
          serverId,
          data: text
        } as ServerEvent);

        // Check for common "server ready" messages
        if (this.checkForReadyMessage(text, port)) {
          server.status.status = 'running';
          server.status.url = `http://localhost:${port}`;
          this.emit('event', {
            type: 'started',
            serverId,
            port,
            pid: child.pid!
          } as ServerEvent);

          // Start health checks
          this.startHealthCheck(serverId);
        }
      });

      // Handle stderr
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        this.appendOutput(serverId, text);
        this.emit('event', {
          type: 'output',
          serverId,
          data: text
        } as ServerEvent);
      });

      // Handle exit
      child.on('exit', (code: number | null) => {
        this.stopHealthCheck(serverId);
        server.process = null;
        server.status.pid = undefined;

        if (server.status.status !== 'stopping') {
          server.status.status = code === 0 ? 'stopped' : 'error';
          if (code !== 0) {
            server.status.error = `Process exited with code ${code}`;
          }
        } else {
          server.status.status = 'stopped';
        }

        this.emit('event', {
          type: 'stopped',
          serverId
        } as ServerEvent);
      });

      // Handle error
      child.on('error', (err: Error) => {
        server.status.status = 'error';
        server.status.error = err.message;
        this.emit('event', {
          type: 'error',
          serverId,
          error: err.message
        } as ServerEvent);
      });

      // Set a timeout for the server to start
      setTimeout(() => {
        if (server.status.status === 'starting') {
          // Assume it's running if process is still alive
          if (child.exitCode === null) {
            server.status.status = 'running';
            server.status.url = `http://localhost:${port}`;
            this.emit('event', {
              type: 'started',
              serverId,
              port,
              pid: child.pid!
            } as ServerEvent);
          }
        }
      }, 10000);

      return server.status;
    } catch (error: any) {
      server.status.status = 'error';
      server.status.error = error.message;
      throw error;
    }
  }

  /**
   * Stop a server
   */
  async stopServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server || !server.process) {
      return;
    }

    server.status.status = 'stopping';
    this.stopHealthCheck(serverId);

    // Try graceful shutdown first
    server.process.kill('SIGTERM');

    // Force kill after timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (server.process && server.process.exitCode === null) {
          server.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      server.process!.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Restart a server
   */
  async restartServer(serverId: string): Promise<ServerStatus> {
    await this.stopServer(serverId);
    await new Promise(r => setTimeout(r, 1000)); // Wait a bit
    return this.startServer(serverId);
  }

  /**
   * Get server status
   */
  getStatus(serverId: string): ServerStatus | null {
    const server = this.servers.get(serverId);
    return server?.status || null;
  }

  /**
   * Get all server statuses
   */
  getAllStatuses(): ServerStatus[] {
    return Array.from(this.servers.values()).map(s => s.status);
  }

  /**
   * Stop all servers
   */
  async stopAll(): Promise<void> {
    await Promise.all(
      Array.from(this.servers.keys()).map(id => this.stopServer(id))
    );
  }

  /**
   * Check if output contains server ready message
   */
  private checkForReadyMessage(output: string, port: number): boolean {
    const readyPatterns = [
      /ready on/i,
      /listening on/i,
      /started server/i,
      /server running/i,
      /server started/i,
      /available at/i,
      new RegExp(`localhost:${port}`),
      new RegExp(`127\\.0\\.0\\.1:${port}`),
      /compiled successfully/i,
      /compiled client and server/i,
      /app is running/i
    ];

    return readyPatterns.some(pattern => pattern.test(output));
  }

  /**
   * Append output to server log
   */
  private appendOutput(serverId: string, text: string): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    const lines = text.split('\n').filter(l => l.trim());
    server.status.output.push(...lines);

    // Trim to max lines
    if (server.status.output.length > this.maxOutputLines) {
      server.status.output = server.status.output.slice(-this.maxOutputLines);
    }
  }

  /**
   * Start health check for a server
   */
  private startHealthCheck(serverId: string): void {
    const server = this.servers.get(serverId);
    if (!server || !server.config.healthCheck) return;

    const { url, interval } = server.config.healthCheck;

    server.healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(server.config.healthCheck!.timeout)
        });

        const healthy = response.ok;
        this.emit('event', {
          type: 'health_check',
          serverId,
          healthy
        } as ServerEvent);

        if (!healthy && server.status.status === 'running') {
          server.status.status = 'error';
          server.status.error = `Health check failed: ${response.status}`;
        }
      } catch (error) {
        this.emit('event', {
          type: 'health_check',
          serverId,
          healthy: false
        } as ServerEvent);
      }
    }, interval);
  }

  /**
   * Stop health check for a server
   */
  private stopHealthCheck(serverId: string): void {
    const server = this.servers.get(serverId);
    if (server?.healthCheckInterval) {
      clearInterval(server.healthCheckInterval);
      server.healthCheckInterval = undefined;
    }
  }

  /**
   * Remove a server configuration
   */
  async removeServer(serverId: string): Promise<void> {
    await this.stopServer(serverId);
    this.servers.delete(serverId);
  }

  /**
   * Create a server config from a stack
   */
  static createFromStack(
    projectRoot: string,
    stack: {
      id: string;
      name: string;
      commands: { dev: string };
      ports: { dev: number };
    }
  ): ServerConfig {
    return {
      id: `${stack.id}-dev`,
      name: `${stack.name} Dev Server`,
      command: stack.commands.dev,
      cwd: projectRoot,
      port: stack.ports.dev,
      healthCheck: {
        url: `http://localhost:${stack.ports.dev}`,
        interval: 30000,
        timeout: 5000
      }
    };
  }
}

// Singleton instance
let managerInstance: DevServerManager | null = null;

/**
 * Get the dev server manager instance
 */
export function getDevServerManager(): DevServerManager {
  if (!managerInstance) {
    managerInstance = new DevServerManager();
  }
  return managerInstance;
}

/**
 * IPC handlers for dev server management
 */
export const devServerIpcHandlers = {
  'devserver:register': (_event: any, config: ServerConfig) => {
    const manager = getDevServerManager();
    manager.registerServer(config);
    return true;
  },

  'devserver:start': async (_event: any, serverId: string) => {
    const manager = getDevServerManager();
    return manager.startServer(serverId);
  },

  'devserver:stop': async (_event: any, serverId: string) => {
    const manager = getDevServerManager();
    await manager.stopServer(serverId);
    return true;
  },

  'devserver:restart': async (_event: any, serverId: string) => {
    const manager = getDevServerManager();
    return manager.restartServer(serverId);
  },

  'devserver:status': (_event: any, serverId: string) => {
    const manager = getDevServerManager();
    return manager.getStatus(serverId);
  },

  'devserver:all-status': () => {
    const manager = getDevServerManager();
    return manager.getAllStatuses();
  },

  'devserver:stop-all': async () => {
    const manager = getDevServerManager();
    await manager.stopAll();
    return true;
  }
};

export default DevServerManager;
