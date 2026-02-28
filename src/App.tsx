import { useCallback, useRef, useEffect, useMemo } from 'react';
import CodeEditor, { CodeEditorRef } from './components/CodeEditor';
import WelcomeTab from './components/WelcomeTab';
import Sidebar from './components/Sidebar';
import ActivityBar, { SidebarView } from './components/ActivityBar';
import TerminalPane from './components/TerminalPane';
import AIChatPane from './components/AIChatPane';
import QuickOpen from './components/QuickOpen';
import TabBar from './components/TabBar';
import ResizeHandle from './components/ResizeHandle';
import CommandPalette, { Command } from './components/CommandPalette';
import SettingsModal from './components/SettingsModal';
import { useAppStore } from './stores/appStore';
import { useSettingsStore } from './stores/settingsStore';
import { useRemoteStore } from './stores/remoteStore';
import { keybindingRegistry } from './services/keybindings';
import { shortcutLabel, modKey } from './utils/platform';
import RemotePathDialog from './components/RemotePathDialog';
import NotificationToast from './components/NotificationToast';
import {
  FileCode, Terminal, Sidebar as SidebarIcon, MessageSquare,
  FolderOpen, Save, Search, Palette, RotateCcw, Settings
} from 'lucide-react';
import React from 'react';

function App() {
  const editorRef = useRef<CodeEditorRef>(null);
  const theme = useSettingsStore(s => s.theme);

  // Apply data-theme on mount and when theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Zustand store
  const {
    projectRoot, setProjectRoot, projectFiles, setProjectFiles,
    openTabs, activeTabIndex, openFile, closeTab,
    markTabDirty,
    sidebarWidth, chatWidth, terminalHeight,
    setSidebarWidth, setChatWidth, setTerminalHeight,
    sidebarVisible, terminalVisible, chatVisible,
    toggleSidebar, toggleTerminal, toggleChat,
    isQuickOpenOpen, isCommandPaletteOpen,
    setQuickOpen, setCommandPalette
  } = useAppStore();

  // Remote connection state
  const remoteConnectionState = useRemoteStore(s => s.connectionState);
  const remoteActive = remoteConnectionState?.status === 'connected';

  // Active tab
  const activeTab = openTabs[activeTabIndex] || null;
  const getActiveContent = useCallback(() => {
    if (editorRef.current) return editorRef.current.getValue();
    return activeTab?.content || '';
  }, [activeTab]);

  // File selection from explorer
  const handleFileSelect = useCallback((path: string, content: string) => {
    const filename = path.split(/[\\/]/).pop() || 'Untitled';
    openFile(path, filename, content);
  }, [openFile]);

  // File save
  const handleFileSave = useCallback(async (content: string) => {
    if (activeTab?.path) {
      try {
        await window.ipcRenderer.invoke('fs:writeFile', activeTab.path, content);
        markTabDirty(activeTabIndex, false);
      } catch (e) {
        console.error('Failed to save', e);
      }
    }
  }, [activeTab, activeTabIndex, markTabDirty]);

  // Apply code from AI
  const handleApplyCode = useCallback((newCode: string) => {
    if (editorRef.current) {
      editorRef.current.setValue(newCode);
    }
  }, []);

  // Active view state for sidebar
  const [activeView, setActiveView] = React.useState<SidebarView>('explorer');

  // Settings modal
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  // Remote path dialog (replaces native OS dialog in SSH mode)
  const [remotePathDialogOpen, setRemotePathDialogOpen] = React.useState(false);

  const openFolderAction = useCallback(async () => {
    if (remoteActive) {
      setRemotePathDialogOpen(true);
    } else {
      const path = await window.ipcRenderer.invoke('dialog:openDirectory');
      if (path) setProjectRoot(path);
    }
  }, [remoteActive, setProjectRoot]);

  // Commands for Command Palette
  const commands = useMemo<Command[]>(() => [
    {
      id: 'file.open',
      label: 'Open Folder',
      shortcut: shortcutLabel('Ctrl+O'),
      category: 'File',
      icon: <FolderOpen size={14} />,
      action: openFolderAction
    },
    {
      id: 'file.quickOpen',
      label: 'Go to File',
      shortcut: shortcutLabel('Ctrl+P'),
      category: 'File',
      icon: <FileCode size={14} />,
      action: () => setQuickOpen(true)
    },
    {
      id: 'file.save',
      label: 'Save File',
      shortcut: shortcutLabel('Ctrl+S'),
      category: 'File',
      icon: <Save size={14} />,
      action: () => {
        if (editorRef.current && activeTab) {
          handleFileSave(editorRef.current.getValue());
        }
      }
    },
    {
      id: 'view.sidebar',
      label: 'Toggle Sidebar',
      shortcut: shortcutLabel('Ctrl+B'),
      category: 'View',
      icon: <SidebarIcon size={14} />,
      action: toggleSidebar
    },
    {
      id: 'view.terminal',
      label: 'Toggle Terminal',
      shortcut: shortcutLabel('Ctrl+J'),
      category: 'View',
      icon: <Terminal size={14} />,
      action: toggleTerminal
    },
    {
      id: 'view.chat',
      label: 'Toggle AI Chat',
      shortcut: shortcutLabel('Ctrl+Shift+L'),
      category: 'View',
      icon: <MessageSquare size={14} />,
      action: toggleChat
    },
    {
      id: 'view.commandPalette',
      label: 'Command Palette',
      shortcut: shortcutLabel('Ctrl+Shift+P'),
      category: 'View',
      icon: <Palette size={14} />,
      action: () => setCommandPalette(true)
    },
    {
      id: 'view.explorer',
      label: 'Show Explorer',
      category: 'View',
      icon: <FolderOpen size={14} />,
      action: () => setActiveView('explorer')
    },
    {
      id: 'view.search',
      label: 'Show Search',
      category: 'View',
      icon: <Search size={14} />,
      action: () => setActiveView('search')
    },
    {
      id: 'editor.closeTab',
      label: 'Close Tab',
      shortcut: shortcutLabel('Ctrl+W'),
      category: 'Editor',
      icon: <FileCode size={14} />,
      action: () => { if (activeTabIndex >= 0) closeTab(activeTabIndex); }
    },
    {
      id: 'preferences.settings',
      label: 'Settings',
      shortcut: shortcutLabel('Ctrl+,'),
      category: 'Preferences',
      icon: <Settings size={14} />,
      action: () => setSettingsOpen(true)
    },
    {
      id: 'view.reload',
      label: 'Reload Window',
      category: 'Developer',
      icon: <RotateCcw size={14} />,
      action: () => window.location.reload()
    }
  ], [activeTab, activeTabIndex, handleFileSave, toggleSidebar, toggleTerminal, toggleChat, setQuickOpen, setCommandPalette, openFolderAction, closeTab]);

  // Register keybindings
  useEffect(() => {
    keybindingRegistry.register({ id: 'cmd-palette', key: 'ctrl+shift+p', action: () => setCommandPalette(true) });
    keybindingRegistry.register({ id: 'quick-open', key: 'ctrl+p', action: () => {
      setQuickOpen(true);
      if (projectRoot) {
        window.ipcRenderer.invoke('fs:listAllFiles', projectRoot).then(setProjectFiles).catch(console.error);
      }
    }});
    keybindingRegistry.register({ id: 'toggle-sidebar', key: 'ctrl+b', action: toggleSidebar });
    keybindingRegistry.register({ id: 'toggle-terminal', key: 'ctrl+j', action: toggleTerminal });
    keybindingRegistry.register({ id: 'toggle-chat', key: 'ctrl+shift+l', action: toggleChat });
    keybindingRegistry.register({ id: 'close-tab', key: 'ctrl+w', action: () => {
      const idx = useAppStore.getState().activeTabIndex;
      if (idx >= 0) closeTab(idx);
    }});
    keybindingRegistry.register({ id: 'open-settings', key: 'ctrl+,', action: () => setSettingsOpen(true) });

    keybindingRegistry.startListening();
    return () => keybindingRegistry.stopListening();
  }, [projectRoot, setProjectFiles, setQuickOpen, setCommandPalette, toggleSidebar, toggleTerminal, toggleChat, closeTab]);

  // Menu event listeners
  useEffect(() => {
    const handleGoToFile = () => {
      setQuickOpen(true);
      if (projectRoot) {
        window.ipcRenderer.invoke('fs:listAllFiles', projectRoot).then(setProjectFiles).catch(console.error);
      }
    };
    const handleStartDebugging = () => setActiveView('debug');
    const handleOpenFolder = () => openFolderAction();
    const handleNewFile = () => {
      openFile('untitled', 'Untitled', '');
    };
    const handleSettings = () => setSettingsOpen(true);

    window.ipcRenderer.on('menu:go-to-file', handleGoToFile);
    window.ipcRenderer.on('menu:start-debugging', handleStartDebugging);
    window.ipcRenderer.on('menu:open-folder', handleOpenFolder);
    window.ipcRenderer.on('menu:new-file', handleNewFile);
    window.ipcRenderer.on('menu:settings', handleSettings);

    return () => {
      window.ipcRenderer.removeListener('menu:go-to-file', handleGoToFile);
      window.ipcRenderer.removeListener('menu:start-debugging', handleStartDebugging);
      window.ipcRenderer.removeListener('menu:open-folder', handleOpenFolder);
      window.ipcRenderer.removeListener('menu:new-file', handleNewFile);
      window.ipcRenderer.removeListener('menu:settings', handleSettings);
    };
  }, [projectRoot, setProjectFiles, setQuickOpen, openFile, openFolderAction]);

  // Restore session on mount
  useEffect(() => {
    (async () => {
      try {
        if ((window as any).persistence) {
          const session = await (window as any).persistence.getSession();
          if (session?.lastProjectRoot) {
            setProjectRoot(session.lastProjectRoot);
          }
        }
      } catch { /* first launch */ }
    })();
  }, [setProjectRoot]);

  // Save session on change
  useEffect(() => {
    if ((window as any).persistence && projectRoot) {
      (window as any).persistence.saveSession({
        lastProjectRoot: projectRoot,
        sidebarWidth,
        chatWidth,
        terminalHeight
      });
    }
  }, [projectRoot, sidebarWidth, chatWidth, terminalHeight]);

  // Load MCP config when project root changes
  useEffect(() => {
    if (projectRoot && (window as any).mcp?.loadConfig) {
      (window as any).mcp.loadConfig(projectRoot).catch((err: any) => {
        console.error('MCP config load failed:', err);
      });
    }
  }, [projectRoot]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      <div className="flex flex-1 min-h-0">
      {/* Activity Bar */}
      <ActivityBar
        activeView={activeView}
        onViewChange={setActiveView}
      />

      {/* Sidebar */}
      {sidebarVisible && (
        <>
          <div style={{ width: sidebarWidth }} className="h-full shrink-0">
            <Sidebar
              activeView={activeView}
              onFileSelect={handleFileSelect}
              rootPath={projectRoot}
              onRootChange={setProjectRoot}
            />
          </div>
          <ResizeHandle direction="horizontal" onResize={(d) => setSidebarWidth(useAppStore.getState().sidebarWidth + d)} />
        </>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-[var(--bg-primary)]/50">
        {/* Tab Bar */}
        <TabBar />

        {/* Editor Area */}
        <div className="flex-1 relative min-h-0">
          {activeTab?.isWelcome ? (
            <WelcomeTab />
          ) : activeTab ? (
            <CodeEditor
              ref={editorRef}
              initialValue={activeTab.content}
              language={activeTab.language}
              onChange={() => {
                if (activeTabIndex >= 0) {
                  markTabDirty(activeTabIndex, true);
                }
              }}
              onSave={handleFileSave}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
              <div className="text-center">
                <FileCode size={48} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg">Open a file to get started</p>
                <p className="text-sm mt-2 text-[var(--text-dim)]">{modKey}+P to open a file, {modKey}+O to open a folder</p>
              </div>
            </div>
          )}
        </div>

        {/* Terminal Resize Handle + Terminal */}
        {terminalVisible && (
          <>
            <ResizeHandle direction="vertical" onResize={(d) => setTerminalHeight(useAppStore.getState().terminalHeight - d)} />
            <div style={{ height: terminalHeight }} className="border-t border-[var(--border-secondary)] shrink-0">
              <TerminalPane />
            </div>
          </>
        )}
      </div>

      {/* Chat Resize Handle + AI Chat Pane */}
      {chatVisible && (
        <>
          <ResizeHandle direction="horizontal" onResize={(d) => setChatWidth(useAppStore.getState().chatWidth - d)} />
          <div style={{ width: chatWidth }} className="h-full border-l border-[var(--border-primary)] shrink-0">
            <AIChatPane
              getActiveFileContent={getActiveContent}
              activeFilePath={activeTab?.path}
              onApplyCode={handleApplyCode}
              projectRoot={projectRoot}
            />
          </div>
        </>
      )}

      {/* Quick Open Modal */}
      <QuickOpen
        isOpen={isQuickOpenOpen}
        onClose={() => setQuickOpen(false)}
        files={projectFiles}
        onSelect={async (path) => {
          try {
            const content = await window.ipcRenderer.invoke('fs:readFile', path);
            handleFileSelect(path, content);
          } catch (e) { console.error(e); }
        }}
        projectRoot={projectRoot}
      />

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setCommandPalette(false)}
        commands={commands}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      </div>

      {/* Remote Path Dialog (replaces OS file picker in SSH mode) */}
      <RemotePathDialog
        isOpen={remotePathDialogOpen}
        onClose={() => setRemotePathDialogOpen(false)}
        onConfirm={(path) => setProjectRoot(path)}
        defaultPath={remoteConnectionState?.config?.defaultDirectory || projectRoot || ''}
      />

      {/* Status Bar */}
      {remoteActive && remoteConnectionState && (
        <div className="h-6 shrink-0 flex items-center px-3 bg-[#007acc] text-white text-[11px] gap-3 select-none">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
            SSH: {remoteConnectionState.config.username}@{remoteConnectionState.config.host}
          </span>
          {remoteConnectionState.remoteOS && (
            <span className="text-white/70">{remoteConnectionState.remoteOS}</span>
          )}
        </div>
      )}

      {/* Extension notification toasts */}
      <NotificationToast />
    </div>
  );
}

export default App;
