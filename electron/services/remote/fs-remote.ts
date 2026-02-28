/**
 * Remote filesystem operations via SFTP/exec.
 * These mirror the local fs IPC handlers but route through SSHConnectionManager.
 */

import { getSSHManager } from './connection';
import { RemoteFileEntry } from './types';

export async function remoteReadDir(connId: string, dirPath: string): Promise<RemoteFileEntry[]> {
  const manager = getSSHManager();
  return manager.readDir(connId, dirPath);
}

export async function remoteReadFile(connId: string, filePath: string): Promise<string> {
  const manager = getSSHManager();
  return manager.readFile(connId, filePath);
}

export async function remoteWriteFile(connId: string, filePath: string, content: string): Promise<void> {
  const manager = getSSHManager();
  return manager.writeFile(connId, filePath, content);
}

export async function remoteSearch(
  connId: string,
  rootPath: string,
  query: string
): Promise<{ path: string; preview: string }[]> {
  const manager = getSSHManager();
  return manager.search(connId, rootPath, query);
}

export async function remoteListAllFiles(connId: string, rootPath: string): Promise<string[]> {
  const manager = getSSHManager();
  return manager.listAllFiles(connId, rootPath);
}
