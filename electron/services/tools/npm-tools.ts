/**
 * NPM Tools - Package management operations for the agent
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ToolResult, defineTool } from './registry';

const execAsync = promisify(exec);

/**
 * Install an npm package
 */
export const npmInstall = defineTool<{
  package?: string;
  dev?: boolean;
  global?: boolean;
}>(
  'npm_install',
  'Install an npm package or all project dependencies. Runs `npm install` in the project root.',
  {
    type: 'object',
    properties: {
      package: {
        type: 'string',
        description: 'Package name to install (e.g., "lodash" or "lodash@4.17.21"). Omit to install all dependencies from package.json.'
      },
      dev: {
        type: 'boolean',
        description: 'Install as a dev dependency (--save-dev)',
        default: false
      },
      global: {
        type: 'boolean',
        description: 'Install globally (--global)',
        default: false
      }
    }
  },
  async (params, context): Promise<ToolResult> => {
    try {
      const args: string[] = ['install'];

      if (params.package) {
        args.push(params.package);
      }

      if (params.dev) {
        args.push('--save-dev');
      }

      if (params.global) {
        args.push('--global');
      }

      const command = `npm ${args.join(' ')}`;

      const { stdout, stderr } = await execAsync(command, {
        cwd: context.projectRoot,
        timeout: context.securityConfig.maxExecutionTime,
        env: { ...process.env, ...context.env },
        maxBuffer: 10 * 1024 * 1024
      });

      return {
        success: true,
        data: {
          command,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          package: params.package || '(all dependencies)',
          dev: params.dev || false,
          global: params.global || false
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `npm install failed: ${error.stderr || error.message}`,
          code: 'NPM_INSTALL_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * Run an npm script
 */
export const npmRun = defineTool<{
  script: string;
  args?: string;
}>(
  'npm_run',
  'Run an npm script defined in package.json. Executes `npm run <script>` in the project root.',
  {
    type: 'object',
    properties: {
      script: {
        type: 'string',
        description: 'The npm script name to run (e.g., "dev", "build", "test")'
      },
      args: {
        type: 'string',
        description: 'Additional arguments to pass to the script (after --)'
      }
    },
    required: ['script']
  },
  async (params, context): Promise<ToolResult> => {
    try {
      let command = `npm run ${params.script}`;

      if (params.args) {
        command += ` -- ${params.args}`;
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: context.projectRoot,
        timeout: context.securityConfig.maxExecutionTime,
        env: { ...process.env, ...context.env },
        maxBuffer: 10 * 1024 * 1024
      });

      return {
        success: true,
        data: {
          command,
          script: params.script,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        }
      };
    } catch (error: any) {
      // npm run can fail with non-zero exit but still produce useful output
      return {
        success: false,
        data: {
          command: `npm run ${params.script}`,
          stdout: error.stdout?.trim() || '',
          stderr: error.stderr?.trim() || ''
        },
        error: {
          message: `npm run ${params.script} failed: ${error.stderr?.trim() || error.message}`,
          code: 'NPM_RUN_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * Search the npm registry
 */
export const npmSearch = defineTool<{
  query: string;
  limit?: number;
}>(
  'npm_search',
  'Search the npm registry for packages matching a query. Returns package names, descriptions, and versions.',
  {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (e.g., "react state management")'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 50)',
        default: 10
      }
    },
    required: ['query']
  },
  async (params, _context): Promise<ToolResult> => {
    try {
      const limit = Math.min(params.limit || 10, 50);
      const encodedQuery = encodeURIComponent(params.query);
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodedQuery}&size=${limit}`;

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        return {
          success: false,
          error: {
            message: `npm registry returned HTTP ${response.status}: ${response.statusText}`,
            code: 'NPM_SEARCH_HTTP_ERROR',
            recoverable: true
          }
        };
      }

      const data = await response.json() as {
        total: number;
        objects: Array<{
          package: {
            name: string;
            version: string;
            description?: string;
            keywords?: string[];
            publisher?: { username: string };
            date?: string;
          };
          score: { final: number };
        }>;
      };

      const packages = data.objects.map(obj => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description || '',
        keywords: obj.package.keywords || [],
        publisher: obj.package.publisher?.username || 'unknown',
        date: obj.package.date || '',
        score: Math.round(obj.score.final * 100) / 100
      }));

      return {
        success: true,
        data: {
          query: params.query,
          total: data.total,
          count: packages.length,
          packages
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `npm search failed: ${error.message}`,
          code: 'NPM_SEARCH_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * Check for outdated packages
 */
export const npmOutdated = defineTool<Record<string, never>>(
  'npm_outdated',
  'Check for outdated npm packages in the project. Returns current, wanted, and latest versions for each outdated package.',
  {
    type: 'object',
    properties: {},
    required: []
  },
  async (_params, context): Promise<ToolResult> => {
    try {
      const { stdout } = await execAsync('npm outdated --json', {
        cwd: context.projectRoot,
        timeout: context.securityConfig.maxExecutionTime,
        env: { ...process.env, ...context.env },
        maxBuffer: 10 * 1024 * 1024
      });

      // npm outdated returns exit code 1 when there are outdated packages
      // but the JSON output is still valid
      const jsonOutput = stdout.trim();

      if (!jsonOutput || jsonOutput === '{}') {
        return {
          success: true,
          data: {
            outdated: {},
            count: 0,
            message: 'All packages are up to date'
          }
        };
      }

      const outdated = JSON.parse(jsonOutput) as Record<string, {
        current: string;
        wanted: string;
        latest: string;
        dependent: string;
        location: string;
      }>;

      const count = Object.keys(outdated).length;

      return {
        success: true,
        data: {
          outdated,
          count,
          message: count > 0
            ? `${count} outdated package${count === 1 ? '' : 's'} found`
            : 'All packages are up to date'
        }
      };
    } catch (error: any) {
      // npm outdated exits with code 1 when packages are outdated, which throws
      if (error.stdout) {
        try {
          const outdated = JSON.parse(error.stdout.trim()) as Record<string, {
            current: string;
            wanted: string;
            latest: string;
            dependent: string;
            location: string;
          }>;
          const count = Object.keys(outdated).length;

          return {
            success: true,
            data: {
              outdated,
              count,
              message: `${count} outdated package${count === 1 ? '' : 's'} found`
            }
          };
        } catch {
          // JSON parse failed, fall through to error
        }
      }

      return {
        success: false,
        error: {
          message: `npm outdated failed: ${error.message}`,
          code: 'NPM_OUTDATED_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * All npm tools
 */
export const NPM_TOOLS: Tool[] = [
  npmInstall,
  npmRun,
  npmSearch,
  npmOutdated
];

/**
 * Register all npm tools with a registry
 */
export function registerNpmTools(registry: import('./registry').ToolRegistry): void {
  for (const tool of NPM_TOOLS) {
    registry.register(tool);
  }
}

export default NPM_TOOLS;
