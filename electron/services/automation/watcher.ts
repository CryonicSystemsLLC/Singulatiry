/**
 * File System Watcher
 *
 * Watches for file changes and triggers automation actions.
 */

import { watch, FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type {
  Trigger,
  TriggerType,
  TriggerContext,
  TriggerExecutionResult,
  TriggerAction
} from './triggers';
import { evaluateConditions, interpolateParams, BUILTIN_TRIGGERS } from './triggers';

export interface WatcherConfig {
  projectRoot: string;
  recursive: boolean;
  ignoredPatterns: string[];
  debounceMs: number;
}

export interface FileChange {
  type: 'change' | 'rename';
  path: string;
  timestamp: Date;
}

const DEFAULT_CONFIG: WatcherConfig = {
  projectRoot: process.cwd(),
  recursive: true,
  ignoredPatterns: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/*.log',
    '**/.env*'
  ],
  debounceMs: 300
};

/**
 * Automation Watcher
 */
export class AutomationWatcher extends EventEmitter {
  private config: WatcherConfig;
  private triggers: Map<string, Trigger> = new Map();
  private watchers: FSWatcher[] = [];
  private fileCache: Map<string, string> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private running = false;

  constructor(config: Partial<WatcherConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Load built-in triggers
    for (const trigger of BUILTIN_TRIGGERS) {
      this.triggers.set(trigger.id, { ...trigger });
    }
  }

  /**
   * Start watching
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    try {
      const watcher = watch(
        this.config.projectRoot,
        { recursive: this.config.recursive },
        (eventType, filename) => {
          if (filename) {
            this.handleFileEvent(eventType as 'change' | 'rename', filename);
          }
        }
      );

      watcher.on('error', (err) => {
        this.emit('error', err);
      });

      this.watchers.push(watcher);
      this.emit('started');
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    // Clear debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.emit('stopped');
  }

  /**
   * Handle file system event
   */
  private handleFileEvent(eventType: 'change' | 'rename', filename: string): void {
    const fullPath = path.join(this.config.projectRoot, filename);

    // Check ignored patterns
    if (this.isIgnored(fullPath)) {
      return;
    }

    // Debounce
    const existingTimer = this.debounceTimers.get(fullPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(fullPath);
      this.processFileChange(eventType, fullPath);
    }, this.config.debounceMs);

    this.debounceTimers.set(fullPath, timer);
  }

  /**
   * Check if path should be ignored
   */
  private isIgnored(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');

    return this.config.ignoredPatterns.some(pattern => {
      const normalizedPattern = pattern.replace(/\\/g, '/');
      const regexPattern = normalizedPattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '{{DOUBLE_STAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/{{DOUBLE_STAR}}/g, '.*');

      try {
        return new RegExp(regexPattern).test(normalizedPath);
      } catch {
        return false;
      }
    });
  }

  /**
   * Process a file change
   */
  private async processFileChange(eventType: 'change' | 'rename', filePath: string): Promise<void> {
    const triggerType: TriggerType = eventType === 'change' ? 'file_save' : 'file_create';

    // Get file content
    let fileContent: string | undefined;
    let previousContent: string | undefined;

    try {
      fileContent = await readFile(filePath, 'utf-8');
      previousContent = this.fileCache.get(filePath);
      this.fileCache.set(filePath, fileContent);
    } catch {
      // File might have been deleted
      if (eventType === 'rename') {
        this.fileCache.delete(filePath);
      }
    }

    // Build context
    const context: TriggerContext = {
      type: triggerType,
      filePath,
      fileContent,
      previousContent,
      projectRoot: this.config.projectRoot
    };

    // Check for schema change
    if (filePath.endsWith('schema.prisma')) {
      context.type = 'schema_change';
    }

    // Check for dependency change
    if (filePath.endsWith('package.json')) {
      context.type = 'dependency_change';
    }

    this.emit('file:change', { type: eventType, path: filePath });

    // Execute matching triggers
    await this.executeTriggers(context);
  }

  /**
   * Execute matching triggers for a context
   */
  async executeTriggers(context: TriggerContext): Promise<TriggerExecutionResult[]> {
    const results: TriggerExecutionResult[] = [];

    for (const trigger of this.triggers.values()) {
      // Skip disabled triggers
      if (!trigger.enabled) continue;

      // Check event type match
      if (trigger.event !== context.type && trigger.event !== 'manual') continue;

      // Check max executions
      if (trigger.maxExecutions && (trigger.executionCount || 0) >= trigger.maxExecutions) {
        continue;
      }

      // Evaluate conditions
      if (!evaluateConditions(trigger.conditions, context)) continue;

      // Apply debounce
      if (trigger.debounce) {
        const lastExec = trigger.lastExecuted?.getTime() || 0;
        if (Date.now() - lastExec < trigger.debounce) {
          continue;
        }
      }

      // Execute trigger
      const result = await this.executeTrigger(trigger, context);
      results.push(result);

      // Update trigger state
      trigger.lastExecuted = new Date();
      trigger.executionCount = (trigger.executionCount || 0) + 1;

      this.emit('trigger:executed', { trigger, result });
    }

    return results;
  }

  /**
   * Execute a single trigger
   */
  private async executeTrigger(
    trigger: Trigger,
    context: TriggerContext
  ): Promise<TriggerExecutionResult> {
    const startTime = Date.now();
    const actionResults: TriggerExecutionResult['actionResults'] = [];

    for (const action of trigger.actions) {
      try {
        const result = await this.executeAction(action, context);
        actionResults.push(result);
      } catch (error: any) {
        actionResults.push({
          actionName: action.name,
          success: false,
          error: error.message
        });
      }
    }

    return {
      triggerId: trigger.id,
      success: actionResults.every(r => r.success),
      actionsExecuted: actionResults.length,
      actionResults,
      executionTimeMs: Date.now() - startTime
    };
  }

  /**
   * Execute a trigger action
   */
  private async executeAction(
    action: TriggerAction,
    context: TriggerContext
  ): Promise<TriggerExecutionResult['actionResults'][0]> {
    const params = action.params ? interpolateParams(action.params, context) : {};

    switch (action.type) {
      case 'command':
        return this.executeCommand(action.name, params.command, action.timeout);

      case 'notify':
        this.emit('notification', {
          title: action.name,
          message: params.message
        });
        return { actionName: action.name, success: true };

      case 'tool':
        // Tool execution would integrate with the tool registry
        this.emit('tool:request', { tool: params.tool, context: params.context });
        return { actionName: action.name, success: true };

      case 'recipe':
        // Recipe execution would integrate with the recipe executor
        this.emit('recipe:request', { recipeId: params.recipeId });
        return { actionName: action.name, success: true };

      case 'custom':
        // Custom actions would be handled by registered handlers
        this.emit('custom:action', { action, params });
        return { actionName: action.name, success: true };

      default:
        return {
          actionName: action.name,
          success: false,
          error: `Unknown action type: ${action.type}`
        };
    }
  }

  /**
   * Execute a command action
   */
  private async executeCommand(
    name: string,
    command: string,
    timeout = 30000
  ): Promise<TriggerExecutionResult['actionResults'][0]> {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.config.projectRoot,
        timeout
      });

      return {
        actionName: name,
        success: true,
        output: stdout + (stderr ? '\n' + stderr : '')
      };
    } catch (error: any) {
      return {
        actionName: name,
        success: false,
        error: error.message,
        output: error.stdout || error.stderr
      };
    }
  }

  /**
   * Add a custom trigger
   */
  addTrigger(trigger: Trigger): void {
    this.triggers.set(trigger.id, trigger);
    this.emit('trigger:added', { triggerId: trigger.id });
  }

  /**
   * Remove a trigger
   */
  removeTrigger(triggerId: string): boolean {
    const removed = this.triggers.delete(triggerId);
    if (removed) {
      this.emit('trigger:removed', { triggerId });
    }
    return removed;
  }

  /**
   * Enable/disable a trigger
   */
  setTriggerEnabled(triggerId: string, enabled: boolean): boolean {
    const trigger = this.triggers.get(triggerId);
    if (trigger) {
      trigger.enabled = enabled;
      this.emit('trigger:updated', { triggerId, enabled });
      return true;
    }
    return false;
  }

  /**
   * Get all triggers
   */
  getTriggers(): Trigger[] {
    return Array.from(this.triggers.values());
  }

  /**
   * Get a specific trigger
   */
  getTrigger(triggerId: string): Trigger | undefined {
    return this.triggers.get(triggerId);
  }

  /**
   * Manually trigger an event
   */
  async triggerEvent(
    type: TriggerType,
    metadata?: Record<string, any>
  ): Promise<TriggerExecutionResult[]> {
    const context: TriggerContext = {
      type,
      projectRoot: this.config.projectRoot,
      metadata
    };

    return this.executeTriggers(context);
  }
}

// Singleton instance
let watcherInstance: AutomationWatcher | null = null;

export function getAutomationWatcher(config?: Partial<WatcherConfig>): AutomationWatcher {
  if (!watcherInstance) {
    watcherInstance = new AutomationWatcher(config);
  } else if (config) {
    // Update config if provided
    Object.assign(watcherInstance['config'], config);
  }
  return watcherInstance;
}

export default AutomationWatcher;
