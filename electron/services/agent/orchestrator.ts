/**
 * Agent Orchestrator
 *
 * Coordinates the planner and executor agents, manages mode switching,
 * and provides a unified interface for the frontend.
 */

import {
  PlannerAgent,
  ExecutorAgent,
  TaskGraph,
  PlanRequest,
  PlanResult,
  ExecutionOptions,
  ExecutionResult,
  ExecutionEvent,
  RollbackResult,
  ValidationResult,
  PlanEstimate
} from './types';
import { createPlannerAgent } from './planner';
import { createExecutorAgent } from './executor';
import { ToolRegistry } from '../tools/registry';
import { registerCoreTools } from '../tools/core-tools';
import { registerGitTools } from '../tools/git-tools';
import { registerNpmTools } from '../tools/npm-tools';
import { registerTestTools } from '../tools/test-tools';
import { registerLintTools } from '../tools/lint-tools';
import { registerBrowserTools } from '../tools/browser-tools';
import { registerWebSearchTools } from '../tools/web-search-tool';
import { SecurityConfig, getSecurityConfig } from '../tools/security';
import { ModelId } from '../models/types';

/**
 * Mode configuration
 */
export interface ModeConfig {
  id: 'pro' | 'kid';
  name: string;
  securityConfig: SecurityConfig;
  allowedStacks: string[];
  maxTasks: number;
  defaultModel: ModelId;
}

const PRO_MODE: ModeConfig = {
  id: 'pro',
  name: 'Pro Mode',
  securityConfig: getSecurityConfig('pro'),
  allowedStacks: ['*'],
  maxTasks: 100,
  defaultModel: 'anthropic:claude-3-5-sonnet'
};

const KID_MODE: ModeConfig = {
  id: 'kid',
  name: 'Kid Mode',
  securityConfig: getSecurityConfig('kid'),
  allowedStacks: ['nextjs-prisma', 'react-express-simple'],
  maxTasks: 20,
  defaultModel: 'openai:gpt-4o-mini'
};

/**
 * Orchestrator state
 */
interface OrchestratorState {
  currentGraph: TaskGraph | null;
  isExecuting: boolean;
  isPaused: boolean;
  mode: ModeConfig;
}

/**
 * Agent Orchestrator Implementation
 */
export class AgentOrchestrator {
  private planner: PlannerAgent;
  private executor: ExecutorAgent;
  private toolRegistry: ToolRegistry;
  private state: OrchestratorState;
  private eventListeners: Array<(event: ExecutionEvent) => void> = [];

  constructor(mode: 'pro' | 'kid' = 'pro') {
    const modeConfig = mode === 'kid' ? KID_MODE : PRO_MODE;

    this.toolRegistry = new ToolRegistry();
    registerCoreTools(this.toolRegistry);
    registerGitTools(this.toolRegistry);
    registerNpmTools(this.toolRegistry);
    registerTestTools(this.toolRegistry);
    registerLintTools(this.toolRegistry);
    registerBrowserTools(this.toolRegistry);
    registerWebSearchTools(this.toolRegistry);

    this.planner = createPlannerAgent(modeConfig.defaultModel);
    this.executor = createExecutorAgent(modeConfig.defaultModel, this.toolRegistry);

    this.state = {
      currentGraph: null,
      isExecuting: false,
      isPaused: false,
      mode: modeConfig
    };
  }

  /**
   * Get current mode
   */
  getMode(): ModeConfig {
    return this.state.mode;
  }

  /**
   * Switch mode
   */
  setMode(mode: 'pro' | 'kid'): void {
    if (this.state.isExecuting) {
      throw new Error('Cannot switch modes while executing');
    }

    this.state.mode = mode === 'kid' ? KID_MODE : PRO_MODE;

    // Recreate agents with new model
    this.planner = createPlannerAgent(this.state.mode.defaultModel);
    this.executor = createExecutorAgent(this.state.mode.defaultModel, this.toolRegistry);
  }

  /**
   * Create a plan from natural language request
   */
  async createPlan(request: PlanRequest): Promise<PlanResult> {
    // Apply mode constraints
    const constrainedRequest: PlanRequest = {
      ...request,
      constraints: {
        ...request.constraints,
        allowedStacks: this.state.mode.allowedStacks[0] === '*'
          ? request.constraints?.allowedStacks
          : this.state.mode.allowedStacks,
        maxTasks: Math.min(
          request.constraints?.maxTasks || this.state.mode.maxTasks,
          this.state.mode.maxTasks
        ),
        securityConfig: this.state.mode.securityConfig
      }
    };

    const result = await this.planner.createPlan(constrainedRequest);

    if (result.success && result.taskGraph) {
      this.state.currentGraph = result.taskGraph;
    }

    return result;
  }

  /**
   * Refine the current plan
   */
  async refinePlan(feedback: string): Promise<PlanResult> {
    if (!this.state.currentGraph) {
      return {
        success: false,
        error: 'No plan to refine. Create a plan first.'
      };
    }

    const result = await this.planner.refinePlan(this.state.currentGraph, feedback);

    if (result.success && result.taskGraph) {
      this.state.currentGraph = result.taskGraph;
    }

    return result;
  }

  /**
   * Validate the current plan
   */
  async validatePlan(): Promise<ValidationResult> {
    if (!this.state.currentGraph) {
      return {
        valid: false,
        errors: ['No plan to validate'],
        warnings: []
      };
    }

    return this.planner.validatePlan(this.state.currentGraph);
  }

  /**
   * Get plan estimate
   */
  async estimatePlan(): Promise<PlanEstimate | null> {
    if (!this.state.currentGraph) {
      return null;
    }

    return this.planner.estimatePlan(this.state.currentGraph);
  }

  /**
   * Execute the current plan
   */
  async *execute(options?: ExecutionOptions): AsyncGenerator<ExecutionEvent, ExecutionResult> {
    if (!this.state.currentGraph) {
      throw new Error('No plan to execute. Create a plan first.');
    }

    if (this.state.isExecuting) {
      throw new Error('Already executing a plan');
    }

    this.state.isExecuting = true;
    this.state.isPaused = false;

    try {
      const executionOptions: ExecutionOptions = {
        ...options,
        onEvent: (event) => {
          // Notify all listeners
          for (const listener of this.eventListeners) {
            listener(event);
          }
          options?.onEvent?.(event);
        }
      };

      const generator = this.executor.executePlan(
        this.state.currentGraph,
        executionOptions
      );

      let result: IteratorResult<ExecutionEvent, ExecutionResult>;
      do {
        result = await generator.next();
        if (!result.done) {
          yield result.value;
        }
      } while (!result.done);

      return result.value;
    } finally {
      this.state.isExecuting = false;
      this.state.isPaused = false;
    }
  }

  /**
   * Execute plan and collect all events (non-generator version)
   */
  async executeAndCollect(options?: ExecutionOptions): Promise<{
    result: ExecutionResult;
    events: ExecutionEvent[];
  }> {
    const events: ExecutionEvent[] = [];
    const generator = this.execute({
      ...options,
      onEvent: (event) => {
        events.push(event);
        options?.onEvent?.(event);
      }
    });

    let result: IteratorResult<ExecutionEvent, ExecutionResult>;
    do {
      result = await generator.next();
    } while (!result.done);

    return {
      result: result.value,
      events
    };
  }

  /**
   * Cancel execution
   */
  async cancel(): Promise<void> {
    if (this.state.isExecuting) {
      await this.executor.cancel();
    }
  }

  /**
   * Pause execution
   */
  async pause(): Promise<void> {
    if (this.state.isExecuting && !this.state.isPaused) {
      await this.executor.pause();
      this.state.isPaused = true;
    }
  }

  /**
   * Resume execution
   */
  async resume(): Promise<void> {
    if (this.state.isExecuting && this.state.isPaused) {
      await this.executor.resume();
      this.state.isPaused = false;
    }
  }

  /**
   * Rollback execution
   */
  async rollback(toTaskId?: string): Promise<RollbackResult> {
    if (!this.state.currentGraph) {
      return {
        success: false,
        rolledBackTasks: [],
        errors: ['No plan to rollback']
      };
    }

    return this.executor.rollback(this.state.currentGraph, toTaskId);
  }

  /**
   * Get current state
   */
  getState(): Readonly<OrchestratorState> {
    return { ...this.state };
  }

  /**
   * Get current task graph
   */
  getTaskGraph(): TaskGraph | null {
    return this.state.currentGraph;
  }

  /**
   * Set task graph (for loading saved plans)
   */
  setTaskGraph(graph: TaskGraph): void {
    if (this.state.isExecuting) {
      throw new Error('Cannot set task graph while executing');
    }
    this.state.currentGraph = graph;
  }

  /**
   * Clear current plan
   */
  clearPlan(): void {
    if (this.state.isExecuting) {
      throw new Error('Cannot clear plan while executing');
    }
    this.state.currentGraph = null;
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: ExecutionEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Quick execute: create plan and execute in one step
   */
  async quickExecute(
    request: string,
    projectRoot: string,
    options?: ExecutionOptions
  ): Promise<{
    planResult: PlanResult;
    executionResult?: ExecutionResult;
    events: ExecutionEvent[];
  }> {
    // Create plan
    const planResult = await this.createPlan({
      userRequest: request,
      projectContext: { projectRoot }
    });

    if (!planResult.success || !planResult.taskGraph) {
      return { planResult, events: [] };
    }

    // Execute
    const { result, events } = await this.executeAndCollect(options);

    return {
      planResult,
      executionResult: result,
      events
    };
  }
}

// Singleton instance
let orchestratorInstance: AgentOrchestrator | null = null;

/**
 * Get the agent orchestrator instance
 */
export function getOrchestrator(mode?: 'pro' | 'kid'): AgentOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new AgentOrchestrator(mode);
  }
  return orchestratorInstance;
}

/**
 * Create a new orchestrator instance
 */
export function createOrchestrator(mode: 'pro' | 'kid' = 'pro'): AgentOrchestrator {
  return new AgentOrchestrator(mode);
}

/**
 * IPC handlers for the orchestrator
 */
export const orchestratorIpcHandlers = {
  'agent:create-plan': async (
    _event: any,
    request: PlanRequest
  ): Promise<PlanResult> => {
    const orchestrator = getOrchestrator();
    return orchestrator.createPlan(request);
  },

  'agent:refine-plan': async (
    _event: any,
    feedback: string
  ): Promise<PlanResult> => {
    const orchestrator = getOrchestrator();
    return orchestrator.refinePlan(feedback);
  },

  'agent:validate-plan': async (): Promise<ValidationResult> => {
    const orchestrator = getOrchestrator();
    return orchestrator.validatePlan();
  },

  'agent:estimate-plan': async (): Promise<PlanEstimate | null> => {
    const orchestrator = getOrchestrator();
    return orchestrator.estimatePlan();
  },

  'agent:get-plan': (): TaskGraph | null => {
    const orchestrator = getOrchestrator();
    return orchestrator.getTaskGraph();
  },

  'agent:clear-plan': (): void => {
    const orchestrator = getOrchestrator();
    orchestrator.clearPlan();
  },

  'agent:cancel': async (): Promise<void> => {
    const orchestrator = getOrchestrator();
    await orchestrator.cancel();
  },

  'agent:pause': async (): Promise<void> => {
    const orchestrator = getOrchestrator();
    await orchestrator.pause();
  },

  'agent:resume': async (): Promise<void> => {
    const orchestrator = getOrchestrator();
    await orchestrator.resume();
  },

  'agent:rollback': async (
    _event: any,
    toTaskId?: string
  ): Promise<RollbackResult> => {
    const orchestrator = getOrchestrator();
    return orchestrator.rollback(toTaskId);
  },

  'agent:get-state': (): OrchestratorState => {
    const orchestrator = getOrchestrator();
    return orchestrator.getState() as OrchestratorState;
  },

  'agent:set-mode': (_event: any, mode: 'pro' | 'kid'): void => {
    const orchestrator = getOrchestrator();
    orchestrator.setMode(mode);
  },

  'agent:get-mode': (): ModeConfig => {
    const orchestrator = getOrchestrator();
    return orchestrator.getMode();
  }
};

export default AgentOrchestrator;
