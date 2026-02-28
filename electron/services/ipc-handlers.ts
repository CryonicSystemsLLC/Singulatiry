/**
 * Consolidated IPC Handlers
 *
 * Inline handlers previously scattered through main.ts, now organized
 * by service domain and exported as handler records for bulk registration.
 */

import { dialog, BrowserWindow } from 'electron';
import { RecipeExecutor } from './recipes/executor';
import { builtinRecipes } from './recipes/builtin';
import { getMetricsCollector } from './telemetry/metrics';
import { getCostTracker } from './telemetry/cost-tracker';
import { getCostLimitGuardrail } from './guardrails/cost-limits';
import { getContentFilter } from './guardrails/content-filter';
import { SandboxManager, getGlobalSandbox, setGlobalSandbox } from './sandbox/manager';
import { getAutomationWatcher } from './automation/watcher';
import { getRateLimiter } from './models/rate-limiter';
import { getResilientExecutor } from './models/retry';
import { AVAILABLE_STACKS, getStackById } from './templates/stacks';

// ===== Recipe System =====
let recipeExecutor: RecipeExecutor | null = null;
function getRecipeExecutor(): RecipeExecutor {
  if (!recipeExecutor) recipeExecutor = new RecipeExecutor();
  return recipeExecutor;
}

export const recipeIpcHandlers: Record<string, (...args: any[]) => any> = {
  'recipe:list': () => builtinRecipes,

  'recipe:get': (_event: any, recipeId: string) => {
    return builtinRecipes.find((r: any) => r.id === recipeId) || null;
  },

  'recipe:execute': async (_event: any, recipeId: string, params: Record<string, any>, projectRoot: string, stackId?: string) => {
    const recipe = builtinRecipes.find((r: any) => r.id === recipeId);
    if (!recipe) return { success: false, error: 'Recipe not found' };
    try {
      return await getRecipeExecutor().execute(recipe, {
        projectRoot,
        stackId: stackId || 'nextjs-prisma',
        parameters: params,
        variables: {},
        dryRun: false,
      });
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  'recipe:rollback': async () => {
    await getRecipeExecutor().rollback();
    return { success: true };
  },
};

// ===== Templates =====
export const templateIpcHandlers: Record<string, (...args: any[]) => any> = {
  'templates:get-stacks': () => AVAILABLE_STACKS,
  'templates:get-stack': (_event: any, stackId: string) => getStackById(stackId),
};

// ===== Metrics & Telemetry =====
const metricsCollector = getMetricsCollector();
const costTracker = getCostTracker();

export const metricsIpcHandlers: Record<string, (...args: any[]) => any> = {
  'metrics:start-session': (_event: any, projectId?: string) => metricsCollector.startSession(projectId),
  'metrics:end-session': (_event: any, projectId?: string) => metricsCollector.endSession(projectId),
  'metrics:get-session': () => metricsCollector.getCurrentSessionMetrics(),
  'metrics:get-global': () => metricsCollector.getGlobalMetrics(),
  'metrics:get-project': (_event: any, projectId: string) => metricsCollector.getProjectMetrics(projectId),
  'metrics:export': () => metricsCollector.exportMetrics(),
};

export const costIpcHandlers: Record<string, (...args: any[]) => any> = {
  'costs:get-session': () => costTracker.getSessionCosts(),
  'costs:get-daily': () => costTracker.getDailyCosts(),
  'costs:get-budget-status': () => costTracker.getBudgetStatus(),
  'costs:set-budget': (_event: any, budget: any) => { costTracker.setBudget(budget); return { success: true }; },
  'costs:calculate': (_event: any, model: string, inputTokens: number, outputTokens: number) =>
    costTracker.calculateCost(model, inputTokens, outputTokens),
};

// ===== Guardrails =====
const costGuardrail = getCostLimitGuardrail();
const contentFilter = getContentFilter();

export const guardrailIpcHandlers: Record<string, (...args: any[]) => any> = {
  'guardrails:check-cost': async (_event: any, estimatedCost: number) => costGuardrail.checkRequest(estimatedCost),
  'guardrails:get-cost-status': () => costGuardrail.getCostStatus(),
  'guardrails:set-cost-config': (_event: any, config: any) => { costGuardrail.updateConfig(config); return { success: true }; },
  'guardrails:filter-content': (_event: any, content: string) => contentFilter.filter(content),
  'guardrails:filter-code': (_event: any, code: string, language?: string) => contentFilter.filterCode(code, language),
  'guardrails:set-mode': (_event: any, mode: 'kid' | 'pro') => { contentFilter.setMode(mode); return { success: true }; },
  'guardrails:get-config': () => contentFilter.getConfig(),
};

// ===== Sandbox =====
export const sandboxIpcHandlers: Record<string, (...args: any[]) => any> = {
  'sandbox:execute': async (_event: any, command: string, options?: any) => getGlobalSandbox().execute(command, options),
  'sandbox:check-command': (_event: any, command: string) => getGlobalSandbox().isCommandAllowed(command),
  'sandbox:check-path': (_event: any, targetPath: string) => getGlobalSandbox().isPathAllowed(targetPath),
  'sandbox:set-mode': (_event: any, mode: 'pro' | 'kid', projectRoot?: string) => {
    setGlobalSandbox(SandboxManager.forProject(projectRoot || process.cwd(), mode));
    return { success: true };
  },
  'sandbox:get-active': () => getGlobalSandbox().getActiveProcesses(),
  'sandbox:kill': (_event: any, pid: number) => getGlobalSandbox().kill(pid),
  'sandbox:kill-all': () => getGlobalSandbox().killAll(),
};

// ===== Automation =====
const automationWatcher = getAutomationWatcher();

export function getAutomationWatcherInstance() { return automationWatcher; }

export const automationIpcHandlers: Record<string, (...args: any[]) => any> = {
  'automation:start': (_event: any, projectRoot?: string) => {
    if (projectRoot) (automationWatcher as any)['config'].projectRoot = projectRoot;
    automationWatcher.start();
    return { success: true };
  },
  'automation:stop': () => { automationWatcher.stop(); return { success: true }; },
  'automation:get-triggers': () => automationWatcher.getTriggers(),
  'automation:add-trigger': (_event: any, trigger: any) => { automationWatcher.addTrigger(trigger); return { success: true }; },
  'automation:remove-trigger': (_event: any, triggerId: string) => automationWatcher.removeTrigger(triggerId),
  'automation:set-trigger-enabled': (_event: any, triggerId: string, enabled: boolean) =>
    automationWatcher.setTriggerEnabled(triggerId, enabled),
  'automation:trigger-event': async (_event: any, type: any, metadata?: any) =>
    automationWatcher.triggerEvent(type, metadata),
};

export function registerAutomationEvents(getWin: () => BrowserWindow | null) {
  automationWatcher.on('trigger:executed', (data) => {
    getWin()?.webContents.send('automation:trigger-executed', data);
  });
  automationWatcher.on('file:change', (data) => {
    getWin()?.webContents.send('automation:file-change', data);
  });
  automationWatcher.on('notification', (data) => {
    getWin()?.webContents.send('automation:notification', data);
  });
}

// ===== Rate Limiter =====
const rateLimiter = getRateLimiter();

export const rateLimiterIpcHandlers: Record<string, (...args: any[]) => any> = {
  'ratelimit:check': (_event: any, provider: string, tokens?: number) =>
    rateLimiter.canMakeRequest(provider, tokens),
  'ratelimit:acquire': async (_event: any, provider: string, tokens?: number) => {
    try {
      await rateLimiter.acquire(provider, tokens);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
  'ratelimit:get-stats': (_event: any, provider: string) => rateLimiter.getUsageStats(provider),
  'ratelimit:set-config': (_event: any, provider: string, config: any) => {
    rateLimiter.setConfig(provider, config);
    return { success: true };
  },
};

// ===== Circuit Breaker =====
const resilientExecutor = getResilientExecutor();

export const circuitBreakerIpcHandlers: Record<string, (...args: any[]) => any> = {
  'circuit:get-states': () => resilientExecutor.getAllCircuitStates(),
  'circuit:reset': (_event: any, provider: string) => { resilientExecutor.resetCircuit(provider); return { success: true }; },
  'circuit:reset-all': () => { resilientExecutor.resetAllCircuits(); return { success: true }; },
};

// ===== Dialog =====
export function createDialogHandlers(getWin: () => BrowserWindow | null) {
  return {
    'dialog:openDirectory': async () => {
      const w = getWin();
      if (!w) return null;
      const { canceled, filePaths } = await dialog.showOpenDialog(w, {
        properties: ['openDirectory'],
      });
      return canceled ? null : filePaths[0];
    },
  };
}

// ===== Provider Model Fetching =====
interface ProviderEndpoint {
  url: string;
  headers: Record<string, string>;
  parse: (data: any) => { id: string; name: string }[];
}

function buildProviderEndpoints(apiKey: string): Record<string, ProviderEndpoint> {
  const bearerSort = (data: any) =>
    (data.data || []).map((m: any) => ({ id: m.id, name: m.id })).sort((a: any, b: any) => a.name.localeCompare(b.name));

  return {
    openai: {
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
      parse: (data) =>
        (data.data || [])
          .filter((m: any) => /^(gpt-|o[1-9]|o3|chatgpt-)/.test(m.id))
          .map((m: any) => ({ id: m.id, name: m.id }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    },
    anthropic: {
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      parse: (data) =>
        (data.data || [])
          .map((m: any) => ({ id: m.id, name: m.display_name || m.id }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    },
    gemini: {
      url: `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`,
      headers: {},
      parse: (data) =>
        (data.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => ({
            id: m.name?.replace('models/', '') || m.name,
            name: m.displayName || m.name?.replace('models/', ''),
          }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    },
    xai: {
      url: 'https://api.x.ai/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
      parse: bearerSort,
    },
    deepseek: {
      url: 'https://api.deepseek.com/models',
      headers: { Authorization: `Bearer ${apiKey}` },
      parse: bearerSort,
    },
    qwen: {
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
      parse: bearerSort,
    },
    kimi: {
      url: 'https://api.moonshot.cn/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
      parse: bearerSort,
    },
    mistral: {
      url: 'https://api.mistral.ai/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
      parse: bearerSort,
    },
    cohere: {
      url: 'https://api.cohere.com/v2/models',
      headers: { Authorization: `Bearer ${apiKey}` },
      parse: (data) =>
        (data.models || [])
          .map((m: any) => ({ id: m.name, name: m.name }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    },
  };
}

export const providerFetchHandlers: Record<string, (...args: any[]) => any> = {
  'provider:fetch-models': async (_event: any, providerId: string, apiKey: string) => {
    try {
      const endpoints = buildProviderEndpoints(apiKey);
      const endpoint = endpoints[providerId];
      if (!endpoint) {
        return { success: false, error: `Unknown provider: ${providerId}`, models: [] };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(endpoint.url, {
        headers: { ...endpoint.headers, Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        const status = resp.status;
        if (status === 401 || status === 403) {
          return { success: false, error: 'Invalid API key', models: [] };
        }
        return { success: false, error: `API error (${status})`, models: [] };
      }

      const data = await resp.json();
      const models = endpoint.parse(data);

      if (models.length === 0) {
        return { success: false, error: 'No models returned by the API', models: [] };
      }

      return { success: true, models };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { success: false, error: 'Request timed out', models: [] };
      }
      return { success: false, error: err.message || 'Connection failed', models: [] };
    }
  },
};

/**
 * Register all handler records with ipcMain.handle()
 */
export function registerAllHandlerRecords(
  ipcMain: Electron.IpcMain,
  handlerRecords: Record<string, (...args: any[]) => any>[]
) {
  for (const record of handlerRecords) {
    for (const [channel, handler] of Object.entries(record)) {
      if (typeof handler === 'function') {
        ipcMain.handle(channel, handler as any);
      }
    }
  }
}
