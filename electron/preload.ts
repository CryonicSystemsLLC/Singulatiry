import { ipcRenderer, contextBridge } from 'electron'

// --------- IPC Channel Security ---------
// Only allow channels that the renderer legitimately uses.
// Prefix-based allowlist: any channel starting with these prefixes is permitted.
const ALLOWED_CHANNEL_PREFIXES = [
  'fs:',
  'dialog:',
  'terminal:',
  'menu:',
  'git:',
  'github:',
  'remote:',
  'extensions:',
  'exthost:',
  'debug:',
  'model:',
  'provider:',
  'mcp:',
  'keys:',
  'persist:',
  'agent:',
  'templates:',
  'devserver:',
  'recipe:',
  'metrics:',
  'costs:',
  'guardrails:',
  'sandbox:',
  'automation:',
  'ratelimit:',
  'circuit:',
  'ai:',
  'shell:',
]

// Standalone channels that don't fit a prefix group
const ALLOWED_CHANNELS = new Set([
  'main-process-message',
])

function isChannelAllowed(channel: string): boolean {
  if (ALLOWED_CHANNELS.has(channel)) return true
  for (const prefix of ALLOWED_CHANNEL_PREFIXES) {
    if (channel.startsWith(prefix)) return true
  }
  return false
}

function assertChannel(channel: string): void {
  if (!isChannelAllowed(channel)) {
    console.warn(`[Preload] Blocked IPC on disallowed channel: ${channel}`)
    throw new Error(`IPC channel not allowed: ${channel}`)
  }
}

// --------- Expose filtered IPC to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    assertChannel(channel)
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    assertChannel(channel)
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    assertChannel(channel)
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    assertChannel(channel)
    return ipcRenderer.invoke(channel, ...omit)
  },
  removeListener(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    assertChannel(channel)
    return ipcRenderer.off(channel, ...omit)
  },
})

// --------- Secure Key Storage API ---------
contextBridge.exposeInMainWorld('keyStorage', {
  set: (provider: string, key: string) => ipcRenderer.invoke('keys:set', provider, key),
  get: (provider: string) => ipcRenderer.invoke('keys:get', provider),
  delete: (provider: string) => ipcRenderer.invoke('keys:delete', provider),
  list: () => ipcRenderer.invoke('keys:list'),
  getMetadata: (provider: string) => ipcRenderer.invoke('keys:metadata', provider),
})

// --------- Model Service API ---------
contextBridge.exposeInMainWorld('modelService', {
  generate: (request: any) => ipcRenderer.invoke('model:generate', request),
  chat: (request: any) => ipcRenderer.invoke('model:chat', request),
  stream: (request: any, callbacks: { onChunk?: (chunk: any) => void; onDone?: (response: any) => void; onError?: (error: any) => void }) => {
    const chunkHandler = (_event: any, chunk: any) => callbacks.onChunk?.(chunk);
    const doneHandler = (_event: any, response: any) => {
      cleanup();
      callbacks.onDone?.(response);
    };
    const errorHandler = (_event: any, error: any) => {
      cleanup();
      callbacks.onError?.(error);
    };
    const cleanup = () => {
      ipcRenderer.removeListener('model:stream-chunk', chunkHandler);
      ipcRenderer.removeListener('model:stream-done', doneHandler);
      ipcRenderer.removeListener('model:stream-error', errorHandler);
    };

    ipcRenderer.on('model:stream-chunk', chunkHandler);
    ipcRenderer.on('model:stream-done', doneHandler);
    ipcRenderer.on('model:stream-error', errorHandler);

    // Start the stream
    ipcRenderer.invoke('model:stream', request).catch((err: any) => {
      cleanup();
      callbacks.onError?.({ message: err.message });
    });

    // Return cleanup function
    return cleanup;
  },
  toolCall: (request: any) => ipcRenderer.invoke('model:tool-call', request),
  countTokens: (text: string, model?: string) => ipcRenderer.invoke('model:count-tokens', text, model),
  validateKey: (provider: string, apiKey: string) => ipcRenderer.invoke('model:validate-key', provider, apiKey),
  getModels: () => ipcRenderer.invoke('model:get-models'),
  getProviders: () => ipcRenderer.invoke('model:get-providers'),
  getCapabilities: (model: string) => ipcRenderer.invoke('model:get-capabilities', model),
  setDefault: (model: string) => ipcRenderer.invoke('model:set-default', model),
  getDefault: (taskType?: string) => ipcRenderer.invoke('model:get-default', taskType),
})

// --------- AI Autocomplete API ---------
contextBridge.exposeInMainWorld('aiAutocomplete', {
  complete: (request: any) => ipcRenderer.invoke('ai:autocomplete', request),
})

// --------- Persistence API ---------
contextBridge.exposeInMainWorld('persistence', {
  getChat: (projectRoot: string) => ipcRenderer.invoke('persist:get-chat', projectRoot),
  saveChat: (projectRoot: string, messages: any[]) => ipcRenderer.invoke('persist:save-chat', projectRoot, messages),
  clearChat: (projectRoot: string) => ipcRenderer.invoke('persist:clear-chat', projectRoot),
  listProjects: () => ipcRenderer.invoke('persist:list-projects'),
  getSession: () => ipcRenderer.invoke('persist:get-session'),
  saveSession: (state: any) => ipcRenderer.invoke('persist:save-session', state),
  getCostHistory: (days?: number) => ipcRenderer.invoke('persist:get-cost-history', days),
  addCost: (entry: any) => ipcRenderer.invoke('persist:add-cost', entry),
  getTotalCost: () => ipcRenderer.invoke('persist:get-total-cost'),
})

// --------- Agent Orchestrator API ---------
contextBridge.exposeInMainWorld('agent', {
  createPlan: (request: any) => ipcRenderer.invoke('agent:create-plan', request),
  refinePlan: (feedback: string) => ipcRenderer.invoke('agent:refine-plan', feedback),
  validatePlan: () => ipcRenderer.invoke('agent:validate-plan'),
  estimatePlan: () => ipcRenderer.invoke('agent:estimate-plan'),
  getPlan: () => ipcRenderer.invoke('agent:get-plan'),
  clearPlan: () => ipcRenderer.invoke('agent:clear-plan'),
  cancel: () => ipcRenderer.invoke('agent:cancel'),
  pause: () => ipcRenderer.invoke('agent:pause'),
  resume: () => ipcRenderer.invoke('agent:resume'),
  rollback: (toTaskId?: string) => ipcRenderer.invoke('agent:rollback', toTaskId),
  getState: () => ipcRenderer.invoke('agent:get-state'),
  setMode: (mode: 'pro' | 'kid') => ipcRenderer.invoke('agent:set-mode', mode),
  getMode: () => ipcRenderer.invoke('agent:get-mode'),
})

// --------- Stack Templates API ---------
contextBridge.exposeInMainWorld('templates', {
  getStacks: () => ipcRenderer.invoke('templates:get-stacks'),
  getStack: (stackId: string) => ipcRenderer.invoke('templates:get-stack', stackId),
})

// --------- Dev Server API ---------
contextBridge.exposeInMainWorld('devServer', {
  register: (config: any) => ipcRenderer.invoke('devserver:register', config),
  start: (serverId: string) => ipcRenderer.invoke('devserver:start', serverId),
  stop: (serverId: string) => ipcRenderer.invoke('devserver:stop', serverId),
  restart: (serverId: string) => ipcRenderer.invoke('devserver:restart', serverId),
  getStatus: (serverId: string) => ipcRenderer.invoke('devserver:status', serverId),
  getAllStatuses: () => ipcRenderer.invoke('devserver:all-status'),
  stopAll: () => ipcRenderer.invoke('devserver:stop-all'),
  onEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('devserver:event', handler);
    return () => ipcRenderer.removeListener('devserver:event', handler);
  },
})

// --------- Recipe System API ---------
contextBridge.exposeInMainWorld('recipes', {
  list: () => ipcRenderer.invoke('recipe:list'),
  get: (recipeId: string) => ipcRenderer.invoke('recipe:get', recipeId),
  execute: (recipeId: string, params: Record<string, any>, projectRoot: string, stackId?: string) =>
    ipcRenderer.invoke('recipe:execute', recipeId, params, projectRoot, stackId),
  rollback: () => ipcRenderer.invoke('recipe:rollback'),
  onProgress: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('recipe:progress', handler);
    return () => ipcRenderer.removeListener('recipe:progress', handler);
  },
})

// --------- Metrics & Telemetry API ---------
contextBridge.exposeInMainWorld('metrics', {
  startSession: (projectId?: string) => ipcRenderer.invoke('metrics:start-session', projectId),
  endSession: (projectId?: string) => ipcRenderer.invoke('metrics:end-session', projectId),
  getSession: () => ipcRenderer.invoke('metrics:get-session'),
  getGlobal: () => ipcRenderer.invoke('metrics:get-global'),
  getProject: (projectId: string) => ipcRenderer.invoke('metrics:get-project', projectId),
  export: () => ipcRenderer.invoke('metrics:export'),
})

// --------- Cost Tracking API ---------
contextBridge.exposeInMainWorld('costs', {
  getSession: () => ipcRenderer.invoke('costs:get-session'),
  getDaily: () => ipcRenderer.invoke('costs:get-daily'),
  getBudgetStatus: () => ipcRenderer.invoke('costs:get-budget-status'),
  setBudget: (budget: any) => ipcRenderer.invoke('costs:set-budget', budget),
  calculate: (model: string, inputTokens: number, outputTokens: number) =>
    ipcRenderer.invoke('costs:calculate', model, inputTokens, outputTokens),
})

// --------- Guardrails API ---------
contextBridge.exposeInMainWorld('guardrails', {
  checkCost: (estimatedCost: number) => ipcRenderer.invoke('guardrails:check-cost', estimatedCost),
  getCostStatus: () => ipcRenderer.invoke('guardrails:get-cost-status'),
  setCostConfig: (config: any) => ipcRenderer.invoke('guardrails:set-cost-config', config),
  filterContent: (content: string) => ipcRenderer.invoke('guardrails:filter-content', content),
  filterCode: (code: string, language?: string) => ipcRenderer.invoke('guardrails:filter-code', code, language),
  setMode: (mode: 'kid' | 'pro') => ipcRenderer.invoke('guardrails:set-mode', mode),
  getConfig: () => ipcRenderer.invoke('guardrails:get-config'),
})

// --------- Sandbox API ---------
contextBridge.exposeInMainWorld('sandbox', {
  execute: (command: string, options?: any) => ipcRenderer.invoke('sandbox:execute', command, options),
  checkCommand: (command: string) => ipcRenderer.invoke('sandbox:check-command', command),
  checkPath: (path: string) => ipcRenderer.invoke('sandbox:check-path', path),
  setMode: (mode: 'pro' | 'kid', projectRoot?: string) =>
    ipcRenderer.invoke('sandbox:set-mode', mode, projectRoot),
  getActive: () => ipcRenderer.invoke('sandbox:get-active'),
  kill: (pid: number) => ipcRenderer.invoke('sandbox:kill', pid),
  killAll: () => ipcRenderer.invoke('sandbox:kill-all'),
})

// --------- Automation API ---------
contextBridge.exposeInMainWorld('automation', {
  start: (projectRoot?: string) => ipcRenderer.invoke('automation:start', projectRoot),
  stop: () => ipcRenderer.invoke('automation:stop'),
  getTriggers: () => ipcRenderer.invoke('automation:get-triggers'),
  addTrigger: (trigger: any) => ipcRenderer.invoke('automation:add-trigger', trigger),
  removeTrigger: (triggerId: string) => ipcRenderer.invoke('automation:remove-trigger', triggerId),
  setTriggerEnabled: (triggerId: string, enabled: boolean) =>
    ipcRenderer.invoke('automation:set-trigger-enabled', triggerId, enabled),
  triggerEvent: (type: any, metadata?: any) => ipcRenderer.invoke('automation:trigger-event', type, metadata),
  onTriggerExecuted: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('automation:trigger-executed', handler);
    return () => ipcRenderer.removeListener('automation:trigger-executed', handler);
  },
  onFileChange: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('automation:file-change', handler);
    return () => ipcRenderer.removeListener('automation:file-change', handler);
  },
  onNotification: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('automation:notification', handler);
    return () => ipcRenderer.removeListener('automation:notification', handler);
  },
})

// --------- MCP Server API ---------
contextBridge.exposeInMainWorld('mcp', {
  listServers: () => ipcRenderer.invoke('mcp:list-servers'),
  startServer: (id: string) => ipcRenderer.invoke('mcp:start-server', id),
  stopServer: (id: string) => ipcRenderer.invoke('mcp:stop-server', id),
  restartServer: (id: string) => ipcRenderer.invoke('mcp:restart-server', id),
  getTools: () => ipcRenderer.invoke('mcp:get-tools'),
  callTool: (registryName: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke('mcp:call-tool', registryName, args),
  addServer: (id: string, config: any, scope: 'project' | 'user') =>
    ipcRenderer.invoke('mcp:add-server', id, config, scope),
  removeServer: (id: string, scope: 'project' | 'user') =>
    ipcRenderer.invoke('mcp:remove-server', id, scope),
  loadConfig: (projectRoot?: string) => ipcRenderer.invoke('mcp:load-config', projectRoot),
  onStatusChange: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('mcp:status-change', handler);
    return () => ipcRenderer.removeListener('mcp:status-change', handler);
  },
  onToolsChanged: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('mcp:tools-changed', handler);
    return () => ipcRenderer.removeListener('mcp:tools-changed', handler);
  },
})

// --------- Rate Limiter API ---------
contextBridge.exposeInMainWorld('rateLimit', {
  check: (provider: string, tokens?: number) => ipcRenderer.invoke('ratelimit:check', provider, tokens),
  acquire: (provider: string, tokens?: number) => ipcRenderer.invoke('ratelimit:acquire', provider, tokens),
  getStats: (provider: string) => ipcRenderer.invoke('ratelimit:get-stats', provider),
  setConfig: (provider: string, config: any) => ipcRenderer.invoke('ratelimit:set-config', provider, config),
})

// --------- Circuit Breaker API ---------
contextBridge.exposeInMainWorld('circuit', {
  getStates: () => ipcRenderer.invoke('circuit:get-states'),
  reset: (provider: string) => ipcRenderer.invoke('circuit:reset', provider),
  resetAll: () => ipcRenderer.invoke('circuit:reset-all'),
})

// --------- Remote SSH API ---------
contextBridge.exposeInMainWorld('remoteService', {
  connect: (config: any, password?: string) => ipcRenderer.invoke('remote:connect', config, password),
  disconnect: (connId?: string) => ipcRenderer.invoke('remote:disconnect', connId),
  getState: (connId?: string) => ipcRenderer.invoke('remote:get-state', connId),
  listStates: () => ipcRenderer.invoke('remote:list-states'),
  getActive: () => ipcRenderer.invoke('remote:get-active'),
  setActive: (connId: string | null) => ipcRenderer.invoke('remote:set-active', connId),
  saveConfig: (config: any) => ipcRenderer.invoke('remote:save-config', config),
  listConfigs: () => ipcRenderer.invoke('remote:list-configs'),
  deleteConfig: (configId: string) => ipcRenderer.invoke('remote:delete-config', configId),
  hasCredential: (connId: string) => ipcRenderer.invoke('remote:has-credential', connId),
  clearCredential: (connId: string) => ipcRenderer.invoke('remote:clear-credential', connId),
  onStateChange: (callback: (state: any) => void) => {
    const handler = (_event: any, state: any) => callback(state);
    ipcRenderer.on('remote:state-change', handler);
    return () => ipcRenderer.removeListener('remote:state-change', handler);
  },
})
