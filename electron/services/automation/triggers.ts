/**
 * Automation Triggers
 *
 * Defines trigger types and conditions for automated actions.
 */

export type TriggerType =
  | 'file_save'
  | 'file_create'
  | 'file_delete'
  | 'schema_change'
  | 'dependency_change'
  | 'error_detected'
  | 'build_complete'
  | 'test_complete'
  | 'manual';

export interface TriggerCondition {
  type: 'file_pattern' | 'content_match' | 'always' | 'custom';
  pattern?: string; // Glob pattern or regex
  value?: string;
  evaluator?: (context: TriggerContext) => boolean;
}

export interface TriggerContext {
  type: TriggerType;
  filePath?: string;
  fileContent?: string;
  previousContent?: string;
  error?: Error | string;
  projectRoot: string;
  metadata?: Record<string, any>;
}

export interface TriggerAction {
  type: 'command' | 'tool' | 'recipe' | 'notify' | 'custom';
  name: string;
  params?: Record<string, any>;
  async?: boolean;
  timeout?: number;
}

export interface Trigger {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  event: TriggerType;
  conditions: TriggerCondition[];
  actions: TriggerAction[];
  debounce?: number; // ms to wait before executing
  maxExecutions?: number; // max times to execute per session
  executionCount?: number;
  lastExecuted?: Date;
}

export interface TriggerExecutionResult {
  triggerId: string;
  success: boolean;
  actionsExecuted: number;
  actionResults: Array<{
    actionName: string;
    success: boolean;
    output?: string;
    error?: string;
  }>;
  executionTimeMs: number;
}

// Built-in triggers
export const BUILTIN_TRIGGERS: Trigger[] = [
  {
    id: 'format-on-save',
    name: 'Format on Save',
    description: 'Run Prettier/ESLint when files are saved',
    enabled: false,
    event: 'file_save',
    conditions: [
      {
        type: 'file_pattern',
        pattern: '**/*.{ts,tsx,js,jsx,json,css,scss}'
      }
    ],
    actions: [
      {
        type: 'command',
        name: 'Format File',
        params: { command: 'npx prettier --write {{filePath}}' },
        timeout: 10000
      }
    ],
    debounce: 500
  },
  {
    id: 'lint-on-save',
    name: 'Lint on Save',
    description: 'Run ESLint when TypeScript/JavaScript files are saved',
    enabled: false,
    event: 'file_save',
    conditions: [
      {
        type: 'file_pattern',
        pattern: '**/*.{ts,tsx,js,jsx}'
      }
    ],
    actions: [
      {
        type: 'command',
        name: 'Lint File',
        params: { command: 'npx eslint --fix {{filePath}}' },
        timeout: 15000
      }
    ],
    debounce: 1000
  },
  {
    id: 'prisma-generate',
    name: 'Generate Prisma Client',
    description: 'Regenerate Prisma client when schema changes',
    enabled: true,
    event: 'schema_change',
    conditions: [
      {
        type: 'file_pattern',
        pattern: '**/prisma/schema.prisma'
      }
    ],
    actions: [
      {
        type: 'command',
        name: 'Prisma Generate',
        params: { command: 'npx prisma generate' },
        timeout: 60000
      }
    ],
    debounce: 2000
  },
  {
    id: 'npm-install-on-package-change',
    name: 'Install Dependencies',
    description: 'Run npm install when package.json changes',
    enabled: false,
    event: 'file_save',
    conditions: [
      {
        type: 'file_pattern',
        pattern: '**/package.json'
      }
    ],
    actions: [
      {
        type: 'notify',
        name: 'Dependencies Changed',
        params: { message: 'package.json changed. Run npm install?' }
      }
    ],
    debounce: 5000
  },
  {
    id: 'auto-fix-error',
    name: 'Auto Fix Errors',
    description: 'Attempt to fix errors automatically using AI',
    enabled: false,
    event: 'error_detected',
    conditions: [
      {
        type: 'always'
      }
    ],
    actions: [
      {
        type: 'tool',
        name: 'AI Fix Error',
        params: { tool: 'fix_error', context: '{{error}}' },
        async: true,
        timeout: 120000
      }
    ],
    maxExecutions: 3
  },
  {
    id: 'run-tests-on-change',
    name: 'Run Tests on Change',
    description: 'Run related tests when source files change',
    enabled: false,
    event: 'file_save',
    conditions: [
      {
        type: 'file_pattern',
        pattern: 'src/**/*.{ts,tsx}'
      }
    ],
    actions: [
      {
        type: 'command',
        name: 'Run Related Tests',
        params: { command: 'npm test -- --findRelatedTests {{filePath}}' },
        async: true,
        timeout: 60000
      }
    ],
    debounce: 3000
  },
  {
    id: 'type-check-on-save',
    name: 'Type Check on Save',
    description: 'Run TypeScript type checking when files are saved',
    enabled: false,
    event: 'file_save',
    conditions: [
      {
        type: 'file_pattern',
        pattern: '**/*.{ts,tsx}'
      }
    ],
    actions: [
      {
        type: 'command',
        name: 'Type Check',
        params: { command: 'npx tsc --noEmit' },
        async: true,
        timeout: 30000
      }
    ],
    debounce: 2000
  }
];

/**
 * Evaluate trigger conditions
 */
export function evaluateConditions(
  conditions: TriggerCondition[],
  context: TriggerContext
): boolean {
  if (conditions.length === 0) return true;

  return conditions.every(condition => {
    switch (condition.type) {
      case 'always':
        return true;

      case 'file_pattern':
        if (!condition.pattern || !context.filePath) return false;
        return matchGlob(condition.pattern, context.filePath);

      case 'content_match':
        if (!condition.pattern || !context.fileContent) return false;
        try {
          const regex = new RegExp(condition.pattern, 'i');
          return regex.test(context.fileContent);
        } catch {
          return context.fileContent.includes(condition.pattern);
        }

      case 'custom':
        return condition.evaluator ? condition.evaluator(context) : false;

      default:
        return false;
    }
  });
}

/**
 * Simple glob matching
 */
function matchGlob(pattern: string, path: string): boolean {
  // Normalize paths
  const normalizedPath = path.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Convert glob to regex
  const regexPattern = normalizedPattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLE_STAR}}/g, '.*')
    .replace(/\{([^}]+)\}/g, (_, group) => `(${group.split(',').join('|')})`);

  try {
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  } catch {
    return normalizedPath.includes(normalizedPattern.replace(/\*/g, ''));
  }
}

/**
 * Replace template variables in action params
 */
export function interpolateParams(
  params: Record<string, any>,
  context: TriggerContext
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      result[key] = value
        .replace(/{{filePath}}/g, context.filePath || '')
        .replace(/{{projectRoot}}/g, context.projectRoot)
        .replace(/{{error}}/g, String(context.error || ''))
        .replace(/{{previousContent}}/g, context.previousContent || '')
        .replace(/{{fileContent}}/g, context.fileContent || '');
    } else {
      result[key] = value;
    }
  }

  return result;
}

export default { BUILTIN_TRIGGERS, evaluateConditions, interpolateParams };
