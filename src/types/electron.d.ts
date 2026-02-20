export interface IElectronAPI {
    invoke(channel: 'dialog:openDirectory'): Promise<string | null>;
    invoke(channel: 'fs:readDir', path: string): Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
    invoke(channel: 'fs:readFile', path: string): Promise<string>;
    invoke(channel: 'fs:writeFile', path: string, content: string): Promise<void>;
    invoke(channel: 'fs:search', rootPath: string, query: string): Promise<{ path: string, preview: string }[]>;
    invoke(channel: 'os:runCommand', command: string, cwd: string): Promise<{ success: boolean, output: string }>;
    invoke(channel: 'terminal:create'): Promise<boolean>;
    invoke(channel: string, ...args: any[]): Promise<any>;

    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
    off(channel: string, listener: (...args: any[]) => void): void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
    removeAllListeners(channel: string): void;
    send(channel: string, ...args: any[]): void;
}

declare global {
    interface Window {
        ipcRenderer: IElectronAPI;
    }
}
