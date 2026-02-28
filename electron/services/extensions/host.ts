/**
 * Extension Host Manager — Spawns and manages extension host child processes.
 *
 * Each extension runs in its own Node.js child process (extension-host.cjs),
 * communicating via newline-delimited JSON on stdio.
 *
 * The manager bridges messages between:
 *   - Extension host processes (child_process stdio)
 *   - Renderer process (Electron IPC via BrowserWindow.webContents)
 *
 * Message flow:
 *   Webview (iframe) → postMessage → Renderer → IPC → Main → stdio → ExtensionHost
 *   ExtensionHost → stdio → Main → IPC → Renderer → postMessage → Webview (iframe)
 */

import { ChildProcess, fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, clipboard, shell } from 'electron';
import { readFile, writeFile, stat, mkdir, rm, rename as fsRename, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getKeyStorage } from '../keychain';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// Types
// ============================================================

interface ExtensionHost {
  extensionId: string;
  extensionPath: string;
  process: ChildProcess;
  ready: boolean;
  activated: boolean;
  inputBuffer: string;
  /** Registered webview panel IDs for this extension */
  webviewPanels: Set<string>;
  /** Registered webview view providers */
  viewProviders: Map<string, string>; // viewId -> panelId
  /** Pending HTML set by extension — keyed by panelId */
  webviewHtml: Map<string, string>;
  /** Registered commands */
  registeredCommands: Set<string>;
}

export interface HostMessage {
  type?: string;
  [key: string]: any;
}

// ============================================================
// Extension Host Manager
// ============================================================

class ExtensionHostManager {
  private hosts = new Map<string, ExtensionHost>();
  private win: BrowserWindow | null = null;
  private extensionsDir: string;
  private hostScriptPath: string;

  constructor() {
    this.extensionsDir = path.join(app.getPath('userData'), 'extensions');
    // In dev: electron/services/extensions/extension-host.cjs
    // In prod: same, relative to APP_ROOT
    const appRoot = process.env.APP_ROOT || path.join(__dirname, '..');
    this.hostScriptPath = path.join(appRoot, 'electron', 'services', 'extensions', 'extension-host.cjs');
  }

  setWindow(win: BrowserWindow) {
    this.win = win;
  }

  /**
   * Normalize extension ID for Map lookups (URL hostnames are lowercased)
   */
  private normalizeId(extensionId: string): string {
    return extensionId.toLowerCase();
  }

  /**
   * Start an extension host process for the given extension
   */
  async start(extensionId: string, projectRoot?: string): Promise<void> {
    const key = this.normalizeId(extensionId);
    // Already running?
    if (this.hosts.has(key)) {
      const existing = this.hosts.get(key)!;
      if (existing.process && !existing.process.killed) {
        console.log(`[ExtHostMgr] Extension ${extensionId} already running`);
        return;
      }
      // Dead process — clean up and restart
      this.hosts.delete(key);
    }

    const extensionPath = path.join(this.extensionsDir, extensionId);
    if (!existsSync(extensionPath)) {
      throw new Error(`Extension not found: ${extensionPath}`);
    }

    console.log(`[ExtHostMgr] Starting extension host for ${extensionId}`);

    // Fork the extension host process
    // Build a clean env for the extension host — remove vars that cause nested-session
    // detection in tools like Claude CLI, and add required paths
    const extEnv = {
      ...process.env,
      SINGULARITY_PROJECT_ROOT: projectRoot || '',
      SINGULARITY_EXTENSION_ID: extensionId,
      SINGULARITY_APP_ROOT: app.getAppPath(),
      // Claude Code extension needs Git Bash path for spawning claude CLI
      CLAUDE_CODE_GIT_BASH_PATH: process.env.CLAUDE_CODE_GIT_BASH_PATH || 'C:\\Program Files\\Git\\bin\\bash.exe',
      GIT_BASH_PATH: process.env.GIT_BASH_PATH || 'C:\\Program Files\\Git\\bin\\bash.exe',
      // Remove vars that prevent nested CLI tools (e.g. Claude CLI) from starting
      CLAUDECODE: undefined as string | undefined,
      CLAUDE_DEV: undefined as string | undefined,
    };

    const child = fork(this.hostScriptPath, [extensionId, extensionPath, projectRoot || ''], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      cwd: projectRoot || extensionPath,
      env: extEnv,
      silent: true,
    });

    const host: ExtensionHost = {
      extensionId,
      extensionPath,
      process: child,
      ready: false,
      activated: false,
      inputBuffer: '',
      webviewPanels: new Set(),
      viewProviders: new Map(),
      webviewHtml: new Map(),
      registeredCommands: new Set(),
    };

    this.hosts.set(key, host);

    // Handle stdout (messages from extension host)
    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => {
      host.inputBuffer += chunk;
      let newlineIdx: number;
      while ((newlineIdx = host.inputBuffer.indexOf('\n')) >= 0) {
        const line = host.inputBuffer.substring(0, newlineIdx).trim();
        host.inputBuffer = host.inputBuffer.substring(newlineIdx + 1);
        if (line) {
          try {
            const msg: HostMessage = JSON.parse(line);
            this.handleHostMessage(extensionId, msg);
          } catch (e: any) {
            console.error(`[ExtHostMgr] Parse error from ${extensionId}:`, e.message);
          }
        }
      }
    });

    // Forward stderr to console (extension debug output)
    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (chunk: string) => {
      process.stderr.write(`[ExtHost:${extensionId}] ${chunk}`);
    });

    // Handle process exit
    child.on('exit', (code, signal) => {
      console.log(`[ExtHostMgr] Extension ${extensionId} exited: code=${code}, signal=${signal}`);
      this.hosts.delete(key);
      // Notify renderer
      this.sendToRenderer('exthost:stopped', { extensionId, code, signal });
    });

    child.on('error', (err) => {
      console.error(`[ExtHostMgr] Extension ${extensionId} error:`, err.message);
      this.hosts.delete(key);
      this.sendToRenderer('exthost:error', { extensionId, error: err.message });
    });
  }

  /**
   * Stop an extension host process
   */
  stop(extensionId: string): void {
    const key = this.normalizeId(extensionId);
    const host = this.hosts.get(key);
    if (!host) return;

    console.log(`[ExtHostMgr] Stopping extension ${extensionId}`);
    try {
      host.process.kill('SIGTERM');
    } catch {}
    this.hosts.delete(key);
  }

  /**
   * Stop all extension host processes
   */
  stopAll(): void {
    for (const [id] of this.hosts) {
      this.stop(id);
    }
  }

  /**
   * Check if an extension host is running
   */
  isRunning(extensionId: string): boolean {
    const host = this.hosts.get(this.normalizeId(extensionId));
    return !!host && !host.process.killed;
  }

  /**
   * Get the status of an extension host
   */
  getStatus(extensionId: string): { running: boolean; ready: boolean; activated: boolean } {
    const host = this.hosts.get(this.normalizeId(extensionId));
    if (!host || host.process.killed) {
      return { running: false, ready: false, activated: false };
    }
    return { running: true, ready: host.ready, activated: host.activated };
  }

  /**
   * Send a message to an extension host process (via stdin)
   */
  sendToHost(extensionId: string, msg: HostMessage): void {
    const host = this.hosts.get(this.normalizeId(extensionId));
    if (!host || host.process.killed) {
      console.warn(`[ExtHostMgr] Cannot send to ${extensionId}: not running`);
      return;
    }
    try {
      host.process.stdin?.write(JSON.stringify(msg) + '\n');
    } catch (e: any) {
      console.error(`[ExtHostMgr] Failed to send to ${extensionId}:`, e.message);
    }
  }

  /**
   * Common pattern for request/reply messages: try the operation, send result or error
   */
  private async handleRequestReply(extensionId: string, requestId: number, fn: () => Promise<unknown>): Promise<void> {
    try {
      const result = await fn();
      this.sendToHost(extensionId, { _requestId: requestId, result });
    } catch (e: any) {
      this.sendToHost(extensionId, { _requestId: requestId, error: e.message });
    }
  }

  /**
   * Send a message to the renderer process via webContents
   */
  private sendToRenderer(channel: string, data: any): void {
    try {
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send(channel, data);
      }
    } catch {
      // Ignore EPIPE and other errors when window is not ready
    }
  }

  /**
   * Get the latest webview HTML set by an extension
   */
  getWebviewHtml(extensionId: string, panelId: string): string | undefined {
    return this.hosts.get(this.normalizeId(extensionId))?.webviewHtml.get(panelId);
  }

  /**
   * Get the webview URL for an extension — returns the first view provider that has HTML set
   */
  getWebviewUrl(extensionId: string): { panelId: string; url: string } | null {
    const host = this.hosts.get(this.normalizeId(extensionId));
    if (!host) {
      console.log(`[ExtHostMgr] getWebviewUrl(${extensionId}): no host found`);
      return null;
    }
    // Check view providers first (sidebar webviews like Claude/Codex)
    for (const [viewId, panelId] of host.viewProviders) {
      const hasHtml = host.webviewHtml.has(panelId);
      console.log(`[ExtHostMgr] getWebviewUrl(${extensionId}): viewProvider ${viewId} -> ${panelId}, hasHtml=${hasHtml}`);
      if (hasHtml) {
        return {
          panelId,
          url: `singularity-ext://${extensionId}/_exthost_webview/${encodeURIComponent(panelId)}?t=${Date.now()}`,
        };
      }
    }
    // Check standalone webview panels
    for (const panelId of host.webviewPanels) {
      if (host.webviewHtml.has(panelId)) {
        return {
          panelId,
          url: `singularity-ext://${extensionId}/_exthost_webview/${encodeURIComponent(panelId)}?t=${Date.now()}`,
        };
      }
    }
    console.log(`[ExtHostMgr] getWebviewUrl(${extensionId}): no webview URL available (${host.viewProviders.size} providers, ${host.webviewPanels.size} panels, ${host.webviewHtml.size} htmls)`);
    return null;
  }

  /**
   * Handle a message received from an extension host process
   */
  private async handleHostMessage(extensionId: string, msg: HostMessage): Promise<void> {
    const host = this.hosts.get(this.normalizeId(extensionId));
    if (!host) return;

    const { type, ...data } = msg;

    switch (type) {
      // ====== Lifecycle ======
      case 'host:ready':
        host.ready = true;
        console.log(`[ExtHostMgr] Extension ${extensionId} host ready`);
        this.sendToRenderer('exthost:ready', { extensionId });
        break;

      case 'host:activated':
        host.activated = true;
        console.log(`[ExtHostMgr] Extension ${extensionId} activated`);
        this.sendToRenderer('exthost:activated', { extensionId });
        break;

      case 'host:error':
        console.error(`[ExtHostMgr] Extension ${extensionId} error:`, data.error);
        this.sendToRenderer('exthost:error', { extensionId, error: data.error });
        break;

      // ====== Webview ======
      case 'webview:createPanel':
        host.webviewPanels.add(data.panelId);
        this.sendToRenderer('exthost:webview-created', { extensionId, ...data });
        break;

      case 'webview:setHtml':
        host.webviewHtml.set(data.panelId, data.html);
        // Send a protocol URL that the renderer can load in an iframe.
        // The protocol handler will serve the HTML from memory, strip CSP, and inject our shim.
        const webviewUrl = `singularity-ext://${extensionId}/_exthost_webview/${encodeURIComponent(data.panelId)}?t=${Date.now()}`;
        console.log(`[ExtHostMgr] webview:setHtml from ${extensionId}, panelId=${data.panelId}, htmlLen=${data.html?.length || 0}`);
        this.sendToRenderer('exthost:webview-html', { extensionId, panelId: data.panelId, url: webviewUrl });
        break;

      case 'webview:postMessage':
        // Extension sending message to its webview
        this.sendToRenderer('exthost:webview-message', {
          extensionId,
          panelId: data.panelId,
          message: data.message,
        });
        break;

      case 'webview:setTitle':
        this.sendToRenderer('exthost:webview-title', { extensionId, panelId: data.panelId, title: data.title });
        break;

      case 'webview:reveal':
        this.sendToRenderer('exthost:webview-reveal', { extensionId, panelId: data.panelId });
        break;

      case 'webview:dispose':
        host.webviewPanels.delete(data.panelId);
        this.sendToRenderer('exthost:webview-disposed', { extensionId, panelId: data.panelId });
        break;

      case 'webview:registerViewProvider':
        console.log(`[ExtHostMgr] View provider registered: ${extensionId} viewId=${data.viewId} panelId=${data.panelId}`);
        host.viewProviders.set(data.viewId, data.panelId);
        this.sendToRenderer('exthost:view-provider', { extensionId, viewId: data.viewId, panelId: data.panelId });
        break;

      // ====== Commands ======
      case 'commands:register':
        host.registeredCommands.add(data.id);
        break;

      case 'commands:execute':
        // Extension wants to execute a command — check if another extension has it
        await this.handleCommandExecution(extensionId, data);
        break;

      // ====== Window ======
      case 'window:showMessage': {
        const { level, message, items, detail } = data;
        if (items?.length > 0 && data._requestId) {
          // Forward to renderer for styled in-app notification with action buttons
          this.sendToRenderer('exthost:show-notification', {
            extensionId, level, message, items, detail,
            _requestId: data._requestId,
          });
          // Response comes back via 'exthost:notification-response' IPC from renderer
        } else {
          // No action buttons — fire-and-forget notification
          this.sendToRenderer('exthost:show-notification', {
            extensionId, level, message, items: items || [], detail,
          });
        }
        break;
      }

      case 'window:showQuickPick': {
        // Forward to renderer for UI handling
        this.sendToRenderer('exthost:quick-pick', { extensionId, ...data });
        break;
      }

      case 'window:showInputBox': {
        this.sendToRenderer('exthost:input-box', { extensionId, ...data });
        break;
      }

      case 'window:progress':
        this.sendToRenderer('exthost:progress', { extensionId, ...data });
        break;

      case 'window:createTerminal':
        this.sendToRenderer('exthost:create-terminal', { extensionId, name: data.name });
        break;

      case 'window:showTerminal':
        this.sendToRenderer('exthost:show-terminal', { extensionId, name: data.name });
        break;

      case 'window:terminalSendText':
        this.sendToRenderer('exthost:terminal-text', { extensionId, name: data.name, text: data.text });
        break;

      case 'window:disposeTerminal':
        this.sendToRenderer('exthost:dispose-terminal', { extensionId, name: data.name });
        break;

      case 'window:outputChannel':
        this.sendToRenderer('exthost:output', { extensionId, name: data.name, text: data.text });
        break;

      case 'window:showOutputChannel':
        this.sendToRenderer('exthost:show-output', { extensionId, name: data.name });
        break;

      case 'window:statusBarItem':
        this.sendToRenderer('exthost:status-bar', { extensionId, ...data });
        break;

      // ====== Workspace / FS ======
      case 'workspace:readFile':
        return this.handleRequestReply(extensionId, data._requestId, () => readFile(data.path, 'utf-8'));

      case 'workspace:readFileBuffer':
        return this.handleRequestReply(extensionId, data._requestId, async () =>
          (await readFile(data.path)).toString('base64'));

      case 'workspace:writeFile':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          const dir = path.dirname(data.path);
          if (!existsSync(dir)) await mkdir(dir, { recursive: true });
          const content = data.content ? Buffer.from(data.content, 'base64') : Buffer.alloc(0);
          await writeFile(data.path, content);
          return true;
        });

      case 'workspace:stat':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          const s = await stat(data.path);
          return { type: s.isFile() ? 1 : s.isDirectory() ? 2 : 0, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
        });

      case 'workspace:delete':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          await rm(data.path, { recursive: data.recursive ?? false, force: true });
          return true;
        });

      case 'workspace:rename':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          await fsRename(data.source, data.target);
          return true;
        });

      case 'workspace:copy':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          await cp(data.source, data.target, { recursive: true });
          return true;
        });

      case 'workspace:createDirectory':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          await mkdir(data.path, { recursive: true });
          return true;
        });

      case 'workspace:readDirectory':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          const entries = await readdir(data.path, { withFileTypes: true });
          return entries.map(e => [e.name, e.isFile() ? 1 : e.isDirectory() ? 2 : 0]);
        });

      // ====== Environment ======
      case 'env:clipboardRead':
        return this.handleRequestReply(extensionId, data._requestId, async () => clipboard.readText());

      case 'env:clipboardWrite':
        clipboard.writeText(data.text || '');
        break;

      case 'env:openExternal':
        if (data.uri) shell.openExternal(data.uri).catch(() => {});
        break;

      // ====== Secrets (namespaced key: "ext:{extensionId}:{key}") ======
      case 'secrets:get':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          const value = await getKeyStorage().getKey(`ext:${extensionId}:${data.key}`);
          return value || undefined;
        });

      case 'secrets:store':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          await getKeyStorage().setKey(`ext:${extensionId}:${data.key}`, data.value);
          return true;
        });

      case 'secrets:delete':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          await getKeyStorage().deleteKey(`ext:${extensionId}:${data.key}`);
          return true;
        });

      // ====== Authentication ======
      case 'auth:getSession':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          const sessionKey = `auth-session:${data.providerId}:${(data.scopes || []).sort().join(',')}`;
          const stored = await getKeyStorage().getKey(sessionKey);
          return stored ? JSON.parse(stored) : undefined;
        });

      case 'auth:createSession':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          const sessionKey = `auth-session:${data.providerId}:${(data.scopes || []).sort().join(',')}`;
          await getKeyStorage().setKey(sessionKey, JSON.stringify(data.session));
          return true;
        });

      // ====== Extensions ======
      case 'extensions:getAll':
        return this.handleRequestReply(extensionId, data._requestId, async () =>
          this.getRunningExtensions().map(id => ({
            id, extensionPath: path.join(this.extensionsDir, id, 'extension'), isActive: true,
          })));

      case 'extensions:getExtension':
        return this.handleRequestReply(extensionId, data._requestId, async () => {
          const targetHost = this.hosts.get(this.normalizeId(data.extensionId));
          if (!targetHost) return undefined;
          return {
            id: data.extensionId,
            extensionPath: path.join(this.extensionsDir, data.extensionId, 'extension'),
            isActive: targetHost.activated,
          };
        });

      // ====== Webview lifecycle ======
      case 'webview:viewResolved':
        console.log(`[ExtHostMgr] Webview view resolved: ${extensionId} viewId=${data.viewId} panelId=${data.panelId}`);
        this.sendToRenderer('exthost:view-resolved', { extensionId, viewId: data.viewId, panelId: data.panelId });
        break;

      case 'window:registerUriHandler':
        console.log(`[ExtHostMgr] URI handler registered for ${extensionId}`);
        break;

      default:
        console.log(`[ExtHostMgr] Unhandled message from ${extensionId}: ${type}`);
        break;
    }
  }

  /**
   * Handle command execution requests from extension hosts
   */
  private async handleCommandExecution(requesterId: string, data: any): Promise<void> {
    const { id: commandId, args, _requestId } = data;

    // setContext is handled shim-side — just acknowledge
    if (commandId === 'setContext' && args?.length >= 2) {
      if (_requestId) {
        this.sendToHost(requesterId, { _requestId, result: undefined });
      }
      return;
    }

    // Check if any extension has registered this command
    for (const [extId, host] of this.hosts) {
      if (host.registeredCommands.has(commandId)) {
        // Forward to that extension
        this.sendToHost(extId, { type: 'commands:execute', id: commandId, args });
        // Return success to requester
        if (_requestId) {
          this.sendToHost(requesterId, { _requestId, result: undefined });
        }
        return;
      }
    }

    // Built-in command handling
    if (_requestId) {
      this.sendToHost(requesterId, { _requestId, result: undefined });
    }
  }

  /**
   * Forward a message from the webview (renderer) to the extension host
   */
  forwardWebviewMessage(extensionId: string, panelId: string, message: any): void {
    this.sendToHost(extensionId, {
      type: 'webview:message',
      data: { panelId, message },
    });
  }

  /**
   * Get all running extension IDs
   */
  getRunningExtensions(): string[] {
    return [...this.hosts.values()]
      .filter(h => !h.process.killed)
      .map(h => h.extensionId);
  }
}

// ============================================================
// Singleton
// ============================================================

let instance: ExtensionHostManager | null = null;

export function getExtensionHostManager(): ExtensionHostManager {
  if (!instance) {
    instance = new ExtensionHostManager();
  }
  return instance;
}

// ============================================================
// IPC Handlers (registered in main.ts)
// ============================================================

export const extensionHostIpcHandlers: Record<string, (...args: any[]) => any> = {
  'exthost:start': async (_event: any, extensionId: string, projectRoot?: string): Promise<void> => {
    return getExtensionHostManager().start(extensionId, projectRoot);
  },

  'exthost:stop': async (_event: any, extensionId: string): Promise<void> => {
    getExtensionHostManager().stop(extensionId);
  },

  'exthost:stop-all': async (): Promise<void> => {
    getExtensionHostManager().stopAll();
  },

  'exthost:is-running': async (_event: any, extensionId: string): Promise<boolean> => {
    return getExtensionHostManager().isRunning(extensionId);
  },

  'exthost:status': async (_event: any, extensionId: string): Promise<{ running: boolean; ready: boolean; activated: boolean }> => {
    return getExtensionHostManager().getStatus(extensionId);
  },

  'exthost:running-extensions': async (): Promise<string[]> => {
    return getExtensionHostManager().getRunningExtensions();
  },

  /** Webview → extension host message forwarding */
  'exthost:webview-message': async (_event: any, extensionId: string, panelId: string, message: any): Promise<void> => {
    getExtensionHostManager().forwardWebviewMessage(extensionId, panelId, message);
  },

  /** Notification response from renderer (user clicked a button on in-app notification) */
  'exthost:notification-response': async (_event: any, extensionId: string, requestId: number, selectedItem: string | undefined): Promise<void> => {
    getExtensionHostManager().sendToHost(extensionId, { _requestId: requestId, result: selectedItem });
  },

  /** Forward URI callback to extension host (singularity:// protocol handler) */
  'exthost:uri-callback': async (_event: any, extensionId: string, uri: string): Promise<void> => {
    getExtensionHostManager().sendToHost(extensionId, { type: 'uri:handle', data: { extensionId, uri } });
  },

  /** Get the HTML set by extension for a webview panel */
  'exthost:get-webview-html': async (_event: any, extensionId: string, panelId: string): Promise<string | undefined> => {
    return getExtensionHostManager().getWebviewHtml(extensionId, panelId);
  },

  /** Get the webview URL for an extension (first view provider with HTML set) */
  'exthost:get-webview-url': async (_event: any, extensionId: string): Promise<{ panelId: string; url: string } | null> => {
    return getExtensionHostManager().getWebviewUrl(extensionId);
  },
};
