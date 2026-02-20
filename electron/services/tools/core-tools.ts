/**
 * Core Tools - Essential file and command operations for the agent
 */

import { readFile, writeFile, readdir, mkdir, unlink, stat } from 'node:fs/promises';
import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { Tool, ToolResult, defineTool } from './registry';
import {
  resolvePath,
  validatePath,
  validateCommand,
  createBackup,
  normalizePath
} from './security';

const execAsync = promisify(exec);

/**
 * Read file contents
 */
export const readFileTool = defineTool<{ path: string; encoding?: string }>(
  'read_file',
  'Read the contents of a file at the given path. Returns the file content as a string.',
  {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read (absolute or relative to project root)'
      },
      encoding: {
        type: 'string',
        description: 'The file encoding (default: utf-8)',
        default: 'utf-8'
      }
    },
    required: ['path']
  },
  async (params, context): Promise<ToolResult> => {
    const fullPath = resolvePath(params.path, context.projectRoot);

    // Validate path
    const pathValidation = validatePath(params.path, context.projectRoot, context.securityConfig);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: { message: pathValidation.error!, code: 'INVALID_PATH', recoverable: false }
      };
    }

    try {
      const encoding = (params.encoding || 'utf-8') as BufferEncoding;
      const content = await readFile(fullPath, { encoding });
      return {
        success: true,
        data: {
          content,
          path: fullPath,
          size: content.length
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Failed to read file: ${error.message}`,
          code: error.code || 'READ_ERROR',
          recoverable: error.code === 'ENOENT'
        }
      };
    }
  }
);

/**
 * Write file contents
 */
export const writeFileTool = defineTool<{
  path: string;
  content: string;
  createDirs?: boolean;
  backup?: boolean;
}>(
  'write_file',
  'Write content to a file, optionally creating parent directories. Returns the path and bytes written.',
  {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to write to (absolute or relative to project root)'
      },
      content: {
        type: 'string',
        description: 'The content to write to the file'
      },
      createDirs: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist (default: true)',
        default: true
      },
      backup: {
        type: 'boolean',
        description: 'Create a backup of existing file before overwriting (default: true)',
        default: true
      }
    },
    required: ['path', 'content']
  },
  async (params, context): Promise<ToolResult> => {
    const fullPath = resolvePath(params.path, context.projectRoot);

    // Validate path
    const pathValidation = validatePath(params.path, context.projectRoot, context.securityConfig);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: { message: pathValidation.error!, code: 'INVALID_PATH', recoverable: false }
      };
    }

    // Check file size
    if (params.content.length > context.securityConfig.maxFileSize) {
      return {
        success: false,
        error: {
          message: `File content exceeds maximum allowed size of ${context.securityConfig.maxFileSize} bytes`,
          code: 'FILE_TOO_LARGE',
          recoverable: false
        }
      };
    }

    try {
      // Create parent directories if needed
      if (params.createDirs !== false) {
        await mkdir(path.dirname(fullPath), { recursive: true });
      }

      // Create backup if file exists and backup is enabled
      let backupPath: string | null = null;
      if (params.backup !== false) {
        backupPath = await createBackup(fullPath);
      }

      // Write the file
      await writeFile(fullPath, params.content, 'utf-8');

      return {
        success: true,
        data: {
          path: fullPath,
          bytesWritten: params.content.length
        },
        rollback: backupPath
          ? { type: 'restore_file', path: fullPath, backup: backupPath }
          : { type: 'delete_file', path: fullPath }
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Failed to write file: ${error.message}`,
          code: error.code || 'WRITE_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * Edit file with search/replace operations
 */
export const editFileTool = defineTool<{
  path: string;
  edits: Array<{
    search: string;
    replace: string;
    regex?: boolean;
    all?: boolean;
  }>;
}>(
  'edit_file',
  'Apply search/replace edits to an existing file. More efficient than rewriting entire files for small changes.',
  {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to edit'
      },
      edits: {
        type: 'array',
        description: 'Array of edit operations to apply',
        items: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description: 'The text or regex pattern to find'
            },
            replace: {
              type: 'string',
              description: 'The replacement text'
            },
            regex: {
              type: 'boolean',
              description: 'Treat search as a regex pattern (default: false)',
              default: false
            },
            all: {
              type: 'boolean',
              description: 'Replace all occurrences (default: true)',
              default: true
            }
          },
          required: ['search', 'replace']
        }
      }
    },
    required: ['path', 'edits']
  },
  async (params, context): Promise<ToolResult> => {
    const fullPath = resolvePath(params.path, context.projectRoot);

    // Validate path
    const pathValidation = validatePath(params.path, context.projectRoot, context.securityConfig);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: { message: pathValidation.error!, code: 'INVALID_PATH', recoverable: false }
      };
    }

    try {
      // Read existing content
      let content = await readFile(fullPath, 'utf-8');
      const originalContent = content;

      // Create backup
      const backupPath = await createBackup(fullPath);

      // Apply edits
      let editsApplied = 0;
      for (const edit of params.edits) {
        const before = content;

        if (edit.regex) {
          const flags = edit.all !== false ? 'g' : '';
          const regex = new RegExp(edit.search, flags);
          content = content.replace(regex, edit.replace);
        } else if (edit.all !== false) {
          content = content.split(edit.search).join(edit.replace);
        } else {
          content = content.replace(edit.search, edit.replace);
        }

        if (content !== before) {
          editsApplied++;
        }
      }

      // Write if changed
      if (content !== originalContent) {
        await writeFile(fullPath, content, 'utf-8');
      }

      return {
        success: true,
        data: {
          path: fullPath,
          editsApplied,
          totalEdits: params.edits.length
        },
        rollback: backupPath
          ? { type: 'restore_file', path: fullPath, backup: backupPath }
          : undefined
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Failed to edit file: ${error.message}`,
          code: error.code || 'EDIT_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * List files matching a pattern
 */
export const listFilesTool = defineTool<{
  pattern?: string;
  path?: string;
  recursive?: boolean;
  includeHidden?: boolean;
}>(
  'list_files',
  'List files in a directory, optionally filtering by glob pattern. Returns array of file paths.',
  {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory to list (default: project root)'
      },
      pattern: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g., "*.ts", "**/*.tsx")'
      },
      recursive: {
        type: 'boolean',
        description: 'List files recursively (default: false)',
        default: false
      },
      includeHidden: {
        type: 'boolean',
        description: 'Include hidden files starting with . (default: false)',
        default: false
      }
    }
  },
  async (params, context): Promise<ToolResult> => {
    const dirPath = resolvePath(params.path || '.', context.projectRoot);

    // Validate path
    const pathValidation = validatePath(params.path || '.', context.projectRoot, context.securityConfig);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: { message: pathValidation.error!, code: 'INVALID_PATH', recoverable: false }
      };
    }

    try {
      const files: string[] = [];
      const ignore = ['node_modules', '.git', 'dist', 'build', '.next'];

      async function listDir(dir: string, depth = 0): Promise<void> {
        if (depth > 10) return; // Max depth protection

        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          // Skip hidden files unless requested
          if (!params.includeHidden && entry.name.startsWith('.')) {
            continue;
          }

          // Skip ignored directories
          if (entry.isDirectory() && ignore.includes(entry.name)) {
            continue;
          }

          const fullPath = path.join(dir, entry.name);
          const relativePath = normalizePath(path.relative(context.projectRoot, fullPath));

          if (entry.isDirectory()) {
            if (params.recursive) {
              await listDir(fullPath, depth + 1);
            }
          } else {
            // Apply pattern filter if provided
            if (params.pattern) {
              const pattern = params.pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
              const regex = new RegExp(`^${pattern}$`, 'i');
              if (!regex.test(entry.name) && !regex.test(relativePath)) {
                continue;
              }
            }
            files.push(relativePath);
          }
        }
      }

      await listDir(dirPath);

      return {
        success: true,
        data: {
          files: files.sort(),
          count: files.length,
          directory: dirPath
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Failed to list files: ${error.message}`,
          code: error.code || 'LIST_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * Search for content in files
 */
export const searchContentTool = defineTool<{
  query: string;
  path?: string;
  filePattern?: string;
  maxResults?: number;
  caseSensitive?: boolean;
}>(
  'search_content',
  'Search for text or regex pattern in files. Returns matching files with line numbers and context.',
  {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query (text or regex pattern)'
      },
      path: {
        type: 'string',
        description: 'Directory to search in (default: project root)'
      },
      filePattern: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g., "*.ts")'
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50)',
        default: 50
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case-sensitive search (default: false)',
        default: false
      }
    },
    required: ['query']
  },
  async (params, context): Promise<ToolResult> => {
    const searchPath = resolvePath(params.path || '.', context.projectRoot);
    const maxResults = params.maxResults || 50;

    // Validate path
    const pathValidation = validatePath(params.path || '.', context.projectRoot, context.securityConfig);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: { message: pathValidation.error!, code: 'INVALID_PATH', recoverable: false }
      };
    }

    try {
      const results: Array<{
        file: string;
        line: number;
        content: string;
        preview: string;
      }> = [];

      const ignore = ['node_modules', '.git', 'dist', 'build', '.next'];
      const flags = params.caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(params.query, flags);

      async function searchDir(dir: string, depth = 0): Promise<void> {
        if (depth > 10 || results.length >= maxResults) return;

        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= maxResults) break;

          if (entry.name.startsWith('.') || ignore.includes(entry.name)) {
            continue;
          }

          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            await searchDir(fullPath, depth + 1);
          } else {
            // Apply file pattern filter
            if (params.filePattern) {
              const pattern = params.filePattern.replace(/\*/g, '.*');
              if (!new RegExp(pattern, 'i').test(entry.name)) {
                continue;
              }
            }

            // Skip binary files
            const binaryExtensions = ['.png', '.jpg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
            if (binaryExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
              continue;
            }

            try {
              const content = await readFile(fullPath, 'utf-8');
              const lines = content.split('\n');

              for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                if (regex.test(lines[i])) {
                  const relativePath = normalizePath(path.relative(context.projectRoot, fullPath));
                  results.push({
                    file: relativePath,
                    line: i + 1,
                    content: lines[i].trim(),
                    preview: lines[i].trim().substring(0, 200)
                  });
                }
                // Reset regex lastIndex for global flag
                regex.lastIndex = 0;
              }
            } catch {
              // Skip files that can't be read
            }
          }
        }
      }

      await searchDir(searchPath);

      return {
        success: true,
        data: {
          results,
          count: results.length,
          query: params.query,
          truncated: results.length >= maxResults
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Search failed: ${error.message}`,
          code: 'SEARCH_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * Run a shell command
 */
export const runCommandTool = defineTool<{
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}>(
  'run_command',
  'Execute a shell command in the project directory. Returns stdout, stderr, and exit code.',
  {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute'
      },
      cwd: {
        type: 'string',
        description: 'Working directory (default: project root)'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: from security config)'
      },
      env: {
        type: 'object',
        description: 'Additional environment variables'
      }
    },
    required: ['command']
  },
  async (params, context): Promise<ToolResult> => {
    const cwd = params.cwd
      ? resolvePath(params.cwd, context.projectRoot)
      : context.projectRoot;

    // Validate command
    const cmdValidation = validateCommand(params.command, context.securityConfig);
    if (!cmdValidation.valid) {
      return {
        success: false,
        error: { message: cmdValidation.error!, code: 'INVALID_COMMAND', recoverable: false }
      };
    }

    // Validate cwd path
    if (params.cwd) {
      const pathValidation = validatePath(params.cwd, context.projectRoot, context.securityConfig);
      if (!pathValidation.valid) {
        return {
          success: false,
          error: { message: pathValidation.error!, code: 'INVALID_PATH', recoverable: false }
        };
      }
    }

    try {
      const timeout = params.timeout || context.securityConfig.maxExecutionTime;

      const { stdout, stderr } = await execAsync(params.command, {
        cwd,
        timeout,
        env: {
          ...process.env,
          ...context.env,
          ...params.env
        },
        maxBuffer: 10 * 1024 * 1024 // 10MB output buffer
      });

      return {
        success: true,
        data: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0,
          command: params.command,
          cwd
        }
      };
    } catch (error: any) {
      // Command failed with non-zero exit code
      return {
        success: error.killed ? false : true, // Still "success" if we got output
        data: {
          stdout: error.stdout?.trim() || '',
          stderr: error.stderr?.trim() || error.message,
          exitCode: error.code || 1,
          command: params.command,
          cwd,
          killed: error.killed,
          signal: error.signal
        },
        error: error.killed
          ? {
              message: error.signal === 'SIGTERM' ? 'Command timed out' : 'Command was killed',
              code: 'COMMAND_KILLED',
              recoverable: true
            }
          : undefined
      };
    }
  }
);

/**
 * Delete a file or directory
 */
export const deleteFileTool = defineTool<{
  path: string;
  recursive?: boolean;
}>(
  'delete_file',
  'Delete a file or directory. Use recursive=true for non-empty directories.',
  {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to delete'
      },
      recursive: {
        type: 'boolean',
        description: 'Delete directories recursively (default: false)',
        default: false
      }
    },
    required: ['path']
  },
  async (params, context): Promise<ToolResult> => {
    const fullPath = resolvePath(params.path, context.projectRoot);

    // Validate path
    const pathValidation = validatePath(params.path, context.projectRoot, context.securityConfig);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: { message: pathValidation.error!, code: 'INVALID_PATH', recoverable: false }
      };
    }

    // Extra safety: don't allow deleting project root
    if (normalizePath(fullPath) === normalizePath(context.projectRoot)) {
      return {
        success: false,
        error: {
          message: 'Cannot delete project root directory',
          code: 'PROTECTED_PATH',
          recoverable: false
        }
      };
    }

    try {
      // Create backup before deletion
      const fileStat = await stat(fullPath);
      let backupPath: string | null = null;

      if (fileStat.isFile()) {
        backupPath = await createBackup(fullPath);
      }

      // Delete
      await unlink(fullPath);

      return {
        success: true,
        data: {
          path: fullPath,
          type: fileStat.isDirectory() ? 'directory' : 'file'
        },
        rollback: backupPath
          ? { type: 'restore_file', path: fullPath, backup: backupPath }
          : undefined
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Failed to delete: ${error.message}`,
          code: error.code || 'DELETE_ERROR',
          recoverable: error.code === 'ENOENT'
        }
      };
    }
  }
);

/**
 * Get file/directory information
 */
export const getFileInfoTool = defineTool<{ path: string }>(
  'get_file_info',
  'Get information about a file or directory (size, modified date, type).',
  {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to get info for'
      }
    },
    required: ['path']
  },
  async (params, context): Promise<ToolResult> => {
    const fullPath = resolvePath(params.path, context.projectRoot);

    // Validate path
    const pathValidation = validatePath(params.path, context.projectRoot, context.securityConfig);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: { message: pathValidation.error!, code: 'INVALID_PATH', recoverable: false }
      };
    }

    try {
      const fileStat = await stat(fullPath);

      return {
        success: true,
        data: {
          path: fullPath,
          exists: true,
          type: fileStat.isDirectory() ? 'directory' : 'file',
          size: fileStat.size,
          created: fileStat.birthtime.toISOString(),
          modified: fileStat.mtime.toISOString(),
          accessed: fileStat.atime.toISOString()
        }
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          success: true,
          data: {
            path: fullPath,
            exists: false
          }
        };
      }

      return {
        success: false,
        error: {
          message: `Failed to get file info: ${error.message}`,
          code: error.code || 'STAT_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * All core tools
 */
export const CORE_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  searchContentTool,
  runCommandTool,
  deleteFileTool,
  getFileInfoTool
];

/**
 * Register all core tools to a registry
 */
export function registerCoreTools(registry: { register: (tool: Tool) => void }): void {
  for (const tool of CORE_TOOLS) {
    registry.register(tool);
  }
}
