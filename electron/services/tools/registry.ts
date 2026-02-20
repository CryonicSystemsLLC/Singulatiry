/**
 * Tool Registry - Foundation for all agent capabilities
 * Manages tool registration, lookup, and format conversion for different AI providers
 */

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema & { description?: string; default?: any; enum?: string[] }>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  default?: any;
  enum?: string[];
}

export interface ToolContext {
  projectRoot: string;
  securityConfig: SecurityConfig;
  modelService?: any; // Will be typed properly when model service is created
  env?: Record<string, string>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: {
    message: string;
    code?: string;
    recoverable?: boolean;
  };
  rollback?: RollbackAction;
}

export interface RollbackAction {
  type: 'restore_file' | 'delete_file' | 'run_command';
  path?: string;
  backup?: string;
  command?: string;
}

export interface SecurityConfig {
  allowedCommands: string[] | '*';
  blockedPaths: string[];
  maxFileSize: number;
  maxExecutionTime: number;
  networkAccess: 'full' | 'localhost-only' | 'none';
}

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: any, context: ToolContext) => Promise<ToolResult>;
}

// OpenAI function calling format
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

// Anthropic tool format
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

// Gemini tool format
export interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: JSONSchema;
  }>;
}

/**
 * Tool Registry implementation
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a new tool
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool ${tool.name} is being overwritten`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tools
   */
  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names
   */
  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool by name
   */
  async execute(name: string, params: any, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: {
          message: `Tool '${name}' not found`,
          code: 'TOOL_NOT_FOUND',
          recoverable: false
        }
      };
    }

    try {
      return await tool.execute(params, context);
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: error.message || 'Tool execution failed',
          code: 'EXECUTION_ERROR',
          recoverable: true
        }
      };
    }
  }

  /**
   * Convert tools to OpenAI function calling format
   */
  toOpenAIFormat(toolNames?: string[]): OpenAITool[] {
    const tools = toolNames
      ? toolNames.map(name => this.tools.get(name)).filter(Boolean) as Tool[]
      : this.list();

    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * Convert tools to Anthropic format
   */
  toAnthropicFormat(toolNames?: string[]): AnthropicTool[] {
    const tools = toolNames
      ? toolNames.map(name => this.tools.get(name)).filter(Boolean) as Tool[]
      : this.list();

    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }

  /**
   * Convert tools to Gemini format
   */
  toGeminiFormat(toolNames?: string[]): GeminiTool {
    const tools = toolNames
      ? toolNames.map(name => this.tools.get(name)).filter(Boolean) as Tool[]
      : this.list();

    return {
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }))
    };
  }

  /**
   * Get tools as a formatted string for system prompts (for providers without native tool calling)
   */
  toPromptFormat(toolNames?: string[]): string {
    const tools = toolNames
      ? toolNames.map(name => this.tools.get(name)).filter(Boolean) as Tool[]
      : this.list();

    const toolDescriptions = tools.map(tool => {
      const params = Object.entries(tool.parameters.properties || {})
        .map(([name, schema]) => {
          const required = tool.parameters.required?.includes(name) ? '(required)' : '(optional)';
          return `    - ${name} ${required}: ${schema.description || schema.type}`;
        })
        .join('\n');

      return `## ${tool.name}
${tool.description}

Parameters:
${params || '    (none)'}`;
    });

    return `# Available Tools

You can use the following tools by outputting a JSON block in this exact format:

\`\`\`tool_call
{
  "tool": "tool_name",
  "params": {
    "param1": "value1"
  }
}
\`\`\`

${toolDescriptions.join('\n\n')}`;
  }

  /**
   * Parse tool calls from AI response text (for simulated tool calling)
   */
  parseToolCalls(text: string): Array<{ tool: string; params: any }> {
    const toolCalls: Array<{ tool: string; params: any }> = [];

    // Match ```tool_call ... ``` blocks
    const toolCallRegex = /```tool_call\s*([\s\S]*?)```/g;
    let match;

    while ((match = toolCallRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.tool && typeof parsed.tool === 'string') {
          toolCalls.push({
            tool: parsed.tool,
            params: parsed.params || {}
          });
        }
      } catch (e) {
        console.warn('Failed to parse tool call:', match[1]);
      }
    }

    return toolCalls;
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get the count of registered tools
   */
  get size(): number {
    return this.tools.size;
  }
}

// Singleton instance for global use
export const globalToolRegistry = new ToolRegistry();

// Helper function to create a tool with type safety
export function defineTool<T extends Record<string, any>>(
  name: string,
  description: string,
  parameters: JSONSchema,
  execute: (params: T, context: ToolContext) => Promise<ToolResult>
): Tool {
  return {
    name,
    description,
    parameters,
    execute: execute as (params: any, context: ToolContext) => Promise<ToolResult>
  };
}
