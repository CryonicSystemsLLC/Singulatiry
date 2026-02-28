/**
 * MCP Server Manager
 *
 * Manages MCP server lifecycle: config loading, start/stop/restart,
 * health checks, and IPC handler registration.
 */

import { BrowserWindow } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpClient, McpToolDefinition } from './client';
import { registerMcpTools, unregisterMcpTools, getAllMcpTools, parseMcpToolName } from './tool-adapter';

// Config types
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  autoStart?: boolean;  // default: true
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface McpServerState {
  id: string;
  config: McpServerConfig;
  status: McpServerStatus;
  error?: string;
  serverName?: string;
  serverVersion?: string;
  toolCount: number;
  tools: Array<{ name: string; description?: string }>;
  scope: 'project' | 'user';
}

// Health check interval
const HEALTH_CHECK_INTERVAL_MS = 30_000;

class McpServerManager {
  private servers = new Map<string, {
    client: McpClient;
    config: McpServerConfig;
    status: McpServerStatus;
    error?: string;
    tools: McpToolDefinition[];
    scope: 'project' | 'user';
    healthTimer?: ReturnType<typeof setInterval>;
  }>();

  private win: BrowserWindow | null = null;
  private projectRoot: string | null = null;

  setWindow(win: BrowserWindow): void {
    this.win = win;
  }

  /**
   * Load MCP configuration from project and user config files
   */
  async loadConfig(projectRoot?: string): Promise<void> {
    if (projectRoot) this.projectRoot = projectRoot;

    const userConfig = await this.readConfigFile(this.getUserConfigPath(), 'user');
    const projectConfig = projectRoot
      ? await this.readConfigFile(path.join(projectRoot, '.mcp.json'), 'project')
      : {};
    const claudeConfig = await this.readClaudeDesktopConfig();

    // Merge: project overrides user overrides Claude Desktop
    const merged: Record<string, { config: McpServerConfig; scope: 'project' | 'user' }> = {};

    for (const [id, config] of Object.entries(claudeConfig)) {
      merged[id] = { config, scope: 'user' };
    }
    for (const [id, config] of Object.entries(userConfig)) {
      merged[id] = { config, scope: 'user' };
    }
    for (const [id, config] of Object.entries(projectConfig)) {
      merged[id] = { config, scope: 'project' };
    }

    // Stop servers no longer in config
    for (const [id] of this.servers) {
      if (!merged[id]) {
        await this.stopServer(id);
      }
    }

    // Start/update servers from config
    for (const [id, { config, scope }] of Object.entries(merged)) {
      const existing = this.servers.get(id);
      if (existing && existing.status === 'running') {
        // Already running — skip unless config changed
        continue;
      }

      // Store config
      this.servers.set(id, {
        client: null as any,
        config,
        status: 'stopped',
        tools: [],
        scope,
      });

      // Auto-start if configured (default: true)
      if (config.autoStart !== false) {
        // Don't await — start in background to not block config loading
        this.startServer(id).catch(err => {
          console.error(`MCP auto-start failed for ${id}:`, err);
        });
      }
    }
  }

  /**
   * Start an MCP server
   */
  async startServer(id: string): Promise<void> {
    const entry = this.servers.get(id);
    if (!entry) throw new Error(`Unknown MCP server: ${id}`);
    if (entry.status === 'running') return;

    entry.status = 'starting';
    entry.error = undefined;
    this.notifyStatusChange(id);

    try {
      const client = new McpClient({
        command: entry.config.command,
        args: entry.config.args,
        env: entry.config.env,
        cwd: entry.config.cwd || this.projectRoot || undefined,
        requestTimeoutMs: 30_000,
      });

      // Set up event handlers
      client.onToolsChanged = async () => {
        try {
          const tools = await client.listTools();
          unregisterMcpTools(id);
          registerMcpTools(id, tools, client);
          entry.tools = tools;
          this.notifyToolsChanged(id);
        } catch (err) {
          console.error(`MCP tools refresh failed for ${id}:`, err);
        }
      };

      client.onDisconnect = (_code: number, _signal: string) => {
        entry.status = 'stopped';
        unregisterMcpTools(id);
        entry.tools = [];
        this.clearHealthCheck(id);
        this.notifyStatusChange(id);
      };

      client.onError = (err: Error) => {
        console.error(`MCP server error (${id}):`, err);
        entry.error = err.message;
        this.notifyStatusChange(id);
      };

      // Connect
      await client.connect();

      // List and register tools
      const tools = await client.listTools();
      registerMcpTools(id, tools, client);

      entry.client = client;
      entry.status = 'running';
      entry.tools = tools;

      // Start health check
      this.startHealthCheck(id);

      this.notifyStatusChange(id);
      this.notifyToolsChanged(id);
    } catch (err: any) {
      entry.status = 'error';
      entry.error = err.message;
      this.notifyStatusChange(id);
      throw err;
    }
  }

  /**
   * Stop an MCP server
   */
  async stopServer(id: string): Promise<void> {
    const entry = this.servers.get(id);
    if (!entry) return;

    this.clearHealthCheck(id);
    unregisterMcpTools(id);

    if (entry.client) {
      entry.client.disconnect();
    }

    entry.status = 'stopped';
    entry.tools = [];
    entry.error = undefined;
    this.notifyStatusChange(id);
    this.notifyToolsChanged(id);
  }

  /**
   * Restart an MCP server
   */
  async restartServer(id: string): Promise<void> {
    await this.stopServer(id);
    // Brief delay to let the process fully exit
    await new Promise(resolve => setTimeout(resolve, 500));
    await this.startServer(id);
  }

  /**
   * Add a new server to the config
   */
  async addServer(
    id: string,
    config: McpServerConfig,
    scope: 'project' | 'user' = 'user'
  ): Promise<void> {
    const filePath = scope === 'project' && this.projectRoot
      ? path.join(this.projectRoot, '.mcp.json')
      : this.getUserConfigPath();

    const existing = await this.readRawConfig(filePath);
    existing.mcpServers = existing.mcpServers || {};
    existing.mcpServers[id] = config;
    await this.writeConfig(filePath, existing);

    // Register in memory and start
    this.servers.set(id, {
      client: null as any,
      config,
      status: 'stopped',
      tools: [],
      scope,
    });

    if (config.autoStart !== false) {
      await this.startServer(id);
    }
  }

  /**
   * Remove a server from the config
   */
  async removeServer(id: string, scope: 'project' | 'user' = 'user'): Promise<void> {
    await this.stopServer(id);
    this.servers.delete(id);

    const filePath = scope === 'project' && this.projectRoot
      ? path.join(this.projectRoot, '.mcp.json')
      : this.getUserConfigPath();

    const existing = await this.readRawConfig(filePath);
    if (existing.mcpServers) {
      delete existing.mcpServers[id];
      await this.writeConfig(filePath, existing);
    }
  }

  /**
   * Get all server states
   */
  listServers(): McpServerState[] {
    const result: McpServerState[] = [];
    for (const [id, entry] of this.servers) {
      result.push({
        id,
        config: entry.config,
        status: entry.status,
        error: entry.error,
        serverName: entry.client?.server?.name,
        serverVersion: entry.client?.server?.version,
        toolCount: entry.tools.length,
        tools: entry.tools.map(t => ({ name: t.name, description: t.description })),
        scope: entry.scope,
      });
    }
    return result;
  }

  /**
   * Get all available MCP tools (for the chat to use)
   */
  getTools(): Array<{
    name: string;
    registryName: string;
    description: string;
    serverId: string;
    parameters: any;
  }> {
    return getAllMcpTools().map(tool => {
      const parsed = parseMcpToolName(tool.name);
      return {
        name: parsed?.toolName || tool.name,
        registryName: tool.name,
        description: tool.description,
        serverId: parsed?.serverId || 'unknown',
        parameters: tool.parameters,
      };
    });
  }

  /**
   * Call an MCP tool by its registry name
   */
  async callTool(
    registryName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    const parsed = parseMcpToolName(registryName);
    if (!parsed) {
      return { success: false, error: `Not an MCP tool: ${registryName}` };
    }

    const entry = this.servers.get(parsed.serverId);
    if (!entry || entry.status !== 'running') {
      return { success: false, error: `MCP server not running: ${parsed.serverId}` };
    }

    try {
      const result = await entry.client.callTool(parsed.toolName, args);
      const textParts = (result.content || [])
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text!);
      const textResult = textParts.join('\n');

      if (result.isError) {
        return { success: false, error: textResult || 'Tool returned an error' };
      }
      return { success: true, data: textResult };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Stop all servers (for app cleanup)
   */
  async stopAll(): Promise<void> {
    const ids = Array.from(this.servers.keys());
    await Promise.all(ids.map(id => this.stopServer(id)));
  }

  // ===== Private Helpers =====

  private getUserConfigPath(): string {
    const configDir = path.join(os.homedir(), '.singularity');
    return path.join(configDir, 'mcp.json');
  }

  private async readConfigFile(
    filePath: string,
    _scope: string
  ): Promise<Record<string, McpServerConfig>> {
    try {
      if (!existsSync(filePath)) return {};
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as McpConfig;
      return parsed.mcpServers || {};
    } catch {
      return {};
    }
  }

  private async readClaudeDesktopConfig(): Promise<Record<string, McpServerConfig>> {
    try {
      const claudeConfigPath = path.join(
        os.homedir(),
        '.claude',
        'claude_desktop_config.json'
      );
      if (!existsSync(claudeConfigPath)) return {};
      const raw = await readFile(claudeConfigPath, 'utf-8');
      const parsed = JSON.parse(raw) as McpConfig;
      return parsed.mcpServers || {};
    } catch {
      return {};
    }
  }

  private async readRawConfig(filePath: string): Promise<McpConfig> {
    try {
      if (!existsSync(filePath)) return { mcpServers: {} };
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as McpConfig;
    } catch {
      return { mcpServers: {} };
    }
  }

  private async writeConfig(filePath: string, config: McpConfig): Promise<void> {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  private startHealthCheck(id: string): void {
    const entry = this.servers.get(id);
    if (!entry) return;

    entry.healthTimer = setInterval(async () => {
      if (entry.status !== 'running' || !entry.client) return;

      const alive = await entry.client.ping();
      if (!alive) {
        console.warn(`MCP health check failed for ${id}, attempting reconnect...`);
        try {
          await this.restartServer(id);
        } catch (err) {
          console.error(`MCP reconnect failed for ${id}:`, err);
        }
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private clearHealthCheck(id: string): void {
    const entry = this.servers.get(id);
    if (entry?.healthTimer) {
      clearInterval(entry.healthTimer);
      entry.healthTimer = undefined;
    }
  }

  private notifyStatusChange(id: string): void {
    const entry = this.servers.get(id);
    if (!entry || !this.win) return;

    this.win.webContents.send('mcp:status-change', {
      id,
      status: entry.status,
      error: entry.error,
      serverName: entry.client?.server?.name,
      serverVersion: entry.client?.server?.version,
      toolCount: entry.tools.length,
    });
  }

  private notifyToolsChanged(id: string): void {
    if (!this.win) return;
    this.win.webContents.send('mcp:tools-changed', {
      serverId: id,
      tools: this.getTools(),
    });
  }
}

// Singleton
let managerInstance: McpServerManager | null = null;

export function getMcpServerManager(): McpServerManager {
  if (!managerInstance) {
    managerInstance = new McpServerManager();
  }
  return managerInstance;
}

/**
 * IPC handlers for MCP operations
 */
export const mcpIpcHandlers: Record<string, (...args: any[]) => any> = {
  'mcp:list-servers': () => {
    return getMcpServerManager().listServers();
  },

  'mcp:start-server': async (_event: any, id: string) => {
    await getMcpServerManager().startServer(id);
    return { success: true };
  },

  'mcp:stop-server': async (_event: any, id: string) => {
    await getMcpServerManager().stopServer(id);
    return { success: true };
  },

  'mcp:restart-server': async (_event: any, id: string) => {
    await getMcpServerManager().restartServer(id);
    return { success: true };
  },

  'mcp:get-tools': () => {
    return getMcpServerManager().getTools();
  },

  'mcp:call-tool': async (
    _event: any,
    registryName: string,
    args: Record<string, unknown>
  ) => {
    return getMcpServerManager().callTool(registryName, args);
  },

  'mcp:add-server': async (
    _event: any,
    id: string,
    config: McpServerConfig,
    scope: 'project' | 'user'
  ) => {
    await getMcpServerManager().addServer(id, config, scope);
    return { success: true };
  },

  'mcp:remove-server': async (
    _event: any,
    id: string,
    scope: 'project' | 'user'
  ) => {
    await getMcpServerManager().removeServer(id, scope);
    return { success: true };
  },

  'mcp:load-config': async (_event: any, projectRoot?: string) => {
    await getMcpServerManager().loadConfig(projectRoot);
    return { success: true };
  },
};
