export interface IElectronAPI {
    invoke(channel: 'dialog:openDirectory'): Promise<string | null>;
    invoke(channel: 'fs:readDir', path: string): Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
    invoke(channel: 'fs:readFile', path: string): Promise<string>;
    invoke(channel: 'fs:writeFile', path: string, content: string): Promise<void>;
    invoke(channel: 'fs:search', rootPath: string, query: string): Promise<{ path: string, preview: string }[]>;
    invoke(channel: 'terminal:create'): Promise<boolean>;
    // Remote SSH channels
    invoke(channel: 'remote:connect', config: any, password?: string): Promise<{ success: boolean; state?: any; error?: string }>;
    invoke(channel: 'remote:disconnect', connId?: string): Promise<{ success: boolean }>;
    invoke(channel: 'remote:get-state', connId?: string): Promise<any>;
    invoke(channel: 'remote:list-states'): Promise<any[]>;
    invoke(channel: 'remote:get-active'): Promise<string | null>;
    invoke(channel: 'remote:set-active', connId: string | null): Promise<{ success: boolean }>;
    invoke(channel: 'remote:save-config', config: any): Promise<{ success: boolean }>;
    invoke(channel: 'remote:list-configs'): Promise<any[]>;
    invoke(channel: 'remote:delete-config', configId: string): Promise<{ success: boolean }>;
    invoke(channel: 'remote:has-credential', connId: string): Promise<boolean>;
    invoke(channel: 'remote:clear-credential', connId: string): Promise<{ success: boolean }>;
    invoke(channel: string, ...args: any[]): Promise<any>;

    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
    off(channel: string, listener: (...args: any[]) => void): void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
    send(channel: string, ...args: any[]): void;
}

export interface IRemoteService {
    connect(config: any, password?: string): Promise<{ success: boolean; state?: any; error?: string }>;
    disconnect(connId?: string): Promise<{ success: boolean }>;
    getState(connId?: string): Promise<any>;
    listStates(): Promise<any[]>;
    getActive(): Promise<string | null>;
    setActive(connId: string | null): Promise<{ success: boolean }>;
    saveConfig(config: any): Promise<{ success: boolean }>;
    listConfigs(): Promise<any[]>;
    deleteConfig(configId: string): Promise<{ success: boolean }>;
    hasCredential(connId: string): Promise<boolean>;
    clearCredential(connId: string): Promise<{ success: boolean }>;
    onStateChange(callback: (state: any) => void): () => void;
}

declare global {
    interface Window {
        ipcRenderer: IElectronAPI;
        remoteService: IRemoteService;
    }
}
