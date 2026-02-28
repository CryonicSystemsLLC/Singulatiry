import React from 'react';
import { X, FileCode, Atom, Puzzle, PanelLeft, PanelBottom, PanelRight } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

const TabBar: React.FC = () => {
  const {
    openTabs, activeTabIndex, setActiveTab, closeTab,
    sidebarVisible, terminalVisible, chatVisible,
    toggleSidebar, toggleTerminal, toggleChat,
  } = useAppStore();

  const toggleButtons = (
    <div className="flex items-center gap-0.5 px-2 ml-auto shrink-0">
      <button
        onClick={toggleSidebar}
        className={`p-1.5 rounded transition-colors ${
          sidebarVisible
            ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] opacity-50'
        }`}
        title={`Toggle Sidebar (Ctrl+B)`}
      >
        <PanelLeft size={15} />
      </button>
      <button
        onClick={toggleTerminal}
        className={`p-1.5 rounded transition-colors ${
          terminalVisible
            ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] opacity-50'
        }`}
        title={`Toggle Terminal (Ctrl+J)`}
      >
        <PanelBottom size={15} />
      </button>
      <button
        onClick={toggleChat}
        className={`p-1.5 rounded transition-colors ${
          chatVisible
            ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] opacity-50'
        }`}
        title={`Toggle AI Chat (Ctrl+Shift+L)`}
      >
        <PanelRight size={15} />
      </button>
    </div>
  );

  if (openTabs.length === 0) {
    return (
      <div className="h-10 border-b border-[var(--border-secondary)] flex items-center px-4 text-sm text-[var(--text-muted)] shrink-0 bg-[var(--bg-primary)]/50">
        <span className="text-xs">No files open</span>
        {toggleButtons}
      </div>
    );
  }

  return (
    <div className="h-10 border-b border-[var(--border-secondary)] flex items-center shrink-0 bg-[var(--bg-primary)]/50">
      <div className="flex items-center overflow-x-auto min-w-0">
        {openTabs.map((tab, index) => (
          <div
            key={tab.path}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-[var(--border-secondary)] min-w-0 group ${
              index === activeTabIndex
                ? 'bg-[var(--bg-tertiary)]/50 text-[var(--text-secondary)] border-t-2 border-t-[var(--accent-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] border-t-2 border-t-transparent'
            }`}
            onClick={() => setActiveTab(index)}
          >
            {tab.isWelcome
              ? <Atom size={14} className="shrink-0 text-[#41D1FF]" />
              : tab.path?.startsWith('ext://')
              ? <Puzzle size={14} className="shrink-0 text-[var(--accent-primary)]" />
              : <FileCode size={14} className="shrink-0 text-[var(--text-muted)]" />
            }
            <span className="truncate max-w-[120px]">
              {!tab.isWelcome && tab.isDirty && <span className="text-[var(--warning)] mr-0.5">*</span>}
              {tab.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(index);
              }}
              className="ml-1 p-0.5 rounded hover:bg-[var(--bg-hover)] opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {toggleButtons}
    </div>
  );
};

export default React.memo(TabBar);
