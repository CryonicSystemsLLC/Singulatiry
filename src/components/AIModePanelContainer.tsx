import React from 'react';
import { Bot, Plus, X } from 'lucide-react';
import SidebarExtensionView from './SidebarExtensionView';
import { useSettingsStore } from '../stores/settingsStore';

interface AIModePanelContainerProps {
  panels: string[];
  onOpenSettings: () => void;
}

const EmptyPanelSlot: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center h-full bg-[var(--bg-primary)]/50">
    <Bot size={36} className="text-[var(--text-muted)] opacity-20 mb-3" />
    <p className="text-sm text-[var(--text-muted)]">Empty Panel</p>
    <p className="text-xs text-[var(--text-dim)] mt-1">Click an extension in the activity bar</p>
  </div>
);

const AIModePanelContainer: React.FC<AIModePanelContainerProps> = ({ panels }) => {
  const setAiModePanels = useSettingsStore(s => s.setAiModePanels);

  const closePanel = (index: number) => {
    const updated = panels.filter((_, i) => i !== index);
    setAiModePanels(updated);
  };

  const addPanel = () => {
    setAiModePanels([...panels, '']);
  };

  return (
    <div className="flex-1 flex h-full min-w-0 bg-[var(--bg-primary)]/50">
      {panels.map((extId, index) => (
        <React.Fragment key={`${index}-${extId || 'empty'}`}>
          {index > 0 && (
            <div className="w-px shrink-0 bg-[var(--border-primary)]" />
          )}
          <div className="flex-1 h-full min-w-0 flex flex-col relative group/panel">
            {/* Close button — visible on hover when more than 1 panel */}
            {panels.length > 1 && (
              <button
                onClick={() => closePanel(index)}
                className="absolute top-1.5 right-1.5 z-20 p-1 rounded bg-[var(--bg-secondary)]/90 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-all opacity-0 group-hover/panel:opacity-100"
                title="Close panel"
              >
                <X size={14} />
              </button>
            )}
            <div className="flex-1 min-h-0">
              {extId ? (
                <SidebarExtensionView extensionId={extId} />
              ) : (
                <EmptyPanelSlot />
              )}
            </div>
          </div>
        </React.Fragment>
      ))}

      {/* Add panel button — thin strip on the right edge */}
      <button
        onClick={addPanel}
        className="w-8 shrink-0 flex items-center justify-center border-l border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        title="Add panel"
      >
        <Plus size={16} />
      </button>
    </div>
  );
};

export default AIModePanelContainer;
