import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
  removeListener(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
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
  toolCall: (request: any) => ipcRenderer.invoke('model:tool-call', request),
  validateKey: (provider: string, apiKey: string) => ipcRenderer.invoke('model:validate-key', provider, apiKey),
  getModels: () => ipcRenderer.invoke('model:get-models'),
  getProviders: () => ipcRenderer.invoke('model:get-providers'),
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
