/**
 * IPC Type Definitions
 *
 * TypeScript declarations for the APIs exposed via preload.ts
 */

// Re-export types from electron services (for use in renderer)
export interface KeyMetadata {
  provider: string;
  lastUpdated: string;
  isValid?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ChatRequest {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ChatResponse {
  content: string;
  model: string;
  finishReason: string;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost?: number;
  };
}

export interface PlanRequest {
  userRequest: string;
  projectContext?: {
    projectRoot?: string;
    existingFiles?: string[];
    existingDependencies?: Record<string, string>;
  };
  preferredStack?: string;
  constraints?: {
    allowedStacks?: string[];
    maxTasks?: number;
    securityConfig?: any;
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

export interface TaskGraph {
  id: string;
  name: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  projectRoot: string;
  stack: StackConfig;
  config: {
    securityMode: 'pro' | 'kid';
    maxRetries: number;
    stopOnFailure: boolean;
  };
  tasks: Task[];
  currentTaskId: string | null;
  completedTasks: string[];
  failedTasks: string[];
  skippedTasks: string[];
  createdAt: string;
  updatedAt: string;
  executionTimeMs?: number;
  totalTokensUsed?: number;
  totalCost?: number;
}

export interface Task {
  id: string;
  type: TaskType;
  name: string;
  description: string;
  dependsOn: string[];
  status: 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  priority: number;
  maxRetries: number;
  retryCount: number;
  result?: TaskResult;
  error?: TaskError;
  rollbackActions: RollbackAction[];
  metadata?: Record<string, any>;
  model?: string;
  systemPrompt?: string;
  startedAt?: string;
  completedAt?: string;
  executionTimeMs?: number;
}

export type TaskType =
  | 'choose_stack'
  | 'scaffold_project'
  | 'configure_environment'
  | 'design_schema'
  | 'create_migration'
  | 'apply_migration'
  | 'seed_data'
  | 'generate_backend'
  | 'generate_frontend'
  | 'generate_component'
  | 'generate_api_route'
  | 'generate_test'
  | 'edit_file'
  | 'refactor_code'
  | 'fix_error'
  | 'add_feature'
  | 'install_dependencies'
  | 'run_build'
  | 'run_tests'
  | 'start_dev_server'
  | 'run_command'
  | 'analyze_code'
  | 'review_changes'
  | 'explain_code'
  | 'custom';

export interface TaskResult {
  success: boolean;
  data?: any;
  output?: string;
  filesCreated?: string[];
  filesModified?: string[];
}

export interface TaskError {
  message: string;
  code?: string;
  stack?: string;
  recoverable?: boolean;
}

export interface RollbackAction {
  type: 'restore_file' | 'delete_file' | 'delete_directory' | 'run_command';
  path?: string;
  backup?: string;
  command?: string;
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

export interface ModeConfig {
  id: 'pro' | 'kid';
  name: string;
  allowedStacks: string[];
  maxTasks: number;
  defaultModel: string;
}

export interface OrchestratorState {
  currentGraph: TaskGraph | null;
  isExecuting: boolean;
  isPaused: boolean;
  mode: ModeConfig;
}

export interface StackConfig {
  id: string;
  name: string;
  description: string;
  frontend: {
    framework: string;
    styling?: string;
    stateManagement?: string;
  };
  backend: {
    runtime: string;
    framework: string;
    auth?: string;
  };
  database: {
    type: string;
    orm?: string;
  };
  structure: Record<string, any>;
  commands: {
    install: string;
    dev: string;
    build: string;
    test?: string;
    migrate?: string;
    seed?: string;
    lint?: string;
    format?: string;
  };
  ports: {
    dev: number;
    database?: number;
  };
  templates?: Record<string, string>;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  capabilities: {
    streaming: boolean;
    toolCalling: boolean;
    vision: boolean;
    systemPrompt: boolean;
  };
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  authType: 'bearer' | 'api-key' | 'custom';
  headerName?: string;
  requiresKey: boolean;
}

// Window API declarations
declare global {
  interface Window {
    // Original IPC renderer
    ipcRenderer: {
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
      off: (channel: string, ...args: any[]) => void;
      send: (channel: string, ...args: any[]) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      removeListener: (channel: string, ...args: any[]) => void;
    };

    // Key Storage API
    keyStorage: {
      set: (provider: string, key: string) => Promise<boolean>;
      get: (provider: string) => Promise<string | null>;
      delete: (provider: string) => Promise<boolean>;
      list: () => Promise<string[]>;
      getMetadata: (provider: string) => Promise<KeyMetadata | null>;
    };

    // Model Service API
    modelService: {
      generate: (request: ChatRequest) => Promise<ChatResponse>;
      chat: (request: ChatRequest) => Promise<ChatResponse>;
      toolCall: (request: ChatRequest) => Promise<ChatResponse>;
      validateKey: (provider: string, apiKey: string) => Promise<boolean>;
      getModels: () => Promise<Record<string, ModelConfig>>;
      getProviders: () => Promise<Record<string, ProviderConfig>>;
    };

    // Agent Orchestrator API
    agent: {
      createPlan: (request: PlanRequest) => Promise<PlanResult>;
      refinePlan: (feedback: string) => Promise<PlanResult>;
      validatePlan: () => Promise<ValidationResult>;
      estimatePlan: () => Promise<PlanEstimate | null>;
      getPlan: () => Promise<TaskGraph | null>;
      clearPlan: () => Promise<void>;
      cancel: () => Promise<void>;
      pause: () => Promise<void>;
      resume: () => Promise<void>;
      rollback: (toTaskId?: string) => Promise<{ success: boolean; rolledBackTasks: string[]; errors?: string[] }>;
      getState: () => Promise<OrchestratorState>;
      setMode: (mode: 'pro' | 'kid') => Promise<void>;
      getMode: () => Promise<ModeConfig>;
    };

    // Stack Templates API
    templates: {
      getStacks: () => Promise<StackConfig[]>;
      getStack: (stackId: string) => Promise<StackConfig | undefined>;
    };

    // Dev Server API
    devServer: {
      register: (config: ServerConfig) => Promise<boolean>;
      start: (serverId: string) => Promise<ServerStatus>;
      stop: (serverId: string) => Promise<boolean>;
      restart: (serverId: string) => Promise<ServerStatus>;
      getStatus: (serverId: string) => Promise<ServerStatus | null>;
      getAllStatuses: () => Promise<ServerStatus[]>;
      stopAll: () => Promise<boolean>;
      onEvent: (callback: (event: ServerEvent) => void) => () => void;
    };
  }
}

// Server types
export interface ServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  cwd: string;
  port: number;
  env?: Record<string, string>;
  healthCheck?: {
    url: string;
    interval: number;
    timeout: number;
  };
}

export interface ServerStatus {
  id: string;
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'error' | 'stopping';
  port?: number;
  pid?: number;
  startedAt?: Date;
  error?: string;
  url?: string;
  output: string[];
}

export type ServerEvent =
  | { type: 'started'; serverId: string; port: number; pid: number }
  | { type: 'stopped'; serverId: string }
  | { type: 'error'; serverId: string; error: string }
  | { type: 'output'; serverId: string; data: string }
  | { type: 'health_check'; serverId: string; healthy: boolean };

export {};
