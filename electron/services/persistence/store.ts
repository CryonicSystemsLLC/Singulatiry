/**
 * Persistence Service — Uses electron-store to persist app state across sessions.
 * Handles: chat history, session state, metrics history.
 */

import Store from 'electron-store';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost?: number };
  timestamp: number;
}

interface SessionState {
  lastProjectRoot: string | null;
  openFiles: string[];
  activeFile: string | null;
  sidebarWidth: number;
  chatWidth: number;
  terminalHeight: number;
  sidebarView: string;
  selectedModel: string;
  windowBounds?: { x: number; y: number; width: number; height: number };
}

interface CostEntry {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

interface StoreSchema {
  chatHistory: Record<string, ChatMessage[]>; // keyed by project path
  session: SessionState;
  costHistory: CostEntry[];
  totalCost: number;
}

const DEFAULT_SESSION: SessionState = {
  lastProjectRoot: null,
  openFiles: [],
  activeFile: null,
  sidebarWidth: 256,
  chatWidth: 320,
  terminalHeight: 192,
  sidebarView: 'explorer',
  selectedModel: 'claude-sonnet-4-6'
};

let store: Store<StoreSchema> | null = null;

function getStore(): Store<StoreSchema> {
  if (!store) {
    store = new Store<StoreSchema>({
      name: 'singularity-state',
      defaults: {
        chatHistory: {},
        session: DEFAULT_SESSION,
        costHistory: [],
        totalCost: 0
      }
    });
  }
  return store;
}

// ===== Chat History =====

export function getChatHistory(projectRoot: string): ChatMessage[] {
  const s = getStore();
  const all = s.get('chatHistory', {});
  return all[projectRoot] || [];
}

export function saveChatHistory(projectRoot: string, messages: ChatMessage[]): void {
  const s = getStore();
  const all = s.get('chatHistory', {});
  // Keep last 200 messages per project
  all[projectRoot] = messages.slice(-200);
  s.set('chatHistory', all);
}

export function clearChatHistory(projectRoot: string): void {
  const s = getStore();
  const all = s.get('chatHistory', {});
  delete all[projectRoot];
  s.set('chatHistory', all);
}

export function listChatProjects(): string[] {
  const s = getStore();
  return Object.keys(s.get('chatHistory', {}));
}

// ===== Session State =====

export function getSessionState(): SessionState {
  const s = getStore();
  return s.get('session', DEFAULT_SESSION);
}

export function saveSessionState(state: Partial<SessionState>): void {
  const s = getStore();
  const current = s.get('session', DEFAULT_SESSION);
  s.set('session', { ...current, ...state });
}

// ===== Cost History =====

export function addCostEntry(entry: CostEntry): void {
  const s = getStore();
  const history = s.get('costHistory', []);
  history.push(entry);
  // Keep last 1000 entries
  if (history.length > 1000) history.splice(0, history.length - 1000);
  s.set('costHistory', history);
  s.set('totalCost', (s.get('totalCost', 0) + entry.estimatedCost));
}

export function getCostHistory(days?: number): CostEntry[] {
  const s = getStore();
  const history = s.get('costHistory', []);
  if (!days) return history;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter(e => new Date(e.date).getTime() > cutoff);
}

export function getTotalCost(): number {
  return getStore().get('totalCost', 0);
}

// ===== IPC Handlers =====

export const persistenceIpcHandlers: Record<string, (...args: any[]) => any> = {
  'persist:get-chat': (_event: any, projectRoot: string) => getChatHistory(projectRoot),
  'persist:save-chat': (_event: any, projectRoot: string, messages: ChatMessage[]) => {
    saveChatHistory(projectRoot, messages);
    return { success: true };
  },
  'persist:clear-chat': (_event: any, projectRoot: string) => {
    clearChatHistory(projectRoot);
    return { success: true };
  },
  'persist:list-projects': () => listChatProjects(),
  'persist:get-session': () => getSessionState(),
  'persist:save-session': (_event: any, state: Partial<SessionState>) => {
    saveSessionState(state);
    return { success: true };
  },
  'persist:get-cost-history': (_event: any, days?: number) => getCostHistory(days),
  'persist:add-cost': (_event: any, entry: CostEntry) => {
    addCostEntry(entry);
    return { success: true };
  },
  'persist:get-total-cost': () => getTotalCost()
};
