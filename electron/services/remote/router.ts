/**
 * IPC Router — Transparent routing layer.
 *
 * When a remote SSH connection is active, IPC calls like fs:readDir, terminal:create, etc.
 * are routed through SSH/SFTP instead of local filesystem/shell.
 *
 * The frontend doesn't need to know whether it's operating locally or remotely.
 */

import { IpcMainInvokeEvent } from 'electron';

/** Currently active remote connection ID, or null for local mode. */
let activeRemoteConnectionId: string | null = null;

export function setActiveRemoteConnection(connId: string | null): void {
  activeRemoteConnectionId = connId;
}

export function getActiveRemoteConnection(): string | null {
  return activeRemoteConnectionId;
}

export function isRemoteActive(): boolean {
  return activeRemoteConnectionId !== null;
}

/**
 * Create a routed IPC handler that dispatches to local or remote implementation.
 *
 * @param localFn  The original local handler function
 * @param remoteFn A remote handler that receives (connId, ...originalArgs)
 */
export function createRoutedHandler<TArgs extends any[], TReturn>(
  localFn: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TReturn>,
  remoteFn: (connId: string, ...args: TArgs) => Promise<TReturn>
): (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TReturn> {
  return async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TReturn> => {
    if (activeRemoteConnectionId) {
      return remoteFn(activeRemoteConnectionId, ...args);
    }
    return localFn(event, ...args);
  };
}
