/**
 * MCP Integration - Barrel Exports
 */

export { StdioTransport } from './transport';
export type { TransportOptions, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from './transport';

export { McpClient } from './client';
export type {
  McpServerInfo,
  McpServerCapabilities,
  McpToolDefinition,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPrompt,
  McpPromptMessage,
} from './client';

export {
  registerMcpTools,
  unregisterMcpTools,
  getMcpToolsForServer,
  getAllMcpTools,
  isMcpTool,
  parseMcpToolName,
  getDisplayName,
} from './tool-adapter';

export { getMcpServerManager, mcpIpcHandlers } from './manager';
export type { McpServerConfig, McpConfig, McpServerStatus, McpServerState } from './manager';
