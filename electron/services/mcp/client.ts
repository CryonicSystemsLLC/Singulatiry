/**
 * MCP Protocol Client
 *
 * Wraps StdioTransport with typed MCP protocol methods:
 * initialize, tools/list, tools/call, resources, prompts.
 */

import { StdioTransport, TransportOptions } from './transport';

// MCP protocol version
const MCP_PROTOCOL_VERSION = '2024-11-05';

// MCP types
export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface McpToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: { uri: string; text?: string; blob?: string; mimeType?: string };
  }>;
  isError?: boolean;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: 'resource'; resource: { uri: string; text?: string; blob?: string; mimeType?: string } };
}

export class McpClient {
  private transport: StdioTransport;
  private serverInfo: McpServerInfo | null = null;
  private serverCapabilities: McpServerCapabilities | null = null;
  private _connected = false;

  constructor(transportOptions: TransportOptions) {
    this.transport = new StdioTransport(transportOptions);
  }

  get connected(): boolean {
    return this._connected;
  }

  get capabilities(): McpServerCapabilities | null {
    return this.serverCapabilities;
  }

  get server(): McpServerInfo | null {
    return this.serverInfo;
  }

  /**
   * Start transport and perform MCP initialize handshake
   */
  async connect(): Promise<void> {
    this.transport.start();

    // Subscribe to tools/list_changed if server supports it
    this.transport.onNotification('notifications/tools/list_changed', () => {
      this.onToolsChanged?.();
    });

    // Forward transport events
    this.transport.on('exit', (code: number, signal: string) => {
      this._connected = false;
      this.onDisconnect?.(code, signal);
    });

    this.transport.on('error', (err: Error) => {
      this.onError?.(err);
    });

    // MCP initialize
    const initResult = await this.transport.send('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        roots: { listChanged: true },
      },
      clientInfo: {
        name: 'singularity-ide',
        version: '1.0.0',
      },
    }) as {
      protocolVersion: string;
      capabilities: McpServerCapabilities;
      serverInfo: McpServerInfo;
    };

    this.serverInfo = initResult.serverInfo;
    this.serverCapabilities = initResult.capabilities;
    this._connected = true;

    // Send initialized notification
    this.transport.notify('notifications/initialized');
  }

  /**
   * List available tools
   */
  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.transport.send('tools/list') as { tools: McpToolDefinition[] };
    return result.tools || [];
  }

  /**
   * Call a tool
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.transport.send('tools/call', {
      name,
      arguments: args || {},
    }) as McpToolResult;
    return result;
  }

  /**
   * List available resources
   */
  async listResources(): Promise<McpResource[]> {
    const result = await this.transport.send('resources/list') as { resources: McpResource[] };
    return result.resources || [];
  }

  /**
   * Read a resource by URI
   */
  async readResource(uri: string): Promise<McpResourceContent[]> {
    const result = await this.transport.send('resources/read', { uri }) as {
      contents: McpResourceContent[];
    };
    return result.contents || [];
  }

  /**
   * List available prompts
   */
  async listPrompts(): Promise<McpPrompt[]> {
    const result = await this.transport.send('prompts/list') as { prompts: McpPrompt[] };
    return result.prompts || [];
  }

  /**
   * Get a prompt by name
   */
  async getPrompt(
    name: string,
    args?: Record<string, string>
  ): Promise<{ description?: string; messages: McpPromptMessage[] }> {
    return await this.transport.send('prompts/get', {
      name,
      arguments: args || {},
    }) as { description?: string; messages: McpPromptMessage[] };
  }

  /**
   * Send a ping to check connectivity
   */
  async ping(): Promise<boolean> {
    try {
      await this.transport.send('ping');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this._connected = false;
    this.transport.close();
  }

  // Event callbacks (set by manager)
  onToolsChanged?: () => void;
  onDisconnect?: (code: number, signal: string) => void;
  onError?: (error: Error) => void;
}
