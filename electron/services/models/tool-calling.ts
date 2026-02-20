/**
 * Tool Calling Module
 *
 * Handles tool/function calling across different AI providers.
 * Provides both native tool calling support and simulation for providers without native support.
 */

import {
  ChatRequest,
  ChatResponse,
  ToolCall,
  ParsedToolCall,
  Message,
  ModelId,
  ProviderId,
  parseToolCallArguments,
  PROVIDER_CONFIGS
} from './types';
import { Tool, ToolRegistry, ToolResult, ToolContext } from '../tools/registry';

/**
 * Result of executing tool calls
 */
export interface ToolExecutionResult {
  toolCall: ParsedToolCall;
  result: ToolResult;
  executionTimeMs: number;
}

/**
 * Options for tool execution
 */
export interface ToolExecutionOptions {
  maxParallelExecutions?: number;
  timeout?: number;
  onToolStart?: (toolCall: ParsedToolCall) => void;
  onToolComplete?: (result: ToolExecutionResult) => void;
  onToolError?: (toolCall: ParsedToolCall, error: Error) => void;
}

/**
 * Execute tool calls from an AI response
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  toolRegistry: ToolRegistry,
  context: ToolContext,
  options: ToolExecutionOptions = {}
): Promise<ToolExecutionResult[]> {
  const {
    maxParallelExecutions = 3,
    timeout = 60000,
    onToolStart,
    onToolComplete,
    onToolError
  } = options;

  const results: ToolExecutionResult[] = [];
  const parsedCalls = toolCalls.map(parseToolCallArguments);

  // Execute in batches for controlled parallelism
  for (let i = 0; i < parsedCalls.length; i += maxParallelExecutions) {
    const batch = parsedCalls.slice(i, i + maxParallelExecutions);

    const batchResults = await Promise.all(
      batch.map(async (parsedCall) => {
        const startTime = Date.now();
        onToolStart?.(parsedCall);

        try {
          const result = await Promise.race([
            toolRegistry.execute(parsedCall.name, parsedCall.arguments, context),
            new Promise<ToolResult>((_, reject) =>
              setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
            )
          ]);

          const executionResult: ToolExecutionResult = {
            toolCall: parsedCall,
            result,
            executionTimeMs: Date.now() - startTime
          };

          onToolComplete?.(executionResult);
          return executionResult;
        } catch (error: any) {
          onToolError?.(parsedCall, error);

          return {
            toolCall: parsedCall,
            result: {
              success: false,
              error: {
                message: error.message || 'Tool execution failed',
                code: 'EXECUTION_ERROR',
                recoverable: true
              }
            },
            executionTimeMs: Date.now() - startTime
          };
        }
      })
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Convert tool execution results to messages for continuing conversation
 */
export function toolResultsToMessages(
  results: ToolExecutionResult[],
  providerId: ProviderId
): Message[] {
  if (providerId === 'anthropic') {
    // Anthropic expects tool_result content blocks in a user message
    return [{
      role: 'user',
      content: results.map(r => ({
        type: 'tool_result' as const,
        tool_result: {
          tool_use_id: r.toolCall.id,
          content: JSON.stringify(r.result.data || r.result.error),
          is_error: !r.result.success
        }
      }))
    }];
  }

  // OpenAI and compatible providers expect separate tool messages
  return results.map(r => ({
    role: 'tool' as const,
    content: JSON.stringify(r.result.data || r.result.error),
    toolCallId: r.toolCall.id,
    name: r.toolCall.name
  }));
}

/**
 * Create a tool execution loop that continues until the model stops calling tools
 */
export async function* toolExecutionLoop(
  initialResponse: ChatResponse,
  messages: Message[],
  _tools: Tool[], // Reserved for passing to generateFn in the future
  toolRegistry: ToolRegistry,
  context: ToolContext,
  generateFn: (request: ChatRequest) => Promise<ChatResponse>,
  options: {
    maxIterations?: number;
    model?: ModelId;
    systemPrompt?: string;
    executionOptions?: ToolExecutionOptions;
  } = {}
): AsyncGenerator<
  { type: 'tool_calls'; toolCalls: ToolCall[] } |
  { type: 'tool_results'; results: ToolExecutionResult[] } |
  { type: 'response'; response: ChatResponse },
  ChatResponse
> {
  const {
    maxIterations = 10,
    model,
    systemPrompt,
    executionOptions
  } = options;

  let response = initialResponse;
  let iteration = 0;
  const conversationMessages = [...messages];

  while (response.toolCalls?.length && iteration < maxIterations) {
    iteration++;

    // Yield tool calls
    yield { type: 'tool_calls', toolCalls: response.toolCalls };

    // Execute tools
    const results = await executeToolCalls(
      response.toolCalls,
      toolRegistry,
      context,
      executionOptions
    );

    // Yield results
    yield { type: 'tool_results', results };

    // Add assistant message with tool calls
    conversationMessages.push({
      role: 'assistant',
      content: response.content || '',
      // Note: toolCalls would be added differently per provider
    });

    // Add tool results
    const providerId = model ? model.split(':')[0] as ProviderId : 'openai';
    const resultMessages = toolResultsToMessages(results, providerId);
    conversationMessages.push(...resultMessages);

    // Get next response
    response = await generateFn({
      messages: conversationMessages,
      model,
      systemPrompt
    });

    // Yield intermediate response
    yield { type: 'response', response };
  }

  return response;
}

/**
 * System prompt template for simulated tool calling
 */
export function getToolCallingSystemPrompt(tools: Tool[]): string {
  const toolDescriptions = tools.map(tool => {
    const params = Object.entries(tool.parameters.properties || {})
      .map(([name, schema]: [string, any]) => {
        const required = tool.parameters.required?.includes(name) ? '(required)' : '(optional)';
        const defaultVal = schema.default !== undefined ? ` [default: ${schema.default}]` : '';
        return `  - ${name} ${required}: ${schema.description || schema.type}${defaultVal}`;
      })
      .join('\n');

    return `### ${tool.name}
${tool.description}

Parameters:
${params || '  (none)'}`;
  });

  return `# Available Tools

You have access to the following tools. When you need to use a tool, output a JSON block in this exact format:

\`\`\`tool_call
{
  "tool": "tool_name",
  "params": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\`

You can call multiple tools in sequence by outputting multiple tool_call blocks.

After calling a tool, wait for the result before proceeding. The result will be provided in the next message.

${toolDescriptions.join('\n\n')}

---

Important guidelines:
1. Always use the exact tool names as shown above
2. Provide all required parameters
3. Use appropriate types for parameter values (strings, numbers, booleans)
4. If a tool fails, analyze the error and try a different approach
5. Explain your reasoning before calling tools`;
}

/**
 * Parse simulated tool calls from AI response
 */
export function parseSimulatedToolCalls(content: string): ParsedToolCall[] {
  const toolCalls: ParsedToolCall[] = [];
  const toolCallRegex = /```tool_call\s*([\s\S]*?)```/g;
  let match;
  let index = 0;

  while ((match = toolCallRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.tool && typeof parsed.tool === 'string') {
        toolCalls.push({
          id: `simulated_${index++}`,
          name: parsed.tool,
          arguments: parsed.params || {}
        });
      }
    } catch {
      // Skip malformed tool calls
    }
  }

  return toolCalls;
}

/**
 * Check if a provider supports native tool calling
 */
export function supportsNativeToolCalling(providerId: ProviderId): boolean {
  const config = PROVIDER_CONFIGS[providerId];
  return config?.supportsToolCalling ?? false;
}

/**
 * Format tool results for display
 */
export function formatToolResult(result: ToolExecutionResult): string {
  const { toolCall, result: toolResult, executionTimeMs } = result;
  const status = toolResult.success ? '✓' : '✗';
  const data = toolResult.success
    ? JSON.stringify(toolResult.data, null, 2)
    : toolResult.error?.message || 'Unknown error';

  return `${status} ${toolCall.name} (${executionTimeMs}ms)
${data}`;
}

/**
 * Summarize tool execution results
 */
export function summarizeToolResults(results: ToolExecutionResult[]): string {
  const successful = results.filter(r => r.result.success).length;
  const failed = results.length - successful;
  const totalTime = results.reduce((sum, r) => sum + r.executionTimeMs, 0);

  let summary = `Executed ${results.length} tool(s): ${successful} succeeded, ${failed} failed (${totalTime}ms total)`;

  if (failed > 0) {
    const errors = results
      .filter(r => !r.result.success)
      .map(r => `- ${r.toolCall.name}: ${r.result.error?.message}`)
      .join('\n');
    summary += `\n\nErrors:\n${errors}`;
  }

  return summary;
}
