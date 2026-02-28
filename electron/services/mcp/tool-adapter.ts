/**
 * MCP Tool Adapter
 *
 * Bridges MCP tools into the globalToolRegistry by converting
 * McpToolDefinition → Tool interface and forwarding execute() calls
 * to McpClient.callTool().
 */

import { Tool, globalToolRegistry } from '../tools/registry';
import { McpClient, McpToolDefinition } from './client';

// Tool name format: mcp__{serverId}__{toolName}
const MCP_TOOL_PREFIX = 'mcp__';
const SEPARATOR = '__';

/**
 * Build a registry-safe tool name from MCP server ID and tool name
 */
function buildToolName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverId}${SEPARATOR}${toolName}`;
}

/**
 * Check if a tool name is an MCP tool
 */
export function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}

/**
 * Parse an MCP tool name into server ID and tool name
 */
export function parseMcpToolName(name: string): { serverId: string; toolName: string } | null {
  if (!isMcpTool(name)) return null;
  const withoutPrefix = name.substring(MCP_TOOL_PREFIX.length);
  const separatorIdx = withoutPrefix.indexOf(SEPARATOR);
  if (separatorIdx < 0) return null;
  return {
    serverId: withoutPrefix.substring(0, separatorIdx),
    toolName: withoutPrefix.substring(separatorIdx + SEPARATOR.length),
  };
}

/**
 * Convert an MCP tool definition to a Tool and register it
 */
function mcpToolToTool(
  serverId: string,
  def: McpToolDefinition,
  client: McpClient
): Tool {
  const registryName = buildToolName(serverId, def.name);

  return {
    name: registryName,
    description: def.description || `MCP tool: ${def.name} (${serverId})`,
    parameters: {
      type: 'object' as const,
      properties: (def.inputSchema?.properties || {}) as any,
      required: def.inputSchema?.required || [],
    },
    execute: async (params: Record<string, unknown>) => {
      try {
        const result = await client.callTool(def.name, params);

        // Extract text content from MCP result
        const textParts = (result.content || [])
          .filter(c => c.type === 'text' && c.text)
          .map(c => c.text!);
        const textResult = textParts.join('\n');

        if (result.isError) {
          return {
            success: false,
            error: {
              message: textResult || 'MCP tool returned an error',
              code: 'MCP_TOOL_ERROR',
              recoverable: true,
            },
          };
        }

        return {
          success: true,
          data: textResult || null,
        };
      } catch (err: any) {
        return {
          success: false,
          error: {
            message: err.message || 'MCP tool execution failed',
            code: 'MCP_EXECUTION_ERROR',
            recoverable: true,
          },
        };
      }
    },
  };
}

/**
 * Register all MCP tools from a server into the global tool registry
 */
export function registerMcpTools(
  serverId: string,
  tools: McpToolDefinition[],
  client: McpClient
): string[] {
  const registeredNames: string[] = [];

  for (const def of tools) {
    const tool = mcpToolToTool(serverId, def, client);
    globalToolRegistry.register(tool);
    registeredNames.push(tool.name);
  }

  return registeredNames;
}

/**
 * Unregister all MCP tools for a given server
 */
export function unregisterMcpTools(serverId: string): number {
  const prefix = `${MCP_TOOL_PREFIX}${serverId}${SEPARATOR}`;
  const toRemove = globalToolRegistry.names().filter(n => n.startsWith(prefix));

  for (const name of toRemove) {
    globalToolRegistry.unregister(name);
  }

  return toRemove.length;
}

/**
 * Get all MCP tools currently registered for a server
 */
export function getMcpToolsForServer(serverId: string): Tool[] {
  const prefix = `${MCP_TOOL_PREFIX}${serverId}${SEPARATOR}`;
  return globalToolRegistry.list().filter(t => t.name.startsWith(prefix));
}

/**
 * Get all registered MCP tools across all servers
 */
export function getAllMcpTools(): Tool[] {
  return globalToolRegistry.list().filter(t => isMcpTool(t.name));
}

/**
 * Convert MCP tool registry names back to display-friendly format
 */
export function getDisplayName(registryName: string): string {
  const parsed = parseMcpToolName(registryName);
  if (!parsed) return registryName;
  return `${parsed.toolName} (${parsed.serverId})`;
}
