/**
 * Agent Types - Core interfaces for the agentic system
 *
 * Defines the TaskGraph, Tasks, and execution flow structures.
 */

import { ModelId } from '../models/types';
import { SecurityConfig } from '../tools/security';

// ============================================================================
// Task Graph Types
// ============================================================================

/**
 * A task graph represents a complete plan of execution
 */
export interface TaskGraph {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;

  // Status
  status: TaskGraphStatus;

  // Project context
  projectRoot: string;
  projectName: string;
  stack: StackConfig;

  // Task DAG
  tasks: Task[];

  // Execution state
  currentTaskId: string | null;
  completedTasks: string[];
  failedTasks: string[];
  skippedTasks: string[];

  // Telemetry
  totalTokensUsed: number;
  totalCost: number;
  executionTimeMs: number;

  // Configuration
  config: TaskGraphConfig;
}

export type TaskGraphStatus =
  | 'pending'
  | 'planning'
  | 'ready'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskGraphConfig {
  maxRetries: number;
  stopOnFailure: boolean;
  parallelExecution: boolean;
  maxParallelTasks: number;
  securityMode: 'pro' | 'kid';
}

// ============================================================================
// Task Types
// ============================================================================

/**
 * A single task within a task graph
 */
export interface Task {
  id: string;
  type: TaskType;
  name: string;
  description: string;
  status: TaskStatus;

  // Dependencies (DAG edges)
  dependsOn: string[]; // Task IDs that must complete first

  // Execution details
  toolCalls: TaskToolCall[];
  result: TaskResult | null;
  error: TaskError | null;

  // Timing
  startedAt?: string;
  completedAt?: string;
  executionTimeMs?: number;

  // Retry configuration
  maxRetries: number;
  retryCount: number;

  // Rollback capability
  rollbackActions: RollbackAction[];

  // Model configuration
  model?: ModelId;
  systemPrompt?: string;

  // Task-specific data
  metadata?: Record<string, any>;
}

export type TaskType =
  // Project setup
  | 'choose_stack'
  | 'scaffold_project'
  | 'configure_environment'

  // Database
  | 'design_schema'
  | 'create_migration'
  | 'apply_migration'
  | 'seed_data'

  // Code generation
  | 'generate_backend'
  | 'generate_frontend'
  | 'generate_component'
  | 'generate_api_route'
  | 'generate_test'

  // Code modification
  | 'edit_file'
  | 'refactor_code'
  | 'fix_error'
  | 'add_feature'

  // Build & Run
  | 'install_dependencies'
  | 'run_build'
  | 'run_tests'
  | 'start_dev_server'
  | 'run_command'

  // Analysis
  | 'analyze_code'
  | 'review_changes'
  | 'explain_code'

  // Custom
  | 'custom';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface TaskToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, any>;
  result?: any;
  error?: string;
  executionTimeMs?: number;
}

export interface TaskResult {
  success: boolean;
  data?: any;
  output?: string;
  filesCreated?: string[];
  filesModified?: string[];
  filesDeleted?: string[];
}

export interface TaskError {
  message: string;
  code?: string;
  stack?: string;
  recoverable: boolean;
  suggestedFix?: string;
}

export interface RollbackAction {
  type: 'restore_file' | 'delete_file' | 'delete_directory' | 'run_command';
  path?: string;
  backup?: string;
  command?: string;
  description?: string;
}

// ============================================================================
// Stack Configuration Types
// ============================================================================

export interface StackConfig {
  id: string;
  name: string;
  description: string;

  // Technology choices
  frontend: {
    framework: 'next' | 'react' | 'vue' | 'svelte' | 'none';
    styling: 'tailwind' | 'css-modules' | 'styled-components' | 'none';
    stateManagement?: 'zustand' | 'redux' | 'jotai' | 'none';
  };

  backend: {
    runtime: 'node' | 'python' | 'go' | 'none';
    framework: 'next-api' | 'express' | 'fastapi' | 'hono' | 'none';
    auth?: 'next-auth' | 'lucia' | 'clerk' | 'none';
  };

  database: {
    type: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'none';
    orm: 'prisma' | 'drizzle' | 'typeorm' | 'sqlalchemy' | 'none';
  };

  // Folder structure template
  structure: FolderStructure;

  // Commands
  commands: StackCommands;

  // Port configuration
  ports: {
    dev: number;
    database?: number;
  };

  // File templates
  templates?: Record<string, string>;
}

export interface FolderStructure {
  [key: string]: FolderStructure | string;
}

export interface StackCommands {
  install: string;
  dev: string;
  build: string;
  test: string;
  migrate?: string;
  seed?: string;
  lint?: string;
  format?: string;
}

// ============================================================================
// Execution Event Types
// ============================================================================

export interface ExecutionEvent {
  type: ExecutionEventType;
  timestamp: string;
  taskId?: string;
  data: any;
}

export type ExecutionEventType =
  // Graph-level events
  | 'graph_started'
  | 'graph_paused'
  | 'graph_resumed'
  | 'graph_completed'
  | 'graph_failed'
  | 'graph_cancelled'

  // Task-level events
  | 'task_queued'
  | 'task_started'
  | 'task_progress'
  | 'task_completed'
  | 'task_failed'
  | 'task_skipped'
  | 'task_retry'

  // Tool-level events
  | 'tool_started'
  | 'tool_completed'
  | 'tool_failed'

  // Other events
  | 'message'
  | 'warning'
  | 'error';

// ============================================================================
// Plan Request/Response Types
// ============================================================================

export interface PlanRequest {
  userRequest: string;
  projectContext?: ProjectContext;
  constraints?: PlanConstraints;
  preferredStack?: string;
}

export interface ProjectContext {
  projectRoot?: string;
  existingFiles?: string[];
  existingDependencies?: Record<string, string>;
  gitStatus?: string;
  recentErrors?: string[];
}

export interface PlanConstraints {
  allowedStacks?: string[];
  allowedTaskTypes?: TaskType[];
  maxTasks?: number;
  securityConfig?: SecurityConfig;
  budget?: {
    maxTokens?: number;
    maxCost?: number;
  };
}

export interface PlanResult {
  success: boolean;
  taskGraph?: TaskGraph;
  error?: string;
  warnings?: string[];
  tokensUsed?: number;
  cost?: number;
}

// ============================================================================
// Execution Options Types
// ============================================================================

export interface ExecutionOptions {
  stopOnFailure?: boolean;
  maxRetries?: number;
  parallelExecution?: boolean;
  maxParallelTasks?: number;
  dryRun?: boolean;
  onEvent?: (event: ExecutionEvent) => void;
}

export interface ExecutionResult {
  success: boolean;
  taskGraph: TaskGraph;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  totalTimeMs: number;
  totalTokensUsed: number;
  totalCost: number;
  errors?: TaskError[];
}

// ============================================================================
// Agent Interfaces
// ============================================================================

export interface PlannerAgent {
  /**
   * Create a plan from natural language request
   */
  createPlan(request: PlanRequest): Promise<PlanResult>;

  /**
   * Refine an existing plan based on feedback
   */
  refinePlan(graph: TaskGraph, feedback: string): Promise<PlanResult>;

  /**
   * Validate a plan for feasibility
   */
  validatePlan(graph: TaskGraph): Promise<ValidationResult>;

  /**
   * Estimate resources needed for a plan
   */
  estimatePlan(graph: TaskGraph): Promise<PlanEstimate>;
}

export interface ExecutorAgent {
  /**
   * Execute a single task
   */
  executeTask(task: Task, context: ExecutionContext): Promise<TaskResult>;

  /**
   * Execute an entire task graph
   */
  executePlan(
    graph: TaskGraph,
    options?: ExecutionOptions
  ): AsyncGenerator<ExecutionEvent, ExecutionResult>;

  /**
   * Cancel running execution
   */
  cancel(): Promise<void>;

  /**
   * Pause execution
   */
  pause(): Promise<void>;

  /**
   * Resume paused execution
   */
  resume(): Promise<void>;

  /**
   * Rollback completed tasks
   */
  rollback(graph: TaskGraph, toTaskId?: string): Promise<RollbackResult>;
}

export interface ExecutionContext {
  projectRoot: string;
  stack: StackConfig;
  env: Record<string, string>;
  previousResults: Map<string, TaskResult>;
  securityConfig: SecurityConfig;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PlanEstimate {
  estimatedTasks: number;
  estimatedTokens: number;
  estimatedCost: number;
  estimatedTimeMinutes: number;
  risks: string[];
}

export interface RollbackResult {
  success: boolean;
  rolledBackTasks: string[];
  errors?: string[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique ID
 */
export function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Create an empty task graph
 */
export function createEmptyTaskGraph(
  name: string,
  projectRoot: string,
  stack: StackConfig
): TaskGraph {
  return {
    id: generateId('graph'),
    name,
    description: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'pending',
    projectRoot,
    projectName: name,
    stack,
    tasks: [],
    currentTaskId: null,
    completedTasks: [],
    failedTasks: [],
    skippedTasks: [],
    totalTokensUsed: 0,
    totalCost: 0,
    executionTimeMs: 0,
    config: {
      maxRetries: 3,
      stopOnFailure: true,
      parallelExecution: false,
      maxParallelTasks: 3,
      securityMode: 'pro'
    }
  };
}

/**
 * Create a new task
 */
export function createTask(
  type: TaskType,
  name: string,
  description: string,
  dependsOn: string[] = []
): Task {
  return {
    id: generateId('task'),
    type,
    name,
    description,
    status: 'pending',
    dependsOn,
    toolCalls: [],
    result: null,
    error: null,
    maxRetries: 3,
    retryCount: 0,
    rollbackActions: []
  };
}

/**
 * Get tasks that are ready to execute (all dependencies completed)
 */
export function getReadyTasks(graph: TaskGraph): Task[] {
  return graph.tasks.filter(task => {
    if (task.status !== 'pending') return false;

    return task.dependsOn.every(depId =>
      graph.completedTasks.includes(depId) ||
      graph.skippedTasks.includes(depId)
    );
  });
}

/**
 * Topologically sort tasks
 */
export function topologicalSort(tasks: Task[]): Task[] {
  const sorted: Task[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const taskMap = new Map(tasks.map(t => [t.id, t]));

  function visit(taskId: string): void {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      throw new Error(`Circular dependency detected: ${taskId}`);
    }

    visiting.add(taskId);
    const task = taskMap.get(taskId);

    if (task) {
      for (const depId of task.dependsOn) {
        visit(depId);
      }
      sorted.push(task);
    }

    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of tasks) {
    visit(task.id);
  }

  return sorted;
}

/**
 * Calculate task graph statistics
 */
export function getTaskGraphStats(graph: TaskGraph): {
  total: number;
  pending: number;
  completed: number;
  failed: number;
  skipped: number;
  inProgress: number;
  progress: number;
} {
  const total = graph.tasks.length;
  const completed = graph.completedTasks.length;
  const failed = graph.failedTasks.length;
  const skipped = graph.skippedTasks.length;
  const inProgress = graph.tasks.filter(t => t.status === 'in_progress').length;
  const pending = total - completed - failed - skipped - inProgress;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { total, pending, completed, failed, skipped, inProgress, progress };
}
