/**
 * Test Tools - Test runner operations for the agent
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Tool, ToolResult, defineTool } from './registry';

const execAsync = promisify(exec);

/**
 * Parse test output to extract pass/fail counts
 */
function parseTestOutput(stdout: string, stderr: string): {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  suites: number;
  duration?: string;
} {
  const combined = stdout + '\n' + stderr;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let suites = 0;
  let duration: string | undefined;

  // Jest-style output: "Tests: X passed, Y failed, Z total"
  const jestTestMatch = combined.match(/Tests:\s*(?:(\d+)\s*passed)?[,\s]*(?:(\d+)\s*failed)?[,\s]*(?:(\d+)\s*skipped)?[,\s]*(\d+)\s*total/i);
  if (jestTestMatch) {
    passed = parseInt(jestTestMatch[1] || '0', 10);
    failed = parseInt(jestTestMatch[2] || '0', 10);
    skipped = parseInt(jestTestMatch[3] || '0', 10);
    const total = parseInt(jestTestMatch[4] || '0', 10);
    return { passed, failed, skipped, total, suites, duration };
  }

  // Jest suite line: "Test Suites: X passed, Y total"
  const suiteMatch = combined.match(/Test Suites:\s*(?:(\d+)\s*passed)?[,\s]*(?:(\d+)\s*failed)?[,\s]*(\d+)\s*total/i);
  if (suiteMatch) {
    suites = parseInt(suiteMatch[3] || '0', 10);
  }

  // Vitest-style output: "Tests  X passed | Y failed | Z total"
  const vitestMatch = combined.match(/Tests\s+(\d+)\s*passed\s*(?:\|\s*(\d+)\s*failed)?\s*(?:\|\s*(\d+)\s*skipped)?\s*\|\s*(\d+)\s*total/i);
  if (vitestMatch) {
    passed = parseInt(vitestMatch[1] || '0', 10);
    failed = parseInt(vitestMatch[2] || '0', 10);
    skipped = parseInt(vitestMatch[3] || '0', 10);
    const total = parseInt(vitestMatch[4] || '0', 10);
    return { passed, failed, skipped, total, suites, duration };
  }

  // Mocha-style: "X passing" / "Y failing"
  const mochaPassMatch = combined.match(/(\d+)\s*passing/i);
  const mochaFailMatch = combined.match(/(\d+)\s*failing/i);
  const mochaPendMatch = combined.match(/(\d+)\s*pending/i);
  if (mochaPassMatch || mochaFailMatch) {
    passed = parseInt(mochaPassMatch?.[1] || '0', 10);
    failed = parseInt(mochaFailMatch?.[1] || '0', 10);
    skipped = parseInt(mochaPendMatch?.[1] || '0', 10);
    const total = passed + failed + skipped;
    return { passed, failed, skipped, total, suites, duration };
  }

  // Duration parsing
  const durationMatch = combined.match(/(?:Time|Duration):\s*([\d.]+\s*(?:ms|s|m))/i);
  if (durationMatch) {
    duration = durationMatch[1];
  }

  // Fallback: count checkmarks and X marks
  const passLines = (combined.match(/[✓✔]/g) || []).length;
  const failLines = (combined.match(/[✗✘✖]/g) || []).length;
  if (passLines > 0 || failLines > 0) {
    passed = passLines;
    failed = failLines;
  }

  const total = passed + failed + skipped;
  return { passed, failed, skipped, total, suites, duration };
}

/**
 * Run the project test suite
 */
export const runTests = defineTool<{
  command?: string;
  grep?: string;
  watch?: boolean;
  coverage?: boolean;
}>(
  'run_tests',
  'Run the project test suite using `npm test` or a custom command. Parses output for pass/fail/skip counts.',
  {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Custom test command to run (default: "npm test")'
      },
      grep: {
        type: 'string',
        description: 'Filter tests by name pattern (passed via -- --grep for Jest/Vitest)'
      },
      watch: {
        type: 'boolean',
        description: 'Run tests in watch mode (not recommended for agent use)',
        default: false
      },
      coverage: {
        type: 'boolean',
        description: 'Collect code coverage (passed via -- --coverage)',
        default: false
      }
    }
  },
  async (params, context): Promise<ToolResult> => {
    try {
      let command = params.command || 'npm test';

      // Build additional args
      const extraArgs: string[] = [];

      if (params.grep) {
        extraArgs.push(`--grep "${params.grep}"`);
      }

      if (params.coverage) {
        extraArgs.push('--coverage');
      }

      if (params.watch) {
        extraArgs.push('--watch');
      }

      if (extraArgs.length > 0 && !params.command) {
        command += ` -- ${extraArgs.join(' ')}`;
      } else if (extraArgs.length > 0 && params.command) {
        command += ` ${extraArgs.join(' ')}`;
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: context.projectRoot,
        timeout: context.securityConfig.maxExecutionTime,
        env: {
          ...process.env,
          ...context.env,
          CI: 'true',
          FORCE_COLOR: '0'
        },
        maxBuffer: 10 * 1024 * 1024
      });

      const results = parseTestOutput(stdout, stderr);

      return {
        success: true,
        data: {
          command,
          ...results,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          allPassing: results.failed === 0
        }
      };
    } catch (error: any) {
      // Tests may fail with non-zero exit code but still produce parseable output
      const stdout = error.stdout?.trim() || '';
      const stderr = error.stderr?.trim() || '';
      const results = parseTestOutput(stdout, stderr);

      return {
        success: results.total > 0, // Considered success if we got test results
        data: {
          command: params.command || 'npm test',
          ...results,
          stdout,
          stderr,
          allPassing: false,
          exitCode: error.code || 1
        },
        error: results.total === 0 ? {
          message: `Test execution failed: ${stderr || error.message}`,
          code: 'TEST_EXECUTION_ERROR',
          recoverable: true
        } : undefined
      };
    }
  }
);

/**
 * Run a specific test file
 */
export const runSingleTest = defineTool<{
  file: string;
  testName?: string;
  command?: string;
}>(
  'run_single_test',
  'Run a specific test file. Detects the test framework and runs accordingly.',
  {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Path to the test file (relative to project root or absolute)'
      },
      testName: {
        type: 'string',
        description: 'Specific test name or pattern to run within the file'
      },
      command: {
        type: 'string',
        description: 'Custom command template. Use {file} as placeholder for the test file path.'
      }
    },
    required: ['file']
  },
  async (params, context): Promise<ToolResult> => {
    try {
      const testFile = path.isAbsolute(params.file)
        ? params.file
        : path.join(context.projectRoot, params.file);

      // Determine relative path for the command
      const relativePath = path.relative(context.projectRoot, testFile).replace(/\\/g, '/');

      let command: string;

      if (params.command) {
        // Use custom command template
        command = params.command.replace(/\{file\}/g, relativePath);
      } else {
        // Default: use npx to run the appropriate test runner
        // Jest/Vitest can accept a file path directly
        command = `npx vitest run "${relativePath}"`;

        if (params.testName) {
          command += ` -t "${params.testName}"`;
        }
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: context.projectRoot,
        timeout: context.securityConfig.maxExecutionTime,
        env: {
          ...process.env,
          ...context.env,
          CI: 'true',
          FORCE_COLOR: '0'
        },
        maxBuffer: 10 * 1024 * 1024
      });

      const results = parseTestOutput(stdout, stderr);

      return {
        success: true,
        data: {
          command,
          file: relativePath,
          testName: params.testName || null,
          ...results,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          allPassing: results.failed === 0
        }
      };
    } catch (error: any) {
      const stdout = error.stdout?.trim() || '';
      const stderr = error.stderr?.trim() || '';
      const results = parseTestOutput(stdout, stderr);

      return {
        success: results.total > 0,
        data: {
          command: params.command || `npx vitest run "${params.file}"`,
          file: params.file,
          testName: params.testName || null,
          ...results,
          stdout,
          stderr,
          allPassing: false,
          exitCode: error.code || 1
        },
        error: results.total === 0 ? {
          message: `Test file execution failed: ${stderr || error.message}`,
          code: 'TEST_FILE_ERROR',
          recoverable: true
        } : undefined
      };
    }
  }
);

/**
 * All test tools
 */
export const TEST_TOOLS: Tool[] = [
  runTests,
  runSingleTest
];

/**
 * Register all test tools with a registry
 */
export function registerTestTools(registry: import('./registry').ToolRegistry): void {
  for (const tool of TEST_TOOLS) {
    registry.register(tool);
  }
}

export default TEST_TOOLS;
