/**
 * Recipe Executor
 *
 * Executes recipe steps with variable substitution and rollback support.
 */

import { readFile, writeFile, unlink, mkdir, access, rename } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type {
  Recipe,
  RecipeStep,
  RecipeExecutionContext,
  RecipeExecutionResult,
  RecipeStepResult,
  FileCreateConfig,
  FileModifyConfig,
  FileDeleteConfig,
  CommandConfig
} from './types';

const execAsync = promisify(exec);

/**
 * Replace template variables in a string
 */
function replaceVariables(template: string, variables: Record<string, any>): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, String(value));
  }

  // Handle nested property access like {{user.name}}
  const nestedRegex = /\{\{(\w+)\.(\w+)\}\}/g;
  result = result.replace(nestedRegex, (_, obj, prop) => {
    if (variables[obj] && typeof variables[obj] === 'object') {
      return String(variables[obj][prop] || '');
    }
    return '';
  });

  return result;
}

/**
 * Evaluate a condition string
 */
function evaluateCondition(condition: string, context: RecipeExecutionContext): boolean {
  if (!condition) return true;

  try {
    // Create a safe evaluation context
    const evalContext = {
      params: context.parameters,
      vars: context.variables,
      stack: context.stackId
    };

    // Simple condition evaluation (not using eval for security)
    // Supports: param === 'value', param !== 'value', param, !param
    const trimmed = condition.trim();

    // Check for equality
    const eqMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*===?\s*['"]?([^'"]+)['"]?$/);
    if (eqMatch) {
      const [, path, value] = eqMatch;
      const actual = getNestedValue(evalContext, path);
      return String(actual) === value;
    }

    // Check for inequality
    const neqMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*!==?\s*['"]?([^'"]+)['"]?$/);
    if (neqMatch) {
      const [, path, value] = neqMatch;
      const actual = getNestedValue(evalContext, path);
      return String(actual) !== value;
    }

    // Check for truthy with negation
    if (trimmed.startsWith('!')) {
      const path = trimmed.slice(1).trim();
      return !getNestedValue(evalContext, path);
    }

    // Check for truthy
    return !!getNestedValue(evalContext, trimmed);
  } catch {
    return true; // Default to true if condition can't be evaluated
  }
}

/**
 * Get nested value from object
 */
function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Recipe Executor Class
 */
export class RecipeExecutor {
  private backups: Map<string, string> = new Map();

  /**
   * Execute a recipe
   */
  async execute(
    recipe: Recipe,
    context: RecipeExecutionContext
  ): Promise<RecipeExecutionResult> {
    const startTime = Date.now();
    const result: RecipeExecutionResult = {
      success: true,
      recipe: recipe.id,
      filesCreated: [],
      filesModified: [],
      filesDeleted: [],
      commandsRun: [],
      errors: [],
      warnings: [],
      executionTimeMs: 0
    };

    // Merge parameters into variables
    const variables: Record<string, any> = {
      ...context.variables,
      ...context.parameters,
      projectRoot: context.projectRoot,
      stackId: context.stackId
    };

    try {
      // Execute each step
      for (const step of recipe.steps) {
        // Check condition
        if (step.condition && !evaluateCondition(step.condition, context)) {
          continue;
        }

        const stepResult = await this.executeStep(step, {
          ...context,
          variables
        });

        if (!stepResult.success) {
          result.success = false;
          result.errors.push(stepResult.error || `Step ${step.id} failed`);

          // Attempt rollback
          if (!context.dryRun) {
            await this.rollback();
          }
          break;
        }

        // Track affected files
        if (stepResult.filesAffected) {
          switch (step.type) {
            case 'file_create':
              result.filesCreated.push(...stepResult.filesAffected);
              break;
            case 'file_modify':
              result.filesModified.push(...stepResult.filesAffected);
              break;
            case 'file_delete':
              result.filesDeleted.push(...stepResult.filesAffected);
              break;
          }
        }

        if (step.type === 'command') {
          result.commandsRun.push((step.config as CommandConfig).command);
        }
      }
    } catch (error: any) {
      result.success = false;
      result.errors.push(error.message);

      if (!context.dryRun) {
        await this.rollback();
      }
    }

    result.executionTimeMs = Date.now() - startTime;

    // Clear backups on success
    if (result.success) {
      this.clearBackups();
    }

    return result;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: RecipeStep,
    context: RecipeExecutionContext
  ): Promise<RecipeStepResult> {
    const result: RecipeStepResult = {
      stepId: step.id,
      success: true
    };

    try {
      switch (step.type) {
        case 'file_create':
          await this.executeFileCreate(step.config as FileCreateConfig, context);
          result.filesAffected = [replaceVariables((step.config as FileCreateConfig).path, context.variables)];
          break;

        case 'file_modify':
          await this.executeFileModify(step.config as FileModifyConfig, context);
          result.filesAffected = [replaceVariables((step.config as FileModifyConfig).path, context.variables)];
          break;

        case 'file_delete':
          await this.executeFileDelete(step.config as FileDeleteConfig, context);
          result.filesAffected = [replaceVariables((step.config as FileDeleteConfig).path, context.variables)];
          break;

        case 'command':
          result.output = await this.executeCommand(step.config as CommandConfig, context);
          break;

        case 'prompt':
          // Prompt steps require AI integration - skip in basic executor
          result.output = 'Prompt step skipped (requires AI integration)';
          break;
      }
    } catch (error: any) {
      result.success = false;
      result.error = error.message;
    }

    return result;
  }

  /**
   * Create a new file
   */
  private async executeFileCreate(
    config: FileCreateConfig,
    context: RecipeExecutionContext
  ): Promise<void> {
    if (context.dryRun) return;

    const filePath = path.join(
      context.projectRoot,
      replaceVariables(config.path, context.variables)
    );

    // Check if file exists
    try {
      await access(filePath);
      if (!config.overwrite) {
        throw new Error(`File already exists: ${filePath}`);
      }
      // Backup existing file
      await this.backupFile(filePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Ensure directory exists
    await mkdir(path.dirname(filePath), { recursive: true });

    // Write file
    const content = replaceVariables(config.template, context.variables);
    await writeFile(filePath, content);
  }

  /**
   * Modify an existing file
   */
  private async executeFileModify(
    config: FileModifyConfig,
    context: RecipeExecutionContext
  ): Promise<void> {
    if (context.dryRun) return;

    const filePath = path.join(
      context.projectRoot,
      replaceVariables(config.path, context.variables)
    );

    // Read existing content
    let content = await readFile(filePath, 'utf-8');

    // Backup
    await this.backupFile(filePath);

    // Apply modifications
    for (const mod of config.modifications) {
      const modContent = replaceVariables(mod.content, context.variables);
      const target = mod.target ? replaceVariables(mod.target, context.variables) : undefined;

      switch (mod.type) {
        case 'append':
          content += '\n' + modContent;
          break;

        case 'prepend':
          content = modContent + '\n' + content;
          break;

        case 'insert_before':
          if (target) {
            content = content.replace(target, modContent + '\n' + target);
          }
          break;

        case 'insert_after':
          if (target) {
            content = content.replace(target, target + '\n' + modContent);
          }
          break;

        case 'replace':
          if (target) {
            content = content.replace(new RegExp(target, 'g'), modContent);
          }
          break;
      }
    }

    await writeFile(filePath, content);
  }

  /**
   * Delete a file
   */
  private async executeFileDelete(
    config: FileDeleteConfig,
    context: RecipeExecutionContext
  ): Promise<void> {
    if (context.dryRun) return;

    const filePath = path.join(
      context.projectRoot,
      replaceVariables(config.path, context.variables)
    );

    // Backup before deleting
    await this.backupFile(filePath);

    await unlink(filePath);
  }

  /**
   * Execute a command
   */
  private async executeCommand(
    config: CommandConfig,
    context: RecipeExecutionContext
  ): Promise<string> {
    if (context.dryRun) return `[Dry run] Would execute: ${config.command}`;

    const cwd = config.cwd
      ? path.join(context.projectRoot, replaceVariables(config.cwd, context.variables))
      : context.projectRoot;

    const command = replaceVariables(config.command, context.variables);

    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: config.timeout || 60000
    });

    return stdout + (stderr ? '\n' + stderr : '');
  }

  /**
   * Backup a file for rollback
   */
  private async backupFile(filePath: string): Promise<void> {
    try {
      const backupPath = filePath + '.recipe-backup';
      await rename(filePath, backupPath);
      // Copy back the original
      const content = await readFile(backupPath, 'utf-8');
      await writeFile(filePath, content);
      this.backups.set(filePath, backupPath);
    } catch {
      // File doesn't exist, no backup needed
    }
  }

  /**
   * Rollback all changes
   */
  async rollback(): Promise<void> {
    for (const [original, backup] of this.backups) {
      try {
        // Delete the modified file
        await unlink(original).catch(() => {});
        // Restore from backup
        await rename(backup, original);
      } catch {
        // Best effort rollback
      }
    }
    this.backups.clear();
  }

  /**
   * Clear backups (on success)
   */
  private clearBackups(): void {
    for (const [, backup] of this.backups) {
      unlink(backup).catch(() => {});
    }
    this.backups.clear();
  }
}

/**
 * Recipe Registry Implementation
 */
export class RecipeRegistryImpl {
  private recipes: Map<string, Recipe> = new Map();

  register(recipe: Recipe): void {
    this.recipes.set(recipe.id, recipe);
  }

  unregister(recipeId: string): boolean {
    return this.recipes.delete(recipeId);
  }

  get(recipeId: string): Recipe | undefined {
    return this.recipes.get(recipeId);
  }

  list(category?: string): Recipe[] {
    const all = Array.from(this.recipes.values());
    if (!category) return all;
    return all.filter(r => r.category === category);
  }

  findCompatible(stackId: string): Recipe[] {
    return Array.from(this.recipes.values()).filter(
      r => r.compatibleStacks.includes('*') || r.compatibleStacks.includes(stackId)
    );
  }

  search(query: string): Recipe[] {
    const lower = query.toLowerCase();
    return Array.from(this.recipes.values()).filter(
      r =>
        r.name.toLowerCase().includes(lower) ||
        r.description.toLowerCase().includes(lower) ||
        r.tags.some(t => t.toLowerCase().includes(lower))
    );
  }
}

// Singleton registry
export const recipeRegistry = new RecipeRegistryImpl();

// Export executor factory
export function createRecipeExecutor(): RecipeExecutor {
  return new RecipeExecutor();
}

export default RecipeExecutor;
