/**
 * Lint Tools - Code quality and formatting operations for the agent
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ToolResult, defineTool } from './registry';

const execAsync = promisify(exec);

/**
 * Run ESLint on a file or directory
 */
export const eslintCheck = defineTool<{
  path?: string;
  fix?: boolean;
  format?: string;
}>(
  'eslint_check',
  'Run ESLint on a file or directory to check for linting errors and warnings. Optionally auto-fix issues.',
  {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File or directory path to lint (relative to project root). Defaults to "src/".'
      },
      fix: {
        type: 'boolean',
        description: 'Automatically fix fixable problems (default: false)',
        default: false
      },
      format: {
        type: 'string',
        description: 'Output format: "stylish" (default), "json", "compact"',
        default: 'stylish',
        enum: ['stylish', 'json', 'compact']
      }
    }
  },
  async (params, context): Promise<ToolResult> => {
    try {
      const targetPath = params.path || 'src/';
      const format = params.format || 'stylish';

      const args: string[] = [targetPath];

      if (params.fix) {
        args.push('--fix');
      }

      args.push(`--format ${format}`);

      // Use --no-error-on-unmatched-pattern to avoid errors when no files match
      args.push('--no-error-on-unmatched-pattern');

      const command = `npx eslint ${args.join(' ')}`;

      const { stdout, stderr } = await execAsync(command, {
        cwd: context.projectRoot,
        timeout: context.securityConfig.maxExecutionTime,
        env: { ...process.env, ...context.env },
        maxBuffer: 10 * 1024 * 1024
      });

      // Parse results
      let errorCount = 0;
      let warningCount = 0;
      let fixableCount = 0;

      if (format === 'json' && stdout.trim()) {
        try {
          const results = JSON.parse(stdout.trim()) as Array<{
            errorCount: number;
            warningCount: number;
            fixableErrorCount: number;
            fixableWarningCount: number;
          }>;
          for (const result of results) {
            errorCount += result.errorCount;
            warningCount += result.warningCount;
            fixableCount += result.fixableErrorCount + result.fixableWarningCount;
          }
        } catch {
          // JSON parse failed, fall through to regex parsing
        }
      } else {
        // Parse stylish/compact output for summary line
        const summaryMatch = stdout.match(/(\d+)\s*error/i);
        const warningMatch = stdout.match(/(\d+)\s*warning/i);
        const fixableMatch = stdout.match(/(\d+)\s*(?:error|warning|problem)s?\s*(?:are\s*)?potentially\s*fixable/i);

        errorCount = summaryMatch ? parseInt(summaryMatch[1], 10) : 0;
        warningCount = warningMatch ? parseInt(warningMatch[1], 10) : 0;
        fixableCount = fixableMatch ? parseInt(fixableMatch[1], 10) : 0;
      }

      return {
        success: true,
        data: {
          command,
          path: targetPath,
          errorCount,
          warningCount,
          fixableCount,
          fixed: params.fix || false,
          clean: errorCount === 0 && warningCount === 0,
          output: stdout.trim(),
          stderr: stderr.trim()
        }
      };
    } catch (error: any) {
      // ESLint exits with code 1 when there are linting errors
      const stdout = error.stdout?.trim() || '';
      const stderr = error.stderr?.trim() || '';

      // Try to parse the output even on error
      let errorCount = 0;
      let warningCount = 0;

      const summaryMatch = stdout.match(/(\d+)\s*error/i);
      const warningMatch = stdout.match(/(\d+)\s*warning/i);
      errorCount = summaryMatch ? parseInt(summaryMatch[1], 10) : 0;
      warningCount = warningMatch ? parseInt(warningMatch[1], 10) : 0;

      if (errorCount > 0 || warningCount > 0) {
        // ESLint found issues but ran successfully
        return {
          success: true,
          data: {
            command: `npx eslint ${params.path || 'src/'}`,
            path: params.path || 'src/',
            errorCount,
            warningCount,
            clean: false,
            output: stdout,
            stderr
          }
        };
      }

      return {
        success: false,
        error: {
          message: `ESLint failed: ${stderr || error.message}`,
          code: 'ESLINT_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * Format a file with Prettier
 */
export const prettierFormat = defineTool<{
  path: string;
  check?: boolean;
  write?: boolean;
}>(
  'prettier_format',
  'Format a file or directory with Prettier. Can check formatting or write changes directly.',
  {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File or glob pattern to format (e.g., "src/App.tsx" or "src/**/*.ts")'
      },
      check: {
        type: 'boolean',
        description: 'Only check formatting without writing changes (default: false)',
        default: false
      },
      write: {
        type: 'boolean',
        description: 'Write formatted output back to the file (default: true)',
        default: true
      }
    },
    required: ['path']
  },
  async (params, context): Promise<ToolResult> => {
    try {
      const args: string[] = [];

      if (params.check) {
        args.push('--check');
      } else if (params.write !== false) {
        args.push('--write');
      }

      args.push(`"${params.path}"`);

      const command = `npx prettier ${args.join(' ')}`;

      const { stdout, stderr } = await execAsync(command, {
        cwd: context.projectRoot,
        timeout: context.securityConfig.maxExecutionTime,
        env: { ...process.env, ...context.env },
        maxBuffer: 10 * 1024 * 1024
      });

      // Parse check results
      let filesChecked = 0;
      let filesChanged = 0;

      const lines = stdout.trim().split('\n').filter(l => l.trim());
      filesChecked = lines.length;

      if (params.check) {
        // In check mode, Prettier lists files that would be changed
        filesChanged = lines.length;
      }

      return {
        success: true,
        data: {
          command,
          path: params.path,
          mode: params.check ? 'check' : 'write',
          filesChecked,
          filesChanged,
          allFormatted: filesChanged === 0,
          output: stdout.trim(),
          stderr: stderr.trim()
        }
      };
    } catch (error: any) {
      // Prettier exits with code 1 when files are not formatted (--check mode)
      const stdout = error.stdout?.trim() || '';
      const stderr = error.stderr?.trim() || '';

      if (params.check && stdout) {
        const unformattedFiles = stdout.split('\n').filter((l: string) => l.trim());
        return {
          success: true,
          data: {
            command: `npx prettier --check "${params.path}"`,
            path: params.path,
            mode: 'check',
            filesChanged: unformattedFiles.length,
            allFormatted: false,
            unformattedFiles,
            output: stdout,
            stderr
          }
        };
      }

      return {
        success: false,
        error: {
          message: `Prettier failed: ${stderr || error.message}`,
          code: 'PRETTIER_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * Run TypeScript compiler check
 */
export const tscCheck = defineTool<{
  project?: string;
  strict?: boolean;
}>(
  'tsc_check',
  'Run the TypeScript compiler in check mode (--noEmit) to find type errors without producing output files.',
  {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Path to tsconfig.json (default: auto-detected by tsc)'
      },
      strict: {
        type: 'boolean',
        description: 'Enable strict mode checking (default: uses tsconfig setting)',
        default: false
      }
    }
  },
  async (params, context): Promise<ToolResult> => {
    try {
      const args: string[] = ['--noEmit'];

      if (params.project) {
        args.push(`--project "${params.project}"`);
      }

      if (params.strict) {
        args.push('--strict');
      }

      const command = `npx tsc ${args.join(' ')}`;

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
          errorCount: 0,
          errors: [],
          clean: true,
          output: stdout.trim(),
          stderr: stderr.trim()
        }
      };
    } catch (error: any) {
      // tsc exits with code 2 when there are type errors
      const stdout = error.stdout?.trim() || '';
      const stderr = error.stderr?.trim() || '';
      const combined = stdout + '\n' + stderr;

      // Parse TypeScript errors: "src/file.ts(10,5): error TS2322: ..."
      const errorRegex = /^(.+?)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)$/gm;
      const errors: Array<{
        file: string;
        line: number;
        column: number;
        code: string;
        message: string;
      }> = [];

      let match;
      while ((match = errorRegex.exec(combined)) !== null) {
        errors.push({
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          code: match[4],
          message: match[5]
        });
      }

      // Also count "Found N errors" summary
      let errorCount = errors.length;
      const foundMatch = combined.match(/Found\s+(\d+)\s+error/i);
      if (foundMatch) {
        errorCount = parseInt(foundMatch[1], 10);
      }

      if (errors.length > 0 || errorCount > 0) {
        return {
          success: true,
          data: {
            command: `npx tsc --noEmit`,
            errorCount,
            errors: errors.slice(0, 50), // Limit to first 50 errors
            clean: false,
            output: combined
          }
        };
      }

      return {
        success: false,
        error: {
          message: `TypeScript check failed: ${stderr || error.message}`,
          code: 'TSC_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * All lint tools
 */
export const LINT_TOOLS: Tool[] = [
  eslintCheck,
  prettierFormat,
  tscCheck
];

/**
 * Register all lint tools with a registry
 */
export function registerLintTools(registry: import('./registry').ToolRegistry): void {
  for (const tool of LINT_TOOLS) {
    registry.register(tool);
  }
}

export default LINT_TOOLS;
