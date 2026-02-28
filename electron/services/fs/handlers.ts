/**
 * File System IPC Handlers
 *
 * Routed FS operations (local ↔ remote) + search and file listing.
 * Extracted from main.ts to reduce god-object.
 */

import path from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import {
  isRemoteActive,
  getActiveRemoteConnection,
  remoteReadDir,
  remoteReadFile,
  remoteWriteFile,
  remoteSearch,
  remoteListAllFiles,
} from '../remote';

const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'release', 'build', '.vscode', '.idea'];

async function searchFiles(
  dir: string,
  query: string,
  maxDepth = 5,
  currentDepth = 0
): Promise<{ path: string; preview: string }[]> {
  if (currentDepth > maxDepth) return [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const tasks = entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.includes(entry.name)) {
          return searchFiles(fullPath, query, maxDepth, currentDepth + 1);
        }
      } else if (entry.isFile()) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const index = content.toLowerCase().indexOf(query.toLowerCase());
          if (index !== -1) {
            const start = Math.max(0, index - 20);
            const end = Math.min(content.length, index + 40);
            const preview =
              (start > 0 ? '...' : '') +
              content.substring(start, end).replace(/\n/g, ' ') +
              (end < content.length ? '...' : '');
            return [{ path: fullPath, preview }];
          }
        } catch { /* binary or unreadable file */ }
      }
      return [] as { path: string; preview: string }[];
    });

    const results = await Promise.all(tasks);
    return results.flat();
  } catch {
    return [];
  }
}

async function listAllFiles(
  dir: string,
  maxDepth = 4,
  currentDepth = 0
): Promise<string[]> {
  if (currentDepth > maxDepth) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.includes(entry.name)) {
          const subFiles = await listAllFiles(fullPath, maxDepth, currentDepth + 1);
          files = files.concat(subFiles);
        }
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

export const fsIpcHandlers: Record<string, (...args: any[]) => any> = {
  'fs:readDir': async (_event: any, dirPath: string) => {
    if (isRemoteActive()) {
      return remoteReadDir(getActiveRemoteConnection()!, dirPath);
    }
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      return entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(dirPath, entry.name),
      }));
    } catch (error) {
      console.error('Failed to read directory', error);
      throw error;
    }
  },

  'fs:readFile': async (_event: any, filePath: string) => {
    if (isRemoteActive()) {
      return remoteReadFile(getActiveRemoteConnection()!, filePath);
    }
    return readFile(filePath, 'utf-8');
  },

  'fs:writeFile': async (_event: any, filePath: string, content: string) => {
    if (isRemoteActive()) {
      return remoteWriteFile(getActiveRemoteConnection()!, filePath, content);
    }
    await writeFile(filePath, content);
  },

  'fs:search': async (_event: any, rootPath: string, query: string) => {
    if (!rootPath || !query) return [];
    if (isRemoteActive()) {
      return remoteSearch(getActiveRemoteConnection()!, rootPath, query);
    }
    return searchFiles(rootPath, query);
  },

  'fs:listAllFiles': async (_event: any, rootPath: string) => {
    if (!rootPath) return [];
    if (isRemoteActive()) {
      return remoteListAllFiles(getActiveRemoteConnection()!, rootPath);
    }
    return listAllFiles(rootPath);
  },
};
