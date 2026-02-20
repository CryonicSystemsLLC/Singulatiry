/**
 * Executor Agent
 *
 * Executes tasks from task graphs, handles tool calls, manages state,
 * and provides error recovery and rollback capabilities.
 */

import {
  ExecutorAgent,
  Task,
  TaskGraph,
  TaskResult,
  TaskError,
  ExecutionContext,
  ExecutionEvent,
  ExecutionEventType,
  ExecutionOptions,
  ExecutionResult,
  RollbackResult,
  topologicalSort,
  getTaskGraphStats
} from './types';
import { getModelService } from '../models/unified';
import { ModelId, Message } from '../models/types';
import { ToolRegistry, globalToolRegistry, ToolContext } from '../tools/registry';
import { registerCoreTools } from '../tools/core-tools';
import { getSecurityConfig } from '../tools/security';
import {
  executeToolCalls,
  toolResultsToMessages,
  ToolExecutionResult
} from '../models/tool-calling';

/**
 * System prompt for task execution
 */
const EXECUTOR_SYSTEM_PROMPT = `You are an expert software developer executing tasks in a development project. You have access to tools for reading files, writing files, running commands, and more.

When executing a task:
1. Analyze the task requirements carefully
2. Use tools to accomplish the task
3. Verify your work after each step
4. Handle errors gracefully and retry if appropriate
5. Report your progress and results clearly

Available tools will be provided to you. Use them by calling functions as instructed.

Always explain what you're about to do before calling tools, and summarize the results after.`;

/**
 * Executor Agent Implementation
 */
export class ExecutorAgentImpl implements ExecutorAgent {
  private model: ModelId;
  private toolRegistry: ToolRegistry;
  private cancelled = false;
  private paused = false;

  constructor(
    model: ModelId = 'anthropic:claude-3-5-sonnet',
    toolRegistry?: ToolRegistry
  ) {
    this.model = model;
    this.toolRegistry = toolRegistry || globalToolRegistry;

    // Register core tools if not already registered
    if (this.toolRegistry.size === 0) {
      registerCoreTools(this.toolRegistry);
    }
  }

  /**
   * Execute a single task
   */
  async executeTask(task: Task, context: ExecutionContext): Promise<TaskResult> {
    const modelService = getModelService();

    try {
      // Build the task prompt
      const taskPrompt = this.buildTaskPrompt(task, context);

      // Create tool context
      const toolContext: ToolContext = {
        projectRoot: context.projectRoot,
        securityConfig: context.securityConfig,
        env: context.env
      };

      // Initial request with tools
      const tools = this.toolRegistry.list();
      let messages: Message[] = [{ role: 'user', content: taskPrompt }];

      let response = await modelService.toolCall({
        model: task.model || this.model,
        systemPrompt: task.systemPrompt || EXECUTOR_SYSTEM_PROMPT,
        messages,
        tools,
        maxTokens: 8000,
        temperature: 0.3
      });

      // Tool execution loop
      let iterations = 0;
      const maxIterations = 10;
      const allToolCalls: ToolExecutionResult[] = [];
      const filesCreated: string[] = [];
      const filesModified: string[] = [];

      while (response.toolCalls?.length && iterations < maxIterations) {
        iterations++;

        // Execute tool calls
        const results = await executeToolCalls(
          response.toolCalls,
          this.toolRegistry,
          toolContext,
          {
            maxParallelExecutions: 3,
            timeout: context.securityConfig.maxExecutionTime
          }
        );

        allToolCalls.push(...results);

        // Track file operations
        for (const result of results) {
          if (result.result.success && result.result.data) {
            if (result.toolCall.name === 'write_file') {
              if (result.result.rollback?.type === 'delete_file') {
                filesCreated.push(result.result.data.path);
              } else {
                filesModified.push(result.result.data.path);
              }
            }
          }
        }

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.content
        });

        // Add tool results
        const resultMessages = toolResultsToMessages(results, 'openai');
        messages.push(...resultMessages);

        // Get next response
        response = await modelService.toolCall({
          model: task.model || this.model,
          systemPrompt: task.systemPrompt || EXECUTOR_SYSTEM_PROMPT,
          messages,
          tools,
          maxTokens: 8000,
          temperature: 0.3
        });
      }

      // Check for success
      const failedTools = allToolCalls.filter(tc => !tc.result.success);
      const success = failedTools.length === 0;

      // Build rollback actions from successful tool calls
      const rollbackActions = allToolCalls
        .filter(tc => tc.result.success && tc.result.rollback)
        .map(tc => tc.result.rollback!)
        .reverse(); // Reverse order for proper rollback

      // Store rollback actions on task
      task.rollbackActions = rollbackActions;

      return {
        success,
        data: {
          output: response.content,
          toolCallCount: allToolCalls.length,
          iterations
        },
        output: response.content,
        filesCreated,
        filesModified
      };
    } catch (error: any) {
      return {
        success: false,
        data: { error: error.message }
      };
    }
  }

  /**
   * Execute an entire task graph
   */
  async *executePlan(
    graph: TaskGraph,
    options: ExecutionOptions = {}
  ): AsyncGenerator<ExecutionEvent, ExecutionResult> {
    const {
      stopOnFailure = true,
      maxRetries = 3,
      parallelExecution: _parallelExecution = false,
      maxParallelTasks: _maxParallelTasks = 3,
      dryRun = false,
      onEvent
    } = options;
    // Note: parallelExecution and maxParallelTasks reserved for future use
    void _parallelExecution;
    void _maxParallelTasks;

    this.cancelled = false;
    this.paused = false;

    const startTime = Date.now();
    let totalTokensUsed = 0;
    let totalCost = 0;

    // Update graph status
    graph.status = 'in_progress';
    graph.updatedAt = new Date().toISOString();

    yield this.emitEvent('graph_started', undefined, { graph }, onEvent);

    // Create execution context
    const context: ExecutionContext = {
      projectRoot: graph.projectRoot,
      stack: graph.stack,
      env: process.env as Record<string, string>,
      previousResults: new Map(),
      securityConfig: getSecurityConfig(graph.config.securityMode)
    };

    // Get topologically sorted tasks
    const sortedTasks = topologicalSort(graph.tasks);

    // Execute tasks
    for (const task of sortedTasks) {
      // Check for cancellation
      if (this.cancelled) {
        yield this.emitEvent('graph_cancelled', undefined, {}, onEvent);
        break;
      }

      // Handle pause
      while (this.paused && !this.cancelled) {
        await this.sleep(100);
      }

      // Skip if already completed or dependencies failed
      if (graph.completedTasks.includes(task.id) ||
          graph.skippedTasks.includes(task.id)) {
        continue;
      }

      // Check dependencies
      const depsFailed = task.dependsOn.some(depId =>
        graph.failedTasks.includes(depId)
      );

      if (depsFailed && stopOnFailure) {
        task.status = 'skipped';
        graph.skippedTasks.push(task.id);
        yield this.emitEvent('task_skipped', task.id, {
          reason: 'Dependency failed'
        }, onEvent);
        continue;
      }

      // Execute the task
      graph.currentTaskId = task.id;
      task.status = 'in_progress';
      task.startedAt = new Date().toISOString();

      yield this.emitEvent('task_started', task.id, { task }, onEvent);

      let success = false;
      let lastError: TaskError | null = null;

      // Retry loop
      while (task.retryCount <= (task.maxRetries || maxRetries) && !success) {
        if (dryRun) {
          // Simulate execution
          success = true;
          task.result = {
            success: true,
            output: '[DRY RUN] Task would be executed',
            data: {}
          };
        } else {
          try {
            const result = await this.executeTask(task, context);
            task.result = result;
            success = result.success;

            if (!success) {
              lastError = {
                message: result.data?.error || 'Task failed',
                recoverable: task.retryCount < (task.maxRetries || maxRetries)
              };
              task.retryCount++;

              if (task.retryCount <= (task.maxRetries || maxRetries)) {
                yield this.emitEvent('task_retry', task.id, {
                  attempt: task.retryCount,
                  error: lastError
                }, onEvent);
              }
            }
          } catch (error: any) {
            lastError = {
              message: error.message || 'Unexpected error',
              stack: error.stack,
              recoverable: task.retryCount < (task.maxRetries || maxRetries)
            };
            task.retryCount++;
          }
        }
      }

      // Update task status
      task.completedAt = new Date().toISOString();
      task.executionTimeMs = Date.now() - new Date(task.startedAt).getTime();

      if (success) {
        task.status = 'completed';
        graph.completedTasks.push(task.id);
        context.previousResults.set(task.id, task.result!);

        yield this.emitEvent('task_completed', task.id, {
          result: task.result,
          executionTimeMs: task.executionTimeMs
        }, onEvent);
      } else {
        task.status = 'failed';
        task.error = lastError;
        graph.failedTasks.push(task.id);

        yield this.emitEvent('task_failed', task.id, {
          error: lastError
        }, onEvent);

        if (stopOnFailure) {
          // Rollback completed tasks
          await this.rollback(graph, task.id);
          graph.status = 'failed';

          yield this.emitEvent('graph_failed', undefined, {
            failedTaskId: task.id,
            error: lastError
          }, onEvent);

          break;
        }
      }
    }

    // Final status
    if (!this.cancelled && graph.status !== 'failed') {
      graph.status = 'completed';
      yield this.emitEvent('graph_completed', undefined, {
        stats: getTaskGraphStats(graph)
      }, onEvent);
    }

    // Calculate final metrics
    graph.executionTimeMs = Date.now() - startTime;
    graph.totalTokensUsed = totalTokensUsed;
    graph.totalCost = totalCost;
    graph.updatedAt = new Date().toISOString();

    const stats = getTaskGraphStats(graph);

    return {
      success: graph.status === 'completed',
      taskGraph: graph,
      completedTasks: stats.completed,
      failedTasks: stats.failed,
      skippedTasks: stats.skipped,
      totalTimeMs: graph.executionTimeMs,
      totalTokensUsed,
      totalCost,
      errors: graph.tasks
        .filter(t => t.error)
        .map(t => t.error!)
    };
  }

  /**
   * Cancel running execution
   */
  async cancel(): Promise<void> {
    this.cancelled = true;
  }

  /**
   * Pause execution
   */
  async pause(): Promise<void> {
    this.paused = true;
  }

  /**
   * Resume paused execution
   */
  async resume(): Promise<void> {
    this.paused = false;
  }

  /**
   * Rollback completed tasks
   */
  async rollback(graph: TaskGraph, toTaskId?: string): Promise<RollbackResult> {
    const rolledBackTasks: string[] = [];
    const errors: string[] = [];

    // Get tasks to rollback (in reverse completion order)
    let tasksToRollback = graph.tasks.filter(t =>
      graph.completedTasks.includes(t.id) &&
      t.rollbackActions.length > 0
    );

    // If toTaskId specified, only rollback tasks completed after it
    if (toTaskId) {
      const targetIndex = graph.completedTasks.indexOf(toTaskId);
      if (targetIndex !== -1) {
        const tasksAfter = graph.completedTasks.slice(targetIndex + 1);
        tasksToRollback = tasksToRollback.filter(t =>
          tasksAfter.includes(t.id)
        );
      }
    }

    // Reverse order for proper rollback
    tasksToRollback.reverse();

    const fs = await import('node:fs/promises');

    for (const task of tasksToRollback) {
      for (const action of task.rollbackActions) {
        try {
          switch (action.type) {
            case 'restore_file':
              if (action.backup) {
                const content = await fs.readFile(action.backup, 'utf-8');
                await fs.writeFile(action.path!, content);
                await fs.unlink(action.backup);
              }
              break;

            case 'delete_file':
              await fs.unlink(action.path!);
              break;

            case 'delete_directory':
              await fs.rm(action.path!, { recursive: true });
              break;

            case 'run_command':
              const { exec } = await import('node:child_process');
              const { promisify } = await import('node:util');
              const execAsync = promisify(exec);
              await execAsync(action.command!, { cwd: graph.projectRoot });
              break;
          }
        } catch (error: any) {
          errors.push(`Failed to rollback ${task.id}: ${error.message}`);
        }
      }

      rolledBackTasks.push(task.id);
    }

    return {
      success: errors.length === 0,
      rolledBackTasks,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Build the prompt for a specific task
   */
  private buildTaskPrompt(task: Task, context: ExecutionContext): string {
    let prompt = `Execute the following task:

**Task Type:** ${task.type}
**Task Name:** ${task.name}
**Description:** ${task.description}

**Project Root:** ${context.projectRoot}
**Stack:** ${context.stack.name}
`;

    // Add previous task results if relevant
    if (task.dependsOn.length > 0) {
      prompt += `\n**Previous Task Results:**\n`;
      for (const depId of task.dependsOn) {
        const result = context.previousResults.get(depId);
        if (result) {
          prompt += `- ${depId}: ${result.success ? 'Success' : 'Failed'}\n`;
          if (result.output) {
            prompt += `  Output: ${result.output.substring(0, 500)}...\n`;
          }
        }
      }
    }

    // Add task-specific metadata
    if (task.metadata) {
      prompt += `\n**Additional Context:**\n${JSON.stringify(task.metadata, null, 2)}\n`;
    }

    prompt += `
Please complete this task using the available tools. After completing the task, summarize what you did and the results.`;

    return prompt;
  }

  /**
   * Emit an execution event
   */
  private emitEvent(
    type: ExecutionEventType,
    taskId: string | undefined,
    data: any,
    onEvent?: (event: ExecutionEvent) => void
  ): ExecutionEvent {
    const event: ExecutionEvent = {
      type,
      timestamp: new Date().toISOString(),
      taskId,
      data
    };

    onEvent?.(event);
    return event;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create an executor agent instance
 */
export function createExecutorAgent(
  model?: ModelId,
  toolRegistry?: ToolRegistry
): ExecutorAgent {
  return new ExecutorAgentImpl(model, toolRegistry);
}

export default ExecutorAgentImpl;
