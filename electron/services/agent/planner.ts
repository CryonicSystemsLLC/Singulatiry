/**
 * Planner Agent
 *
 * Converts natural language requests into structured task graphs.
 * Uses AI to analyze requirements and generate execution plans.
 */

import {
  PlannerAgent,
  PlanRequest,
  PlanResult,
  TaskGraph,
  TaskType,
  ValidationResult,
  PlanEstimate,
  createEmptyTaskGraph,
  createTask,
  generateId,
  topologicalSort
} from './types';
import { getModelService } from '../models/unified';
import { ModelId } from '../models/types';
import { AVAILABLE_STACKS, getStackById } from '../templates/stacks';

/**
 * System prompt for the planner agent
 */
const PLANNER_SYSTEM_PROMPT = `You are an expert software architect and project planner. Your job is to analyze user requests and create detailed, executable task plans for building software applications.

When creating a plan, you must:
1. Understand the user's requirements thoroughly
2. Choose an appropriate technology stack
3. Break down the work into discrete, executable tasks
4. Define clear dependencies between tasks
5. Ensure tasks are specific and actionable

You output plans in JSON format. Each plan contains:
- A name and description
- A stack configuration
- An array of tasks with dependencies

Available task types:
- choose_stack: Select and configure technology stack
- scaffold_project: Create initial project structure
- configure_environment: Set up environment variables and config files
- design_schema: Design database schema
- create_migration: Create database migration files
- apply_migration: Run database migrations
- seed_data: Add sample/test data to database
- generate_backend: Generate backend code (API routes, services)
- generate_frontend: Generate frontend code (pages, components)
- generate_component: Generate a specific UI component
- generate_api_route: Generate a specific API endpoint
- generate_test: Generate test files
- edit_file: Modify an existing file
- refactor_code: Refactor existing code
- fix_error: Fix a specific error
- add_feature: Add a feature to existing code
- install_dependencies: Install npm/pip packages
- run_build: Run build process
- run_tests: Execute test suite
- start_dev_server: Start development server
- run_command: Run a custom command

When defining tasks:
- Give each task a clear, descriptive name
- Write detailed descriptions of what the task should accomplish
- List all task IDs that must complete before this task (dependsOn)
- Tasks with no dependencies will run first
- Group related tasks together
- Keep the plan focused and avoid unnecessary tasks

Available stacks:
${AVAILABLE_STACKS.map(s => `- ${s.id}: ${s.name} - ${s.description}`).join('\n')}`;

/**
 * Planner Agent Implementation
 */
export class PlannerAgentImpl implements PlannerAgent {
  private model: ModelId;

  constructor(model: ModelId = 'anthropic:claude-3-5-sonnet') {
    this.model = model;
  }

  /**
   * Create a plan from natural language request
   */
  async createPlan(request: PlanRequest): Promise<PlanResult> {
    const modelService = getModelService();

    try {
      // Build the prompt
      const userPrompt = this.buildPlanPrompt(request);

      // Generate the plan
      const response = await modelService.chat({
        model: this.model,
        systemPrompt: PLANNER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.7,
        maxTokens: 8000
      });

      // Parse the plan
      const planJson = this.extractJson(response.content);
      if (!planJson) {
        return {
          success: false,
          error: 'Failed to parse plan from AI response',
          tokensUsed: response.usage.totalTokens,
          cost: response.usage.estimatedCost
        };
      }

      // Build the task graph
      const taskGraph = this.buildTaskGraph(planJson, request);

      // Validate the plan
      const validation = await this.validatePlan(taskGraph);
      if (!validation.valid) {
        return {
          success: false,
          error: `Plan validation failed: ${validation.errors.join(', ')}`,
          warnings: validation.warnings,
          tokensUsed: response.usage.totalTokens,
          cost: response.usage.estimatedCost
        };
      }

      return {
        success: true,
        taskGraph,
        warnings: validation.warnings,
        tokensUsed: response.usage.totalTokens,
        cost: response.usage.estimatedCost
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create plan'
      };
    }
  }

  /**
   * Refine an existing plan based on feedback
   */
  async refinePlan(graph: TaskGraph, feedback: string): Promise<PlanResult> {
    const modelService = getModelService();

    try {
      const prompt = `Here is the current plan:

${JSON.stringify(this.taskGraphToJson(graph), null, 2)}

User feedback: ${feedback}

Please update the plan based on this feedback. Output the complete updated plan in the same JSON format.`;

      const response = await modelService.chat({
        model: this.model,
        systemPrompt: PLANNER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        maxTokens: 8000
      });

      const planJson = this.extractJson(response.content);
      if (!planJson) {
        return {
          success: false,
          error: 'Failed to parse refined plan',
          tokensUsed: response.usage.totalTokens,
          cost: response.usage.estimatedCost
        };
      }

      // Preserve some original graph properties
      const refinedGraph = this.buildTaskGraph(planJson, {
        userRequest: feedback,
        projectContext: {
          projectRoot: graph.projectRoot
        }
      });

      refinedGraph.id = graph.id;
      refinedGraph.createdAt = graph.createdAt;
      refinedGraph.updatedAt = new Date().toISOString();

      return {
        success: true,
        taskGraph: refinedGraph,
        tokensUsed: response.usage.totalTokens,
        cost: response.usage.estimatedCost
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to refine plan'
      };
    }
  }

  /**
   * Validate a plan for feasibility
   */
  async validatePlan(graph: TaskGraph): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for empty plan
    if (graph.tasks.length === 0) {
      errors.push('Plan has no tasks');
    }

    // Check for valid task types
    const validTypes: TaskType[] = [
      'choose_stack', 'scaffold_project', 'configure_environment',
      'design_schema', 'create_migration', 'apply_migration', 'seed_data',
      'generate_backend', 'generate_frontend', 'generate_component',
      'generate_api_route', 'generate_test', 'edit_file', 'refactor_code',
      'fix_error', 'add_feature', 'install_dependencies', 'run_build',
      'run_tests', 'start_dev_server', 'run_command', 'custom',
      'analyze_code', 'review_changes', 'explain_code'
    ];

    for (const task of graph.tasks) {
      if (!validTypes.includes(task.type)) {
        warnings.push(`Unknown task type: ${task.type}`);
      }
    }

    // Check for circular dependencies
    try {
      topologicalSort(graph.tasks);
    } catch (error: any) {
      errors.push(error.message);
    }

    // Check for missing dependencies
    const taskIds = new Set(graph.tasks.map(t => t.id));
    for (const task of graph.tasks) {
      for (const depId of task.dependsOn) {
        if (!taskIds.has(depId)) {
          errors.push(`Task ${task.id} depends on non-existent task ${depId}`);
        }
      }
    }

    // Check for unreachable tasks
    const rootTasks = graph.tasks.filter(t => t.dependsOn.length === 0);

    if (rootTasks.length === 0 && graph.tasks.length > 0) {
      errors.push('No root tasks (tasks with no dependencies)');
    }

    // Check stack validity
    if (!graph.stack || !graph.stack.id) {
      warnings.push('No stack configuration specified');
    }

    // Check for overly long plans
    if (graph.tasks.length > 50) {
      warnings.push('Plan has many tasks (>50). Consider breaking into smaller phases.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Estimate resources needed for a plan
   */
  async estimatePlan(graph: TaskGraph): Promise<PlanEstimate> {
    const taskCount = graph.tasks.length;

    // Rough estimates based on task types
    let totalTokens = 0;
    let totalMinutes = 0;
    const risks: string[] = [];

    for (const task of graph.tasks) {
      switch (task.type) {
        case 'scaffold_project':
          totalTokens += 2000;
          totalMinutes += 2;
          break;
        case 'generate_backend':
        case 'generate_frontend':
          totalTokens += 5000;
          totalMinutes += 5;
          break;
        case 'generate_component':
        case 'generate_api_route':
          totalTokens += 2000;
          totalMinutes += 2;
          break;
        case 'design_schema':
          totalTokens += 3000;
          totalMinutes += 3;
          break;
        case 'apply_migration':
          totalTokens += 500;
          totalMinutes += 1;
          risks.push('Database migration may require manual verification');
          break;
        case 'install_dependencies':
          totalTokens += 500;
          totalMinutes += 2;
          risks.push('Dependency installation may fail due to version conflicts');
          break;
        case 'run_tests':
          totalTokens += 500;
          totalMinutes += 3;
          break;
        default:
          totalTokens += 1000;
          totalMinutes += 1;
      }
    }

    // Cost estimate (using Claude 3.5 Sonnet pricing as baseline)
    const estimatedCost = (totalTokens / 1_000_000) * 18; // ~$18 per 1M tokens (in+out)

    return {
      estimatedTasks: taskCount,
      estimatedTokens: totalTokens,
      estimatedCost,
      estimatedTimeMinutes: totalMinutes,
      risks: [...new Set(risks)]
    };
  }

  /**
   * Build the prompt for plan generation
   */
  private buildPlanPrompt(request: PlanRequest): string {
    let prompt = `Create a detailed execution plan for the following request:

"${request.userRequest}"

`;

    if (request.projectContext) {
      prompt += `\nProject Context:\n`;
      if (request.projectContext.projectRoot) {
        prompt += `- Project root: ${request.projectContext.projectRoot}\n`;
      }
      if (request.projectContext.existingFiles?.length) {
        prompt += `- Existing files: ${request.projectContext.existingFiles.slice(0, 20).join(', ')}\n`;
      }
      if (request.projectContext.existingDependencies) {
        prompt += `- Dependencies: ${Object.keys(request.projectContext.existingDependencies).slice(0, 10).join(', ')}\n`;
      }
    }

    if (request.preferredStack) {
      prompt += `\nPreferred stack: ${request.preferredStack}\n`;
    }

    if (request.constraints) {
      prompt += `\nConstraints:\n`;
      if (request.constraints.allowedStacks?.length) {
        prompt += `- Allowed stacks: ${request.constraints.allowedStacks.join(', ')}\n`;
      }
      if (request.constraints.maxTasks) {
        prompt += `- Maximum tasks: ${request.constraints.maxTasks}\n`;
      }
    }

    prompt += `
Output your plan as a JSON object with this structure:
{
  "name": "Project name",
  "description": "Brief description of what will be built",
  "stackId": "stack-id",
  "tasks": [
    {
      "type": "task_type",
      "name": "Task name",
      "description": "Detailed description of what this task does",
      "dependsOn": ["task-id-1", "task-id-2"],
      "metadata": {}
    }
  ]
}

Important:
- Task IDs will be auto-generated based on array index (task_0, task_1, etc.)
- Use dependsOn to reference tasks by their position: ["task_0"] means depend on first task
- Include all necessary tasks for a complete implementation
- Be specific in task descriptions`;

    return prompt;
  }

  /**
   * Extract JSON from AI response
   */
  private extractJson(content: string): any {
    // Try to find JSON in code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        // Continue to other methods
      }
    }

    // Try to find raw JSON
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      try {
        return JSON.parse(content.substring(jsonStart, jsonEnd + 1));
      } catch {
        // Failed to parse
      }
    }

    return null;
  }

  /**
   * Build a TaskGraph from parsed JSON
   */
  private buildTaskGraph(planJson: any, request: PlanRequest): TaskGraph {
    const stackId = planJson.stackId || 'nextjs-prisma';
    const stack = getStackById(stackId) || AVAILABLE_STACKS[0];
    const projectRoot = request.projectContext?.projectRoot || process.cwd();

    const graph = createEmptyTaskGraph(
      planJson.name || 'New Project',
      projectRoot,
      stack
    );

    graph.description = planJson.description || '';

    // Build tasks with proper IDs
    const taskIdMap = new Map<string, string>();

    if (Array.isArray(planJson.tasks)) {
      for (let i = 0; i < planJson.tasks.length; i++) {
        const taskJson = planJson.tasks[i];
        const taskId = generateId('task');
        taskIdMap.set(`task_${i}`, taskId);
        taskIdMap.set(i.toString(), taskId);

        const task = createTask(
          taskJson.type || 'custom',
          taskJson.name || `Task ${i + 1}`,
          taskJson.description || '',
          [] // Dependencies will be resolved after all tasks are created
        );

        task.id = taskId;
        task.metadata = taskJson.metadata;
        graph.tasks.push(task);
      }

      // Resolve dependencies
      for (let i = 0; i < planJson.tasks.length; i++) {
        const taskJson = planJson.tasks[i];
        const task = graph.tasks[i];

        if (Array.isArray(taskJson.dependsOn)) {
          task.dependsOn = taskJson.dependsOn
            .map((dep: string) => taskIdMap.get(dep) || dep)
            .filter((dep: string) => graph.tasks.some(t => t.id === dep));
        }
      }
    }

    return graph;
  }

  /**
   * Convert TaskGraph back to JSON for refinement
   */
  private taskGraphToJson(graph: TaskGraph): any {
    return {
      name: graph.name,
      description: graph.description,
      stackId: graph.stack.id,
      tasks: graph.tasks.map((task) => ({
        type: task.type,
        name: task.name,
        description: task.description,
        dependsOn: task.dependsOn.map(depId => {
          const depIndex = graph.tasks.findIndex(t => t.id === depId);
          return depIndex >= 0 ? `task_${depIndex}` : depId;
        }),
        metadata: task.metadata
      }))
    };
  }
}

/**
 * Create a planner agent instance
 */
export function createPlannerAgent(model?: ModelId): PlannerAgent {
  return new PlannerAgentImpl(model);
}

export default PlannerAgentImpl;
