/**
 * Security module - Path validation, command allowlists, execution timeouts
 */

import path from 'node:path';
import { SecurityConfig, ToolResult, Tool, ToolContext } from './registry';

// Re-export SecurityConfig for convenience
export type { SecurityConfig } from './registry';

// Default security configurations for different modes
export const DEFAULT_SECURITY_CONFIGS: Record<string, SecurityConfig> = {
  pro: {
    allowedCommands: '*',
    blockedPaths: [
      '/etc/passwd',
      '/etc/shadow',
      'C:\\Windows\\System32\\config',
      '.env.local',
      '.env.production'
    ],
    maxFileSize: 50 * 1024 * 1024, // 50MB
    maxExecutionTime: 300000, // 5 minutes
    networkAccess: 'full'
  },
  kid: {
    allowedCommands: [
      'npm run dev',
      'npm run build',
      'npm run start',
      'npm test',
      'npx prisma generate',
      'npx prisma migrate dev',
      'npx prisma db push'
    ],
    blockedPaths: [
      '../',
      '..\\',
      '/etc',
      '/usr',
      '/var',
      'C:\\Windows',
      'C:\\Program Files',
      'C:\\Users\\*\\AppData',
      'node_modules',
      '.git',
      '.env'
    ],
    maxFileSize: 1 * 1024 * 1024, // 1MB
    maxExecutionTime: 30000, // 30 seconds
    networkAccess: 'localhost-only'
  }
};

/**
 * Normalize a file path for cross-platform compatibility
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Resolve a path relative to project root
 */
export function resolvePath(filePath: string, projectRoot: string): string {
  const normalized = normalizePath(filePath);

  // If already absolute, return as is
  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  // Resolve relative to project root
  return normalizePath(path.join(projectRoot, normalized));
}

/**
 * Check if a path is within the allowed project directory
 */
export function isPathWithinProject(filePath: string, projectRoot: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(projectRoot);

  return resolvedPath.startsWith(resolvedRoot);
}

/**
 * Check if a path matches any blocked pattern
 */
export function isPathBlocked(filePath: string, blockedPaths: string[]): boolean {
  const normalized = normalizePath(filePath).toLowerCase();

  for (const blocked of blockedPaths) {
    const normalizedBlocked = normalizePath(blocked).toLowerCase();

    // Handle wildcard patterns
    if (normalizedBlocked.includes('*')) {
      const regex = new RegExp(
        '^' + normalizedBlocked.replace(/\*/g, '.*') + '$',
        'i'
      );
      if (regex.test(normalized)) {
        return true;
      }
    } else {
      // Exact match or contains
      if (normalized.includes(normalizedBlocked)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate a file path against security config
 */
export function validatePath(
  filePath: string,
  projectRoot: string,
  config: SecurityConfig
): { valid: boolean; error?: string } {
  const resolved = resolvePath(filePath, projectRoot);

  // Check if path is within project (for non-absolute paths)
  if (!path.isAbsolute(filePath) && !isPathWithinProject(resolved, projectRoot)) {
    return {
      valid: false,
      error: `Path '${filePath}' resolves outside project directory`
    };
  }

  // Check blocked paths
  if (isPathBlocked(resolved, config.blockedPaths)) {
    return {
      valid: false,
      error: `Path '${filePath}' is blocked by security policy`
    };
  }

  // Check for path traversal attempts
  if (filePath.includes('..')) {
    const normalizedResolved = normalizePath(path.resolve(projectRoot, filePath));
    if (!normalizedResolved.startsWith(normalizePath(projectRoot))) {
      return {
        valid: false,
        error: 'Path traversal attempt detected'
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a command against security config
 */
export function validateCommand(
  command: string,
  config: SecurityConfig
): { valid: boolean; error?: string } {
  // Allow all commands in pro mode
  if (config.allowedCommands === '*') {
    return { valid: true };
  }

  const trimmedCommand = command.trim();

  // Check against allowlist
  const isAllowed = config.allowedCommands.some(allowed => {
    // Exact match
    if (trimmedCommand === allowed) {
      return true;
    }

    // Command starts with allowed prefix (for commands with arguments)
    if (trimmedCommand.startsWith(allowed + ' ')) {
      return true;
    }

    return false;
  });

  if (!isAllowed) {
    return {
      valid: false,
      error: `Command '${command}' is not in the allowed commands list`
    };
  }

  // Check for dangerous patterns even in allowed commands
  const dangerousPatterns = [
    /rm\s+-rf\s+\//,          // rm -rf /
    /del\s+\/s\s+\/q\s+c:\\/i, // del /s /q c:\
    /format\s+c:/i,            // format c:
    />\s*\/dev\/null/,         // redirect to /dev/null
    /\|\s*bash/,               // pipe to bash
    /eval\s*\(/,               // eval()
    /`.*`/,                    // backtick command substitution
    /\$\(.*\)/                 // $() command substitution
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmedCommand)) {
      return {
        valid: false,
        error: 'Command contains potentially dangerous pattern'
      };
    }
  }

  return { valid: true };
}

/**
 * Execute a function with a timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutError = 'Operation timed out'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutError));
    }, timeoutMs);

    fn()
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Wrap a tool with security checks
 */
export function wrapWithSecurity(tool: Tool, config: SecurityConfig): Tool {
  return {
    ...tool,
    execute: async (params: any, context: ToolContext): Promise<ToolResult> => {
      // Override context security config with provided config
      const securedContext: ToolContext = {
        ...context,
        securityConfig: config
      };

      // Apply timeout to execution
      try {
        return await withTimeout(
          () => tool.execute(params, securedContext),
          config.maxExecutionTime,
          `Tool '${tool.name}' execution timed out after ${config.maxExecutionTime}ms`
        );
      } catch (error: any) {
        return {
          success: false,
          error: {
            message: error.message,
            code: error.message.includes('timed out') ? 'TIMEOUT' : 'EXECUTION_ERROR',
            recoverable: true
          }
        };
      }
    }
  };
}

/**
 * Create a backup of a file before modification
 */
export async function createBackup(filePath: string): Promise<string | null> {
  const fs = await import('node:fs/promises');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const backupPath = `${filePath}.backup.${Date.now()}`;
    await fs.writeFile(backupPath, content);
    return backupPath;
  } catch (error) {
    // File doesn't exist yet, no backup needed
    return null;
  }
}

/**
 * Restore a file from backup
 */
export async function restoreFromBackup(backupPath: string, originalPath: string): Promise<void> {
  const fs = await import('node:fs/promises');

  const content = await fs.readFile(backupPath, 'utf-8');
  await fs.writeFile(originalPath, content);
  await fs.unlink(backupPath);
}

/**
 * Sanitize user input to prevent injection attacks
 */
export function sanitizeInput(input: string): string {
  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');

  // Limit length
  if (sanitized.length > 10000) {
    sanitized = sanitized.substring(0, 10000);
  }

  return sanitized;
}

/**
 * Check if a URL is safe to fetch (for network operations)
 */
export function isUrlAllowed(url: string, networkAccess: SecurityConfig['networkAccess']): boolean {
  if (networkAccess === 'none') {
    return false;
  }

  try {
    const parsed = new URL(url);

    if (networkAccess === 'localhost-only') {
      const localhostHosts = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
      return localhostHosts.includes(parsed.hostname);
    }

    // Full access - still block some dangerous protocols
    const blockedProtocols = ['file:', 'javascript:', 'data:'];
    return !blockedProtocols.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Get security config for a specific mode
 */
export function getSecurityConfig(mode: 'pro' | 'kid' = 'pro'): SecurityConfig {
  return { ...DEFAULT_SECURITY_CONFIGS[mode] };
}
