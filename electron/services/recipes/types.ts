/**
 * Recipe Types
 *
 * Defines the structure for reusable code generation recipes.
 */

export interface RecipeParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  label: string;
  description: string;
  required: boolean;
  default?: string | number | boolean | string[];
  options?: { value: string; label: string }[];
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
}

export interface RecipeStep {
  id: string;
  name: string;
  description: string;
  type: 'file_create' | 'file_modify' | 'file_delete' | 'command' | 'prompt';
  condition?: string; // JavaScript expression to evaluate
  config: FileCreateConfig | FileModifyConfig | FileDeleteConfig | CommandConfig | PromptConfig;
}

export interface FileCreateConfig {
  path: string; // Can use {{variables}}
  template: string;
  overwrite?: boolean;
}

export interface FileModifyConfig {
  path: string;
  modifications: FileModification[];
}

export interface FileModification {
  type: 'insert_before' | 'insert_after' | 'replace' | 'append' | 'prepend';
  target?: string; // Regex or string to find
  content: string;
}

export interface FileDeleteConfig {
  path: string;
}

export interface CommandConfig {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface PromptConfig {
  systemPrompt: string;
  userPrompt: string;
  outputFile?: string;
  model?: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  category: RecipeCategory;
  icon?: string;
  tags: string[];
  compatibleStacks: string[]; // Stack IDs or '*' for all
  parameters: RecipeParameter[];
  steps: RecipeStep[];
  rollbackSteps?: RecipeStep[];
  version: string;
  author?: string;
}

export type RecipeCategory =
  | 'authentication'
  | 'database'
  | 'ui'
  | 'api'
  | 'testing'
  | 'deployment'
  | 'feature'
  | 'utility';

export interface RecipeExecutionContext {
  projectRoot: string;
  stackId: string;
  parameters: Record<string, any>;
  variables: Record<string, string>;
  dryRun?: boolean;
}

export interface RecipeExecutionResult {
  success: boolean;
  recipe: string;
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  commandsRun: string[];
  errors: string[];
  warnings: string[];
  executionTimeMs: number;
}

export interface RecipeStepResult {
  stepId: string;
  success: boolean;
  output?: string;
  error?: string;
  filesAffected?: string[];
}

export interface RecipeRegistry {
  recipes: Map<string, Recipe>;
  register(recipe: Recipe): void;
  unregister(recipeId: string): boolean;
  get(recipeId: string): Recipe | undefined;
  list(category?: RecipeCategory): Recipe[];
  findCompatible(stackId: string): Recipe[];
  search(query: string): Recipe[];
}

export default Recipe;
