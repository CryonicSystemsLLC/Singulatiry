import { create } from 'zustand';

export interface TabInfo {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  language: string;
  viewState?: any; // Monaco editor view state (scroll, cursor, etc.)
  isWelcome?: boolean;
  isExtension?: boolean;
  extensionId?: string;
}

interface AppState {
  // Project
  projectRoot: string | null;
  projectFiles: string[];
  setProjectRoot: (root: string | null) => void;
  setProjectFiles: (files: string[]) => void;

  // Tabs
  openTabs: TabInfo[];
  activeTabIndex: number;
  openFile: (path: string, name: string, content: string) => void;
  closeTab: (index: number) => void;
  setActiveTab: (index: number) => void;
  updateTabContent: (index: number, content: string) => void;
  markTabDirty: (index: number, dirty: boolean) => void;
  saveTabViewState: (index: number, viewState: any) => void;

  // Layout
  sidebarWidth: number;
  chatWidth: number;
  terminalHeight: number;
  sidebarVisible: boolean;
  terminalVisible: boolean;
  chatVisible: boolean;
  setSidebarWidth: (w: number) => void;
  setChatWidth: (w: number) => void;
  setTerminalHeight: (h: number) => void;
  toggleSidebar: () => void;
  toggleTerminal: () => void;
  toggleChat: () => void;

  // UI State
  isQuickOpenOpen: boolean;
  isCommandPaletteOpen: boolean;
  setQuickOpen: (open: boolean) => void;
  setCommandPalette: (open: boolean) => void;
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
    h: 'c', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', scala: 'scala', r: 'r', sql: 'sql', sh: 'shell', bash: 'shell',
    ps1: 'powershell', yml: 'yaml', yaml: 'yaml', json: 'json', xml: 'xml',
    html: 'html', css: 'css', scss: 'scss', less: 'less', md: 'markdown',
    toml: 'toml', ini: 'ini', cfg: 'ini', env: 'plaintext', txt: 'plaintext',
    dockerfile: 'dockerfile', makefile: 'makefile', graphql: 'graphql',
    vue: 'vue', svelte: 'svelte', dart: 'dart', lua: 'lua', zig: 'zig'
  };
  return map[ext] || 'plaintext';
}

export const useAppStore = create<AppState>((set, get) => ({
  // Project
  projectRoot: null,
  projectFiles: [],
  setProjectRoot: (root) => set({ projectRoot: root, projectFiles: [] }),
  setProjectFiles: (files) => set({ projectFiles: files }),

  // Tabs
  openTabs: [{
    path: 'singularity://welcome',
    name: 'Welcome',
    content: '',
    isDirty: false,
    language: '',
    isWelcome: true
  }],
  activeTabIndex: 0,

  openFile: (path, name, content) => {
    const state = get();
    // Check if already open
    const existingIndex = state.openTabs.findIndex(t => t.path === path);
    if (existingIndex >= 0) {
      set({ activeTabIndex: existingIndex });
      return;
    }
    // Open new tab
    const tab: TabInfo = {
      path, name, content,
      isDirty: false,
      language: detectLanguage(path)
    };
    set({
      openTabs: [...state.openTabs, tab],
      activeTabIndex: state.openTabs.length
    });
  },

  closeTab: (index) => {
    const state = get();
    const newTabs = [...state.openTabs];
    newTabs.splice(index, 1);
    let newActive = state.activeTabIndex;
    if (newActive >= newTabs.length) newActive = newTabs.length - 1;
    if (index < state.activeTabIndex) newActive--;
    set({ openTabs: newTabs, activeTabIndex: newActive });
  },

  setActiveTab: (index) => set({ activeTabIndex: index }),

  updateTabContent: (index, content) => {
    const tabs = [...get().openTabs];
    if (tabs[index]) {
      tabs[index] = { ...tabs[index], content };
      set({ openTabs: tabs });
    }
  },

  markTabDirty: (index, dirty) => {
    const tabs = [...get().openTabs];
    if (tabs[index]) {
      tabs[index] = { ...tabs[index], isDirty: dirty };
      set({ openTabs: tabs });
    }
  },

  saveTabViewState: (index, viewState) => {
    const tabs = [...get().openTabs];
    if (tabs[index]) {
      tabs[index] = { ...tabs[index], viewState };
      set({ openTabs: tabs });
    }
  },

  // Layout
  sidebarWidth: 256,
  chatWidth: 320,
  terminalHeight: 192,
  sidebarVisible: true,
  terminalVisible: true,
  chatVisible: true,
  setSidebarWidth: (w) => set({ sidebarWidth: Math.max(140, Math.min(800, w)) }),
  setChatWidth: (w) => set({ chatWidth: Math.max(250, Math.min(1200, w)) }),
  setTerminalHeight: (h) => set({ terminalHeight: Math.max(80, Math.min(600, h)) }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  toggleChat: () => set((s) => ({ chatVisible: !s.chatVisible })),

  // UI State
  isQuickOpenOpen: false,
  isCommandPaletteOpen: false,
  setQuickOpen: (open) => set({ isQuickOpenOpen: open }),
  setCommandPalette: (open) => set({ isCommandPaletteOpen: open })
}));
