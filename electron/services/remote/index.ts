/**
 * Remote SSH module — barrel export.
 */

export { SSHConnectionManager, getSSHManager } from './connection';
export { createRoutedHandler, setActiveRemoteConnection, getActiveRemoteConnection, isRemoteActive } from './router';
export { remoteReadDir, remoteReadFile, remoteWriteFile, remoteSearch, remoteListAllFiles } from './fs-remote';
export { createRemoteTerminal, writeRemoteTerminal, hasRemoteTerminal, destroyRemoteTerminal } from './terminal-remote';
export { remoteGitStatus, remoteGitLog, remoteGitStage, remoteGitUnstage, remoteGitCommit, remoteGitDiff } from './git-remote';
export { registerRemoteHandlers } from './handlers';
export { RemoteFileWatcher, getRemoteFileWatcher } from './file-watcher';
export type { RemoteConnectionConfig, RemoteConnectionState, RemoteFileEntry, RemoteExecResult, AuthMethod } from './types';
