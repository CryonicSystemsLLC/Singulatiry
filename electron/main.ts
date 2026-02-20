import { app, BrowserWindow, ipcMain, dialog, Menu, MenuItemConstructorOptions, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { exec } from 'node:child_process';

// Import new services
import { keyStorageIpcHandlers } from './services/keychain';
import { modelServiceIpcHandlers } from './services/models/unified';
import { orchestratorIpcHandlers } from './services/agent/orchestrator';
import { AVAILABLE_STACKS, getStackById } from './services/templates/stacks';
import { devServerIpcHandlers, getDevServerManager } from './services/devserver/manager';

// Phase 3 & 4 imports
import { RecipeExecutor } from './services/recipes/executor';
import { builtinRecipes } from './services/recipes/builtin';
import { getMetricsCollector } from './services/telemetry/metrics';
import { getCostTracker } from './services/telemetry/cost-tracker';
import { getCostLimitGuardrail } from './services/guardrails/cost-limits';
import { getContentFilter } from './services/guardrails/content-filter';
import { SandboxManager, getGlobalSandbox, setGlobalSandbox } from './services/sandbox/manager';
import { getAutomationWatcher } from './services/automation/watcher';
import { getRateLimiter } from './services/models/rate-limiter';
import { getResilientExecutor } from './services/models/retry';

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

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
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

// IPC Handlers
ipcMain.handle('dialog:openDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory']
  })
  if (canceled) {
    return null
  } else {
    return filePaths[0]
  }
})

ipcMain.handle('fs:readDir', async (_, dirPath) => {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(dirPath, entry.name)
    }));
  } catch (error) {
    console.error('Failed to read directory', error);
    throw error;
  }
})

ipcMain.handle('fs:readFile', async (_, filePath) => {
  return await readFile(filePath, 'utf-8');
})

ipcMain.handle('fs:writeFile', async (_, filePath, content) => {
  await writeFile(filePath, content);
})

// Recursive search helper
async function searchFiles(dir: string, query: string, maxDepth = 5, currentDepth = 0): Promise<{ path: string, preview: string }[]> {
  if (currentDepth > maxDepth) return [];
  if (currentDepth > maxDepth) return [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const tasks = entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'release'].includes(entry.name)) {
          return await searchFiles(fullPath, query, maxDepth, currentDepth + 1);
        }
      } else if (entry.isFile()) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const index = content.toLowerCase().indexOf(query.toLowerCase());
          if (index !== -1) {
            const start = Math.max(0, index - 20);
            const end = Math.min(content.length, index + 40);
            const preview = (start > 0 ? '...' : '') + content.substring(start, end).replace(/\n/g, ' ') + (end < content.length ? '...' : '');
            return [{ path: fullPath, preview }];
          }
        } catch { /* ignore */ }
      }
      return [] as { path: string, preview: string }[];
    });

    const results = await Promise.all(tasks);
    return results.flat();
  } catch { return []; }
}

ipcMain.handle('fs:search', async (_, rootPath, query) => {
  if (!rootPath || !query) return [];
  return await searchFiles(rootPath, query);
})

async function listAllFiles(dir: string, maxDepth = 4, currentDepth = 0): Promise<string[]> {
  if (currentDepth > maxDepth) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'release', 'build', '.vscode', '.idea'].includes(entry.name)) {
          // Sequential await to prevent CPU saturation
          const subFiles = await listAllFiles(fullPath, maxDepth, currentDepth + 1);
          // Avoid stack overflow from push(...arr)
          files = files.concat(subFiles);
        }
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  } catch { return []; }
}

ipcMain.handle('fs:listAllFiles', async (_, rootPath) => {
  if (!rootPath) return [];
  return await listAllFiles(rootPath);
})

// Terminal Backend
let terminalProcess: any = null;

ipcMain.handle('terminal:create', () => {
  if (terminalProcess) {
    try {
      terminalProcess.kill();
    } catch (e) { console.error('Failed to kill terminal', e) }
  }

  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : 'bash';
  // When using powershell.exe directly, we don't need shell: true usually.
  const args = isWin ? ['-NoLogo', '-NoExit', '-Command', '-'] : [];

  try {
    terminalProcess = require('node:child_process').spawn(shell, args, {
      cwd: process.env.USERPROFILE || process.cwd(),
      env: process.env,
      shell: !isWin // On Windows, if we point to an exe (powershell.exe), shell: false is often more stable.
    });

    terminalProcess.stdout.on('data', (data: any) => {
      win?.webContents.send('terminal:incoming', data.toString());
    });

    terminalProcess.stderr.on('data', (data: any) => {
      win?.webContents.send('terminal:incoming', data.toString());
    });

    terminalProcess.on('error', (err: any) => {
      console.error('Terminal spawn error', err);
      win?.webContents.send('terminal:incoming', `\r\nError launching shell: ${err.message}`);
    });

    terminalProcess.on('exit', (code: number) => {
      win?.webContents.send('terminal:incoming', `\r\nSession Ended (Code: ${code})`);
      terminalProcess = null;
    });

    // Explicitly confirm creation
    return true;
  } catch (e: any) {
    console.error('Failed to spawn terminal', e);
    return false;
  }
});

ipcMain.on('terminal:write', (_, data) => {
  if (terminalProcess && terminalProcess.stdin) {
    terminalProcess.stdin.write(data);
  }
});

// OS Command Runner (One-off)
ipcMain.handle('os:runCommand', async (_, command, cwd) => {
  return new Promise((resolve) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, output: stderr || error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
})

// Register Key Storage IPC Handlers
for (const [channel, handler] of Object.entries(keyStorageIpcHandlers)) {
  ipcMain.handle(channel, handler);
}

// Register Model Service IPC Handlers
for (const [channel, handler] of Object.entries(modelServiceIpcHandlers)) {
  ipcMain.handle(channel, handler);
}

// Register Agent Orchestrator IPC Handlers
for (const [channel, handler] of Object.entries(orchestratorIpcHandlers)) {
  if (typeof handler === 'function') {
    ipcMain.handle(channel, handler as any);
  }
}

// Stack Templates IPC Handler
ipcMain.handle('templates:get-stacks', () => {
  return AVAILABLE_STACKS;
});

ipcMain.handle('templates:get-stack', (_, stackId: string) => {
  return getStackById(stackId);
});

// Register Dev Server IPC Handlers
for (const [channel, handler] of Object.entries(devServerIpcHandlers)) {
  ipcMain.handle(channel, handler as any);
}

// Forward dev server events to renderer
const devServerManager = getDevServerManager();
devServerManager.on('event', (event) => {
  win?.webContents.send('devserver:event', event);
});

// ===== Recipe System IPC Handlers =====
let recipeExecutor: RecipeExecutor | null = null;

function getRecipeExecutor(): RecipeExecutor {
  if (!recipeExecutor) {
    recipeExecutor = new RecipeExecutor();
  }
  return recipeExecutor;
}

ipcMain.handle('recipe:list', () => {
  return builtinRecipes;
});

ipcMain.handle('recipe:get', (_, recipeId: string) => {
  return builtinRecipes.find((r: any) => r.id === recipeId) || null;
});

ipcMain.handle('recipe:execute', async (_, recipeId: string, params: Record<string, any>, projectRoot: string, stackId?: string) => {
  const executor = getRecipeExecutor();
  const recipe = builtinRecipes.find((r: any) => r.id === recipeId);
  if (!recipe) {
    return { success: false, error: 'Recipe not found' };
  }

  try {
    const result = await executor.execute(recipe, {
      projectRoot,
      stackId: stackId || 'nextjs-prisma',
      parameters: params,
      variables: {},
      dryRun: false
    });
    return result;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('recipe:rollback', async () => {
  const executor = getRecipeExecutor();
  await executor.rollback();
  return { success: true };
});

// ===== Telemetry & Metrics IPC Handlers =====
const metricsCollector = getMetricsCollector();
const costTracker = getCostTracker();

ipcMain.handle('metrics:start-session', (_, projectId?: string) => {
  return metricsCollector.startSession(projectId);
});

ipcMain.handle('metrics:end-session', (_, projectId?: string) => {
  return metricsCollector.endSession(projectId);
});

ipcMain.handle('metrics:get-session', () => {
  return metricsCollector.getCurrentSessionMetrics();
});

ipcMain.handle('metrics:get-global', () => {
  return metricsCollector.getGlobalMetrics();
});

ipcMain.handle('metrics:get-project', (_, projectId: string) => {
  return metricsCollector.getProjectMetrics(projectId);
});

ipcMain.handle('metrics:export', () => {
  return metricsCollector.exportMetrics();
});

// Cost Tracking
ipcMain.handle('costs:get-session', () => {
  return costTracker.getSessionCosts();
});

ipcMain.handle('costs:get-daily', () => {
  return costTracker.getDailyCosts();
});

ipcMain.handle('costs:get-budget-status', () => {
  return costTracker.getBudgetStatus();
});

ipcMain.handle('costs:set-budget', (_, budget: any) => {
  costTracker.setBudget(budget);
  return { success: true };
});

ipcMain.handle('costs:calculate', (_, model: string, inputTokens: number, outputTokens: number) => {
  return costTracker.calculateCost(model, inputTokens, outputTokens);
});

// ===== Guardrails IPC Handlers =====
const costGuardrail = getCostLimitGuardrail();
const contentFilter = getContentFilter();

ipcMain.handle('guardrails:check-cost', async (_, estimatedCost: number) => {
  return costGuardrail.checkRequest(estimatedCost);
});

ipcMain.handle('guardrails:get-cost-status', () => {
  return costGuardrail.getCostStatus();
});

ipcMain.handle('guardrails:set-cost-config', (_, config: any) => {
  costGuardrail.updateConfig(config);
  return { success: true };
});

ipcMain.handle('guardrails:filter-content', (_, content: string) => {
  return contentFilter.filter(content);
});

ipcMain.handle('guardrails:filter-code', (_, code: string, language?: string) => {
  return contentFilter.filterCode(code, language);
});

ipcMain.handle('guardrails:set-mode', (_, mode: 'kid' | 'pro') => {
  contentFilter.setMode(mode);
  return { success: true };
});

ipcMain.handle('guardrails:get-config', () => {
  return contentFilter.getConfig();
});

// ===== Sandbox IPC Handlers =====
ipcMain.handle('sandbox:execute', async (_, command: string, options?: any) => {
  const sandbox = getGlobalSandbox();
  return sandbox.execute(command, options);
});

ipcMain.handle('sandbox:check-command', (_, command: string) => {
  const sandbox = getGlobalSandbox();
  return sandbox.isCommandAllowed(command);
});

ipcMain.handle('sandbox:check-path', (_, targetPath: string) => {
  const sandbox = getGlobalSandbox();
  return sandbox.isPathAllowed(targetPath);
});

ipcMain.handle('sandbox:set-mode', (_, mode: 'pro' | 'kid', projectRoot?: string) => {
  const sandbox = SandboxManager.forProject(projectRoot || process.cwd(), mode);
  setGlobalSandbox(sandbox);
  return { success: true };
});

ipcMain.handle('sandbox:get-active', () => {
  const sandbox = getGlobalSandbox();
  return sandbox.getActiveProcesses();
});

ipcMain.handle('sandbox:kill', (_, pid: number) => {
  const sandbox = getGlobalSandbox();
  return sandbox.kill(pid);
});

ipcMain.handle('sandbox:kill-all', () => {
  const sandbox = getGlobalSandbox();
  return sandbox.killAll();
});

// ===== Automation Watcher IPC Handlers =====
const automationWatcher = getAutomationWatcher();

ipcMain.handle('automation:start', (_, projectRoot?: string) => {
  if (projectRoot) {
    automationWatcher['config'].projectRoot = projectRoot;
  }
  automationWatcher.start();
  return { success: true };
});

ipcMain.handle('automation:stop', () => {
  automationWatcher.stop();
  return { success: true };
});

ipcMain.handle('automation:get-triggers', () => {
  return automationWatcher.getTriggers();
});

ipcMain.handle('automation:add-trigger', (_, trigger: any) => {
  automationWatcher.addTrigger(trigger);
  return { success: true };
});

ipcMain.handle('automation:remove-trigger', (_, triggerId: string) => {
  return automationWatcher.removeTrigger(triggerId);
});

ipcMain.handle('automation:set-trigger-enabled', (_, triggerId: string, enabled: boolean) => {
  return automationWatcher.setTriggerEnabled(triggerId, enabled);
});

ipcMain.handle('automation:trigger-event', async (_, type: any, metadata?: any) => {
  return automationWatcher.triggerEvent(type, metadata);
});

// Forward automation events to renderer
automationWatcher.on('trigger:executed', (data) => {
  win?.webContents.send('automation:trigger-executed', data);
});

automationWatcher.on('file:change', (data) => {
  win?.webContents.send('automation:file-change', data);
});

automationWatcher.on('notification', (data) => {
  win?.webContents.send('automation:notification', data);
});

// ===== Rate Limiter IPC Handlers =====
const rateLimiter = getRateLimiter();

ipcMain.handle('ratelimit:check', (_, provider: string, tokens?: number) => {
  return rateLimiter.canMakeRequest(provider, tokens);
});

ipcMain.handle('ratelimit:acquire', async (_, provider: string, tokens?: number) => {
  try {
    await rateLimiter.acquire(provider, tokens);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ratelimit:get-stats', (_, provider: string) => {
  return rateLimiter.getUsageStats(provider);
});

ipcMain.handle('ratelimit:set-config', (_, provider: string, config: any) => {
  rateLimiter.setConfig(provider, config);
  return { success: true };
});

// ===== Circuit Breaker IPC Handlers =====
const resilientExecutor = getResilientExecutor();

ipcMain.handle('circuit:get-states', () => {
  return resilientExecutor.getAllCircuitStates();
});

ipcMain.handle('circuit:reset', (_, provider: string) => {
  resilientExecutor.resetCircuit(provider);
  return { success: true };
});

ipcMain.handle('circuit:reset-all', () => {
  resilientExecutor.resetAllCircuits();
  return { success: true };
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
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

app.whenReady().then(createWindow)
