/**
 * Sandbox Manager
 *
 * Provides security enforcement and resource limits for command execution,
 * especially in Kid mode.
 */

import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

export interface SandboxConfig {
  projectRoot: string;
  mode: 'pro' | 'kid';
  restrictions: SandboxRestrictions;
}

export interface SandboxRestrictions {
  allowedCommands: string[] | '*';
  blockedCommands: string[];
  allowedPaths: string[];
  blockedPaths: string[];
  maxExecutionTime: number; // ms
  maxMemory: number; // bytes
  maxCpuPercent: number;
  networkAccess: 'full' | 'localhost-only' | 'none';
  environmentVariables: Record<string, string>;
}

export interface SandboxedProcess {
  process: ChildProcess;
  pid: number;
  command: string;
  startTime: number;
  config: SandboxConfig;
  killed: boolean;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  executionTimeMs: number;
  killed: boolean;
  error?: string;
}

const DEFAULT_KID_MODE_RESTRICTIONS: SandboxRestrictions = {
  allowedCommands: [
    'npm',
    'npx',
    'node',
    'pnpm',
    'yarn',
    'prisma',
    'next'
  ],
  blockedCommands: [
    'rm',
    'del',
    'rmdir',
    'format',
    'shutdown',
    'reboot',
    'curl',
    'wget',
    'ssh',
    'scp',
    'ftp',
    'telnet',
    'nc',
    'netcat',
    'python',
    'ruby',
    'perl',
    'powershell',
    'cmd',
    'bash',
    'sh',
    'git push',
    'git remote',
    'eval',
    'exec'
  ],
  allowedPaths: [], // Will be set to project root
  blockedPaths: [
    '/',
    'C:\\',
    '/etc',
    '/usr',
    '/var',
    '/bin',
    '/sbin',
    '%SYSTEMROOT%',
    '%PROGRAMFILES%',
    '%APPDATA%'
  ],
  maxExecutionTime: 30000, // 30 seconds
  maxMemory: 536870912, // 512MB
  maxCpuPercent: 50,
  networkAccess: 'localhost-only',
  environmentVariables: {}
};

const DEFAULT_PRO_MODE_RESTRICTIONS: SandboxRestrictions = {
  allowedCommands: '*',
  blockedCommands: [
    'rm -rf /',
    'del /s /q C:\\',
    'format',
    'shutdown -h now',
    'reboot'
  ],
  allowedPaths: [], // No restrictions
  blockedPaths: [],
  maxExecutionTime: 300000, // 5 minutes
  maxMemory: 2147483648, // 2GB
  maxCpuPercent: 90,
  networkAccess: 'full',
  environmentVariables: {}
};

/**
 * Sandbox Manager Class
 */
export class SandboxManager {
  private activeProcesses: Map<number, SandboxedProcess> = new Map();
  private config: SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = {
      ...config,
      restrictions: {
        ...(config.mode === 'kid' ? DEFAULT_KID_MODE_RESTRICTIONS : DEFAULT_PRO_MODE_RESTRICTIONS),
        ...config.restrictions,
        allowedPaths: config.restrictions.allowedPaths.length > 0
          ? config.restrictions.allowedPaths
          : [config.projectRoot]
      }
    };
  }

  /**
   * Update sandbox configuration
   */
  updateConfig(config: Partial<SandboxConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      restrictions: {
        ...this.config.restrictions,
        ...config.restrictions
      }
    };
  }

  /**
   * Check if a command is allowed
   */
  isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    const commandLower = command.toLowerCase().trim();
    const firstWord = commandLower.split(/\s+/)[0];

    // Check blocked commands
    for (const blocked of this.config.restrictions.blockedCommands) {
      if (commandLower.includes(blocked.toLowerCase())) {
        return { allowed: false, reason: `Command contains blocked pattern: ${blocked}` };
      }
    }

    // Check allowlist if not '*'
    if (this.config.restrictions.allowedCommands !== '*') {
      const isAllowed = this.config.restrictions.allowedCommands.some(
        allowed => firstWord === allowed.toLowerCase() || firstWord.startsWith(allowed.toLowerCase())
      );
      if (!isAllowed) {
        return { allowed: false, reason: `Command '${firstWord}' is not in the allowed list` };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if a path is allowed
   */
  isPathAllowed(targetPath: string): { allowed: boolean; reason?: string } {
    const normalizedPath = path.normalize(targetPath).toLowerCase();

    // Check blocked paths
    for (const blocked of this.config.restrictions.blockedPaths) {
      const normalizedBlocked = path.normalize(blocked).toLowerCase();
      if (normalizedPath.startsWith(normalizedBlocked)) {
        return { allowed: false, reason: `Path is in blocked location: ${blocked}` };
      }
    }

    // Check allowed paths
    if (this.config.restrictions.allowedPaths.length > 0) {
      const isAllowed = this.config.restrictions.allowedPaths.some(allowed => {
        const normalizedAllowed = path.normalize(allowed).toLowerCase();
        return normalizedPath.startsWith(normalizedAllowed);
      });
      if (!isAllowed) {
        return { allowed: false, reason: 'Path is outside allowed locations' };
      }
    }

    return { allowed: true };
  }

  /**
   * Execute a command in the sandbox
   */
  async execute(
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    } = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Check command allowance
    const commandCheck = this.isCommandAllowed(command);
    if (!commandCheck.allowed) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        exitCode: -1,
        executionTimeMs: Date.now() - startTime,
        killed: false,
        error: commandCheck.reason
      };
    }

    // Check path allowance
    const cwd = options.cwd || this.config.projectRoot;
    const pathCheck = this.isPathAllowed(cwd);
    if (!pathCheck.allowed) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        exitCode: -1,
        executionTimeMs: Date.now() - startTime,
        killed: false,
        error: pathCheck.reason
      };
    }

    // Prepare environment
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.config.restrictions.environmentVariables,
      ...options.env,
    };

    // Apply network restrictions
    if (this.config.restrictions.networkAccess === 'none') {
      // Note: True network isolation requires OS-level features
      env.HTTP_PROXY = 'http://0.0.0.0:0';
      env.HTTPS_PROXY = 'http://0.0.0.0:0';
      env.NO_PROXY = '';
    } else if (this.config.restrictions.networkAccess === 'localhost-only') {
      env.HTTP_PROXY = '';
      env.HTTPS_PROXY = '';
      env.NO_PROXY = 'localhost,127.0.0.1';
    }

    const timeout = options.timeout || this.config.restrictions.maxExecutionTime;

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      // Parse command into parts
      const parts = this.parseCommand(command);
      const child = spawn(parts[0], parts.slice(1), {
        cwd,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (!child.pid) {
        resolve({
          success: false,
          stdout: '',
          stderr: '',
          exitCode: -1,
          executionTimeMs: Date.now() - startTime,
          killed: false,
          error: 'Failed to spawn process'
        });
        return;
      }

      const sandboxedProcess: SandboxedProcess = {
        process: child,
        pid: child.pid,
        command,
        startTime,
        config: this.config,
        killed: false
      };

      this.activeProcesses.set(child.pid, sandboxedProcess);

      // Set timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        sandboxedProcess.killed = true;
        child.kill('SIGKILL');
      }, timeout);

      // Collect output
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Truncate if too large
        if (stdout.length > 1000000) {
          stdout = stdout.slice(-500000);
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 1000000) {
          stderr = stderr.slice(-500000);
        }
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(child.pid!);

        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code,
          executionTimeMs: Date.now() - startTime,
          killed,
          error: killed ? 'Process killed due to timeout' : undefined
        });
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(child.pid!);

        resolve({
          success: false,
          stdout,
          stderr,
          exitCode: -1,
          executionTimeMs: Date.now() - startTime,
          killed: false,
          error: err.message
        });
      });
    });
  }

  /**
   * Parse command string into parts
   */
  private parseCommand(command: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if ((char === '"' || char === "'") && (i === 0 || command[i - 1] !== '\\')) {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
          quoteChar = '';
        } else {
          current += char;
        }
      } else if (char === ' ' && !inQuote) {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Kill a running process
   */
  kill(pid: number): boolean {
    const process = this.activeProcesses.get(pid);
    if (process) {
      process.killed = true;
      process.process.kill('SIGKILL');
      this.activeProcesses.delete(pid);
      return true;
    }
    return false;
  }

  /**
   * Kill all running processes
   */
  killAll(): number {
    let killed = 0;
    for (const [, process] of this.activeProcesses) {
      process.killed = true;
      process.process.kill('SIGKILL');
      killed++;
    }
    this.activeProcesses.clear();
    return killed;
  }

  /**
   * Get active process count
   */
  getActiveCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Get active processes info
   */
  getActiveProcesses(): Array<{
    pid: number;
    command: string;
    runningTimeMs: number;
  }> {
    const now = Date.now();
    return Array.from(this.activeProcesses.values()).map(p => ({
      pid: p.pid,
      command: p.command,
      runningTimeMs: now - p.startTime
    }));
  }

  /**
   * Create a sandbox with project-specific config
   */
  static forProject(projectRoot: string, mode: 'pro' | 'kid'): SandboxManager {
    return new SandboxManager({
      projectRoot,
      mode,
      restrictions: mode === 'kid'
        ? { ...DEFAULT_KID_MODE_RESTRICTIONS, allowedPaths: [projectRoot] }
        : { ...DEFAULT_PRO_MODE_RESTRICTIONS, allowedPaths: [] }
    });
  }
}

// Singleton for global use
let globalSandbox: SandboxManager | null = null;

export function getGlobalSandbox(): SandboxManager {
  if (!globalSandbox) {
    globalSandbox = new SandboxManager({
      projectRoot: process.cwd(),
      mode: 'pro',
      restrictions: DEFAULT_PRO_MODE_RESTRICTIONS
    });
  }
  return globalSandbox;
}

export function setGlobalSandbox(sandbox: SandboxManager): void {
  // Kill any processes from the old sandbox
  globalSandbox?.killAll();
  globalSandbox = sandbox;
}

export { DEFAULT_KID_MODE_RESTRICTIONS, DEFAULT_PRO_MODE_RESTRICTIONS };
export default SandboxManager;
