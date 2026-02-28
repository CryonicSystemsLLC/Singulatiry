import { app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, shell, protocol, net } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFile, stat as fsStat } from 'node:fs/promises'

// Service handler records (already-exported from their modules)
import { keyStorageIpcHandlers } from './services/keychain';
import { modelServiceIpcHandlers } from './services/models/unified';
import { orchestratorIpcHandlers } from './services/agent/orchestrator';
import { devServerIpcHandlers, getDevServerManager } from './services/devserver/manager';
import { persistenceIpcHandlers, getSessionState } from './services/persistence/store';
import { gitIpcHandlers } from './services/tools/git-tools';
import { githubIpcHandlers } from './services/tools/github-tools';
import { extensionIpcHandlers } from './services/extensions/manager';
import { extensionHostIpcHandlers, getExtensionHostManager } from './services/extensions/host';
import { debugIpcHandlers, getDebugClient } from './services/debug/dap-client';
import { autocompleteIpcHandlers } from './services/ai/autocomplete';
import { mcpIpcHandlers, getMcpServerManager } from './services/mcp';
import { getGlobalSandbox } from './services/sandbox/manager';

// Extracted handler modules
import { fsIpcHandlers } from './services/fs/handlers';
import { registerTerminalHandlers, killTerminalProcess } from './services/terminal/handlers';
import {
  recipeIpcHandlers, templateIpcHandlers, metricsIpcHandlers, costIpcHandlers,
  guardrailIpcHandlers, sandboxIpcHandlers, automationIpcHandlers,
  rateLimiterIpcHandlers, circuitBreakerIpcHandlers,
  providerFetchHandlers, createDialogHandlers,
  registerAutomationEvents, registerAllHandlerRecords, getAutomationWatcherInstance,
} from './services/ipc-handlers';

// Remote SSH
import {
  registerRemoteHandlers,
  destroyRemoteTerminal,
  getSSHManager,
  getRemoteFileWatcher,
} from './services/remote';

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 1024,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    backgroundColor: '#0d0d12',
    // Remove autoHideMenuBar: true to allow the custom menu to show
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Give extension host manager, debug client, and MCP manager the window reference
  getExtensionHostManager().setWindow(win);
  getDebugClient().setWindow(win);
  getMcpServerManager().setWindow(win);

  // Once the renderer has fully loaded, start extension hosts.
  // This ensures the UI appears instantly and extensions don't compete with rendering.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())

    // Preload sidebar extension hosts after renderer is ready
    setTimeout(async () => {
      try {
        const installed: any[] = await extensionIpcHandlers['extensions:list-installed'](null);
        const sidebarExts = installed.filter((ext: any) => ext.contributions?.viewsContainers?.length);
        if (sidebarExts.length === 0) return;

        const session = getSessionState();
        const projectRoot = session.lastProjectRoot || '';
        const hostMgr = getExtensionHostManager();

        for (let i = 0; i < sidebarExts.length; i++) {
          const ext = sidebarExts[i];
          if (!hostMgr.isRunning(ext.id)) {
            setTimeout(() => {
              hostMgr.start(ext.id, projectRoot).catch((e: any) => {
                console.error(`[Preload] Failed to start ${ext.id}:`, e.message);
              });
            }, i * 200);
          }
        }
      } catch (e: any) {
        console.error('[Preload] Error:', e.message);
      }
    }, 200);
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => win?.webContents.send('menu:new-file') },
        { label: 'Open Folder...', accelerator: 'CmdOrCtrl+O', click: () => win?.webContents.send('menu:open-folder') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => win?.webContents.send('menu:save') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => win?.webContents.send('menu:settings') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Selection',
      submenu: [
        { role: 'selectAll' },
        { label: 'Expand Selection', accelerator: 'Shift+Alt+Right', click: () => win?.webContents.send('menu:selection-expand') },
        { label: 'Shrink Selection', accelerator: 'Shift+Alt+Left', click: () => win?.webContents.send('menu:selection-shrink') },
        { type: 'separator' },
        { label: 'Copy Line Up', accelerator: 'Shift+Alt+Up', click: () => win?.webContents.send('menu:copy-line-up') },
        { label: 'Copy Line Down', accelerator: 'Shift+Alt+Down', click: () => win?.webContents.send('menu:copy-line-down') },
        { label: 'Move Line Up', accelerator: 'Alt+Up', click: () => win?.webContents.send('menu:move-line-up') },
        { label: 'Move Line Down', accelerator: 'Alt+Down', click: () => win?.webContents.send('menu:move-line-down') },
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'Alt+Left', click: () => win?.webContents.send('menu:go-back') },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => win?.webContents.send('menu:go-forward') },
        { type: 'separator' },
        { label: 'Go to File...', accelerator: 'CmdOrCtrl+P', click: () => win?.webContents.send('menu:go-to-file') },
        { type: 'separator' },
        { label: 'Next Problem', accelerator: 'F8', click: () => win?.webContents.send('menu:next-problem') },
        { label: 'Previous Problem', accelerator: 'Shift+F8', click: () => win?.webContents.send('menu:previous-problem') },
      ]
    },
    {
      label: 'Run',
      submenu: [
        { label: 'Start Debugging', accelerator: 'F5', click: () => win?.webContents.send('menu:start-debugging') },
        { label: 'Run Without Debugging', accelerator: 'Ctrl+F5', click: () => win?.webContents.send('menu:run-without-debugging') },
        { type: 'separator' },
        { label: 'Add Configuration...', click: () => win?.webContents.send('menu:add-configuration') },
      ]
    },
    {
      label: 'Terminal',
      submenu: [
        { label: 'New Terminal', accelerator: 'Ctrl+Shift+`', click: () => win?.webContents.send('menu:new-terminal') },
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Welcome', enabled: false },
        { label: 'Documentation', click: async () => { await shell.openExternal('https://electronjs.org'); } },
        { label: 'About', role: 'about' },
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// ===== IPC Handler Registration =====
// Bulk-register all handler records (each is a Record<string, handler>)
registerAllHandlerRecords(ipcMain, [
  fsIpcHandlers,
  recipeIpcHandlers,
  templateIpcHandlers,
  metricsIpcHandlers,
  costIpcHandlers,
  guardrailIpcHandlers,
  sandboxIpcHandlers,
  automationIpcHandlers,
  rateLimiterIpcHandlers,
  circuitBreakerIpcHandlers,
  providerFetchHandlers,
  createDialogHandlers(() => win),
  keyStorageIpcHandlers,
  modelServiceIpcHandlers,
  persistenceIpcHandlers,
  orchestratorIpcHandlers,
  devServerIpcHandlers,
  gitIpcHandlers,
  githubIpcHandlers,
  extensionIpcHandlers,
  extensionHostIpcHandlers,
  debugIpcHandlers,
  autocompleteIpcHandlers,
  mcpIpcHandlers,
]);

// Terminal handlers need special registration (uses ipcMain.on for terminal:write)
registerTerminalHandlers(() => win);

// Forward automation events to renderer
registerAutomationEvents(() => win);

// Forward dev server events to renderer
const devServerManager = getDevServerManager();
devServerManager.on('event', (event) => {
  win?.webContents.send('devserver:event', event);
});

// Streaming IPC handler — sends chunks via webContents.send (needs event.sender)
ipcMain.handle('model:stream', async (event, request) => {
  const { getModelService: getService } = await import('./services/models/unified');
  const service = getService();
  const sender = event.sender;

  try {
    const generator = service.stream(request);
    let finalResponse = null;

    while (true) {
      const { value, done } = await generator.next();
      if (done) {
        finalResponse = value;
        break;
      }
      // Send each chunk to renderer
      sender.send('model:stream-chunk', value);
    }

    sender.send('model:stream-done', finalResponse);
    return { success: true };
  } catch (error: any) {
    sender.send('model:stream-error', { message: error.message, code: error.code });
    return { success: false, error: error.message };
  }
});

// Remote SSH IPC Handlers
registerRemoteHandlers();

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // Cleanup: stop background services
  try {
    killTerminalProcess();
    getRemoteFileWatcher().stop();
    destroyRemoteTerminal();
    getSSHManager().disconnectAll();
    getAutomationWatcherInstance().stop();
    devServerManager.removeAllListeners();
    getExtensionHostManager().stopAll();
    getMcpServerManager().stopAll().catch(() => {});
    getDebugClient().terminate().catch(() => {});
    getGlobalSandbox().killAll();
  } catch (e) {
    console.error('Cleanup error:', e);
  }

  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// PERFORMANCE FIX: Disable GPU Acceleration to fix sluggish UI/Menu on Windows
app.disableHardwareAcceleration();

// ===== Register singularity:// protocol for OAuth/URI handler callbacks =====
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('singularity', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('singularity');
}

function handleProtocolUrl(url: string) {
  try {
    // URL format: singularity://extensionId/path?query
    const parsed = new URL(url);
    const extensionId = parsed.hostname;
    if (extensionId) {
      console.log(`[Protocol] Deep link received: ${url} → extension ${extensionId}`);
      const mgr = getExtensionHostManager();
      mgr.sendToHost(extensionId, { type: 'uri:handle', data: { extensionId, uri: url } });
    }
  } catch (e: any) {
    console.error('[Protocol] Failed to handle protocol URL:', e.message);
  }
}

// Windows: deep links arrive via second-instance event (single instance lock)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(a => a.startsWith('singularity://'));
    if (url) handleProtocolUrl(url);
    // Focus existing window
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// macOS: deep links via open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

// Register custom protocol for serving extension webview files
protocol.registerSchemesAsPrivileged([{
  scheme: 'singularity-ext',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  }
}]);

app.whenReady().then(async () => {
  // Register the protocol handler for extension webview files
  const extensionsDir = path.join(app.getPath('userData'), 'extensions');
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
  };

  // VS Code API shim injected into extension webview HTML
  // Bridges messages between the webview iframe and the parent renderer,
  // which in turn forwards them to the real extension host process via IPC.
  const vscodeApiShim = `<script>
(function() {
  var _state = {};
  var vscodeApi = {
    postMessage: function(msg) {
      // Send to parent renderer — it will forward to the extension host via IPC
      window.parent.postMessage({ type: 'extension-to-host', payload: msg }, '*');
    },
    getState: function() {
      try {
        var saved = sessionStorage.getItem('vscode-webview-state');
        if (saved) return JSON.parse(saved);
      } catch(e) {}
      return _state;
    },
    setState: function(s) {
      _state = s;
      try { sessionStorage.setItem('vscode-webview-state', JSON.stringify(s)); } catch(e) {}
      return s;
    },
  };
  var _acquired = false;
  window.acquireVsCodeApi = function() {
    if (_acquired) return vscodeApi;
    _acquired = true;
    return vscodeApi;
  };

  // Listen for messages from the extension host (forwarded by parent renderer)
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'host-to-webview') {
      // Re-dispatch as a plain message event for the extension webview JS
      window.dispatchEvent(new MessageEvent('message', { data: e.data.payload, origin: window.location.origin, source: window }));
    }
  });

  // Set VS Code theme CSS variables
  var ds = document.documentElement.style;
  var vars = {
    '--vscode-editor-background': '#0d0d12',
    '--vscode-editor-foreground': '#e0e0e0',
    '--vscode-sideBar-background': '#111118',
    '--vscode-sideBar-foreground': '#e0e0e0',
    '--vscode-input-background': '#1a1a24',
    '--vscode-input-foreground': '#e0e0e0',
    '--vscode-input-border': '#2a2a3a',
    '--vscode-input-placeholderForeground': '#666680',
    '--vscode-button-background': '#6366f1',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#818cf8',
    '--vscode-button-secondaryBackground': '#2a2a3a',
    '--vscode-button-secondaryForeground': '#e0e0e0',
    '--vscode-focusBorder': '#6366f1',
    '--vscode-foreground': '#e0e0e0',
    '--vscode-descriptionForeground': '#a0a0b0',
    '--vscode-errorForeground': '#ef4444',
    '--vscode-textLink-foreground': '#818cf8',
    '--vscode-textLink-activeForeground': '#a5b4fc',
    '--vscode-badge-background': '#6366f1',
    '--vscode-badge-foreground': '#ffffff',
    '--vscode-list-activeSelectionBackground': '#2a2a3a',
    '--vscode-list-activeSelectionForeground': '#ffffff',
    '--vscode-list-hoverBackground': '#1a1a24',
    '--vscode-panel-background': '#0d0d12',
    '--vscode-panel-border': '#2a2a3a',
    '--vscode-panelTitle-activeForeground': '#e0e0e0',
    '--vscode-panelTitle-inactiveForeground': '#666680',
    '--vscode-widget-shadow': 'rgba(0,0,0,0.36)',
    '--vscode-scrollbarSlider-background': 'rgba(255,255,255,0.1)',
    '--vscode-scrollbarSlider-hoverBackground': 'rgba(255,255,255,0.15)',
    '--vscode-scrollbarSlider-activeBackground': 'rgba(255,255,255,0.2)',
    '--vscode-font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    '--vscode-font-size': '13px',
    '--vscode-editor-font-family': '"Cascadia Code", "Fira Code", Consolas, monospace',
    '--vscode-editor-font-size': '14px',
    '--vscode-checkbox-background': '#1a1a24',
    '--vscode-checkbox-border': '#2a2a3a',
    '--vscode-dropdown-background': '#1a1a24',
    '--vscode-dropdown-border': '#2a2a3a',
    '--vscode-dropdown-foreground': '#e0e0e0',
    '--vscode-settings-checkboxBackground': '#1a1a24',
    '--vscode-settings-checkboxBorder': '#2a2a3a',
    '--vscode-settings-dropdownBackground': '#1a1a24',
    '--vscode-settings-textInputBackground': '#1a1a24',
    '--vscode-welcomePage-tileBackground': '#1a1a24',
    '--vscode-progressBar-background': '#6366f1',
    '--vscode-tab-activeBackground': '#1a1a24',
    '--vscode-tab-inactiveBackground': '#111118',
    '--vscode-tab-border': '#2a2a3a',
    '--vscode-statusBar-background': '#111118',
    '--vscode-titleBar-activeBackground': '#111118',
    // Menu / popup / quick-pick variables — needed for slash command dropdowns etc.
    '--vscode-menu-background': '#1a1a24',
    '--vscode-menu-foreground': '#e0e0e0',
    '--vscode-menu-selectionBackground': '#2a2a3a',
    '--vscode-menu-selectionForeground': '#ffffff',
    '--vscode-menu-separatorBackground': '#2a2a3a',
    '--vscode-menu-border': '#2a2a3a',
    '--vscode-quickInput-background': '#1a1a24',
    '--vscode-quickInput-foreground': '#e0e0e0',
    '--vscode-quickInputList-focusBackground': '#2a2a3a',
    '--vscode-quickInputList-focusForeground': '#ffffff',
    '--vscode-quickInputTitle-background': '#1a1a24',
    '--vscode-editorWidget-background': '#1a1a24',
    '--vscode-editorWidget-foreground': '#e0e0e0',
    '--vscode-editorWidget-border': '#2a2a3a',
    '--vscode-editorSuggestWidget-background': '#1a1a24',
    '--vscode-editorSuggestWidget-foreground': '#e0e0e0',
    '--vscode-editorSuggestWidget-selectedBackground': '#2a2a3a',
    '--vscode-editorSuggestWidget-highlightForeground': '#818cf8',
    '--vscode-editorSuggestWidget-border': '#2a2a3a',
    '--vscode-editorHoverWidget-background': '#1a1a24',
    '--vscode-editorHoverWidget-foreground': '#e0e0e0',
    '--vscode-editorHoverWidget-border': '#2a2a3a',
    '--vscode-notifications-background': '#1a1a24',
    '--vscode-notifications-foreground': '#e0e0e0',
    '--vscode-notificationCenter-border': '#2a2a3a',
    '--vscode-commandCenter-background': '#1a1a24',
    '--vscode-commandCenter-foreground': '#e0e0e0',
    '--vscode-commandCenter-border': '#2a2a3a',
    '--vscode-commandCenter-activeBackground': '#2a2a3a',
    '--vscode-commandCenter-activeForeground': '#ffffff',
    '--vscode-list-focusBackground': '#2a2a3a',
    '--vscode-list-focusForeground': '#ffffff',
    '--vscode-list-inactiveSelectionBackground': '#1a1a24',
    '--vscode-list-highlightForeground': '#818cf8',
  };
  for (var k in vars) ds.setProperty(k, vars[k]);
  // Ensure html/body fill the iframe viewport so extension layouts work correctly
  // (flex containers, absolute/fixed popups like slash command menus, etc.)
  var style = document.createElement('style');
  style.textContent = 'html, body { width: 100%; height: 100%; overflow: hidden; margin: 0; padding: 0; }';
  document.head.appendChild(style);
  document.body.style.backgroundColor = 'var(--vscode-editor-background, #0d0d12)';
  document.body.style.color = 'var(--vscode-editor-foreground, #e0e0e0)';
})();
</script>`;

  protocol.handle('singularity-ext', async (request) => {
    try {
      const url = new URL(request.url);
      const extId = url.hostname;
      let filePath = decodeURIComponent(url.pathname).replace(/^\//, '');

      // Security: prevent directory traversal
      if (filePath.includes('..') && !filePath.startsWith('_exthost_webview/')) {
        return new Response('Forbidden', { status: 403 });
      }

      // ===== Dynamic webview HTML (served from extension host memory) =====
      // Path format: _exthost_webview/{encodedPanelId}
      if (filePath.startsWith('_exthost_webview/')) {
        const panelId = decodeURIComponent(filePath.substring('_exthost_webview/'.length));
        const mgr = getExtensionHostManager();
        console.log(`[Protocol] Serving webview HTML: extId=${extId}, panelId=${panelId}`);
        let html = mgr.getWebviewHtml(extId, panelId);

        if (!html) {
          console.error(`[Protocol] Webview HTML not found for extId=${extId}, panelId=${panelId}`);
          return new Response('Webview HTML not available', { status: 404 });
        }
        console.log(`[Protocol] Found webview HTML: ${html.length} bytes`);

        // Strip existing Content-Security-Policy meta tags — we handle security via
        // the iframe sandbox attribute and the custom protocol's isolation
        html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

        // Remove nonce attributes from script/style/link tags so our injected shim works
        html = html.replace(/\s+nonce="[^"]*"/gi, '');

        // Remove crossorigin attributes (they fail with custom protocols)
        html = html.replace(/\s+crossorigin/gi, '');

        // Only inject base tag if the extension didn't already include one
        const hasBase = /<base\s+/i.test(html);
        const baseUrl = `singularity-ext://${extId}/`;
        const baseTag = hasBase ? '' : `<base href="${baseUrl}" />`;

        // Inject shim (+ base tag if needed) into the HTML
        const injection = baseTag + vscodeApiShim;
        if (html.includes('<head>')) {
          html = html.replace('<head>', '<head>' + injection);
        } else if (html.includes('<head')) {
          html = html.replace(/<head([^>]*)>/, '<head$1>' + injection);
        } else if (html.includes('<!DOCTYPE') || html.includes('<html')) {
          html = html.replace(/<html([^>]*)>/, '<html$1><head>' + injection + '</head>');
        } else {
          html = '<!DOCTYPE html><html><head>' + injection + '</head><body>' + html + '</body></html>';
        }

        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          },
        });
      }

      // ===== Static file serving =====
      // Try direct path first, then fallback directories for extensions
      // that use relative paths from subdirectories (e.g., webview/index.html referencing ./assets/X.js)
      const extensionBase = path.join(extensionsDir, extId, 'extension');
      const directPath = path.join(extensionBase, filePath);

      // Fallback directories to search if file not found at direct path
      const fallbackDirs = ['webview', 'dist', 'out', 'media', 'build', 'resources'];

      let fullPath = directPath;
      let found = false;
      try {
        const s = await fsStat(directPath);
        if (s.isFile()) found = true;
      } catch {}

      if (!found) {
        // Try each fallback directory
        for (const dir of fallbackDirs) {
          const candidate = path.join(extensionBase, dir, filePath);
          try {
            const s = await fsStat(candidate);
            if (s.isFile()) {
              fullPath = candidate;
              found = true;
              break;
            }
          } catch {}
        }
      }

      const ext = path.extname(fullPath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // For HTML files: inject the VS Code API shim and base tag
      if (ext === '.html') {
        let html = await readFile(fullPath, 'utf-8');

        // Strip CSP meta tags (same as dynamic HTML)
        html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
        html = html.replace(/\s+nonce="[^"]*"/gi, '');

        // Inject base tag for resolving relative URLs
        const baseDir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
        const baseUrl = `singularity-ext://${extId}/${baseDir}`;
        const baseTag = `<base href="${baseUrl}" />`;

        // Remove crossorigin attributes (they fail with custom protocols)
        html = html.replace(/\s+crossorigin/gi, '');

        // Inject shim + base tag after <head>
        if (html.includes('<head>')) {
          html = html.replace('<head>', '<head>' + baseTag + vscodeApiShim);
        } else if (html.includes('<head')) {
          html = html.replace(/<head([^>]*)>/, '<head$1>' + baseTag + vscodeApiShim);
        } else {
          html = baseTag + vscodeApiShim + html;
        }

        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // For non-HTML files: serve directly
      const fileUrl = `file:///${fullPath.replace(/\\/g, '/')}`;
      const response = await net.fetch(fileUrl);

      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });

  createWindow();
  // Backfill extension contributions for extensions installed before parsing was added
  try { await extensionIpcHandlers['extensions:backfill-contributions'](null); } catch {}

  // Check for extension updates after a short delay (don't block startup)
  setTimeout(async () => {
    try {
      const updates = await extensionIpcHandlers['extensions:check-updates'](null);
      if (updates.length > 0 && win) {
        console.log(`[ExtUpdater] ${updates.length} extension update(s) available:`, updates.map((u: any) => `${u.id} ${u.currentVersion} → ${u.latestVersion}`).join(', '));
        win.webContents.send('extensions:updates-available', updates);
      }
    } catch (e: any) {
      console.warn('[ExtUpdater] Failed to check for updates:', e.message);
    }
  }, 10000); // 10 seconds after startup
})
