import type { LucideIcon } from 'lucide-react';
import {
  Palette,
  Music,
  Image,
  Type,
  Plus,
  Minus,
  RotateCcw,
  Play,
  Square,
  Save,
  Share,
  Wand2,
  Sparkles,
  Volume2,
  Move,
  Maximize,
  Layers,
  Smile
} from 'lucide-react';

export interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  prompt: string;
  category: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  // Visual
  { id: 'change-colors', label: 'Change Colors', icon: Palette, color: 'text-[var(--accent-secondary)]', prompt: 'Can you change the colors to be more', category: 'visual' },
  { id: 'add-image', label: 'Add Picture', icon: Image, color: 'text-[var(--info)]', prompt: 'Can you add a picture of', category: 'visual' },
  { id: 'change-text', label: 'Change Text', icon: Type, color: 'text-[var(--accent-primary)]', prompt: 'Can you change the text to say', category: 'visual' },
  { id: 'add-emoji', label: 'Add Emoji', icon: Smile, color: 'text-[var(--warning)]', prompt: 'Can you add some emojis for', category: 'visual' },

  // Layout
  { id: 'make-bigger', label: 'Make Bigger', icon: Plus, color: 'text-[var(--success)]', prompt: 'Can you make it bigger?', category: 'layout' },
  { id: 'make-smaller', label: 'Make Smaller', icon: Minus, color: 'text-[var(--warning)]', prompt: 'Can you make it smaller?', category: 'layout' },
  { id: 'move-around', label: 'Move It', icon: Move, color: 'text-cyan-400', prompt: 'Can you move it to the', category: 'layout' },
  { id: 'full-screen', label: 'Full Screen', icon: Maximize, color: 'text-indigo-400', prompt: 'Can you make it full screen?', category: 'layout' },

  // Sound
  { id: 'add-sound', label: 'Add Sound', icon: Music, color: 'text-[var(--success)]', prompt: 'Can you add a sound when', category: 'sound' },
  { id: 'add-music', label: 'Add Music', icon: Volume2, color: 'text-[var(--accent-primary)]', prompt: 'Can you add background music?', category: 'sound' },

  // Features
  { id: 'add-button', label: 'Add Button', icon: Plus, color: 'text-[var(--info)]', prompt: 'Can you add a button that', category: 'feature' },
  { id: 'add-animation', label: 'Add Animation', icon: Wand2, color: 'text-[var(--accent-secondary)]', prompt: 'Can you add an animation to', category: 'feature' },
  { id: 'add-score', label: 'Add Score', icon: Layers, color: 'text-[var(--warning)]', prompt: 'Can you add a score counter?', category: 'feature' },
  { id: 'add-magic', label: 'Surprise Me!', icon: Sparkles, color: 'text-[var(--accent-primary)]', prompt: 'Can you add something cool and surprising?', category: 'feature' },

  // Controls
  { id: 'play', label: 'Play', icon: Play, color: 'text-[var(--success)]', prompt: 'Run my project', category: 'control' },
  { id: 'stop', label: 'Stop', icon: Square, color: 'text-[var(--error)]', prompt: 'Stop running', category: 'control' },
  { id: 'reset', label: 'Start Over', icon: RotateCcw, color: 'text-[var(--warning)]', prompt: 'Can you reset everything back to the beginning?', category: 'control' },
  { id: 'save', label: 'Save', icon: Save, color: 'text-[var(--info)]', prompt: 'Save my project', category: 'control' },
  { id: 'share', label: 'Share', icon: Share, color: 'text-[var(--accent-primary)]', prompt: 'How can I share this?', category: 'control' }
];

interface QuickActionsProps {
  onAction: (action: QuickAction) => void;
  categories?: string[];
  variant?: 'bar' | 'grid' | 'floating';
}

export default function QuickActions({
  onAction,
  categories = ['visual', 'feature', 'sound'],
  variant = 'bar'
}: QuickActionsProps) {
  const filteredActions = QUICK_ACTIONS.filter(a => categories.includes(a.category));

  if (variant === 'grid') {
    return (
      <div className="grid grid-cols-4 gap-3 p-4">
        {filteredActions.map((action) => (
          <QuickActionButton
            key={action.id}
            action={action}
            onClick={() => onAction(action)}
            variant="large"
          />
        ))}
      </div>
    );
  }

  if (variant === 'floating') {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-full px-4 py-2 shadow-xl">
        {filteredActions.slice(0, 6).map((action) => (
          <QuickActionButton
            key={action.id}
            action={action}
            onClick={() => onAction(action)}
            variant="icon-only"
          />
        ))}
      </div>
    );
  }

  // Default: horizontal bar
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] overflow-x-auto">
      {filteredActions.map((action) => (
        <QuickActionButton
          key={action.id}
          action={action}
          onClick={() => onAction(action)}
          variant="compact"
        />
      ))}
    </div>
  );
}

interface QuickActionButtonProps {
  action: QuickAction;
  onClick: () => void;
  variant: 'compact' | 'large' | 'icon-only';
}

function QuickActionButton({ action, onClick, variant }: QuickActionButtonProps) {
  const Icon = action.icon;

  if (variant === 'icon-only') {
    return (
      <button
        onClick={onClick}
        className={`p-3 rounded-full hover:bg-[var(--bg-tertiary)] transition-colors ${action.color}`}
        title={action.label}
      >
        <Icon size={20} />
      </button>
    );
  }

  if (variant === 'large') {
    return (
      <button
        onClick={onClick}
        className="flex flex-col items-center gap-2 p-4 bg-[var(--bg-tertiary)] rounded-xl hover:bg-[var(--bg-hover)] transition-all hover:scale-105"
      >
        <div className={`w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center ${action.color}`}>
          <Icon size={24} />
        </div>
        <span className="text-sm text-white font-medium">{action.label}</span>
      </button>
    );
  }

  // Compact
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] rounded-full hover:bg-[var(--bg-hover)] transition-colors whitespace-nowrap ${action.color}`}
    >
      <Icon size={16} />
      <span className="text-sm text-white">{action.label}</span>
    </button>
  );
}

// Category-based quick action panel
interface QuickActionPanelProps {
  onAction: (action: QuickAction) => void;
}

export function QuickActionPanel({ onAction }: QuickActionPanelProps) {
  const categories = [
    { id: 'visual', label: 'Look & Feel', actions: QUICK_ACTIONS.filter(a => a.category === 'visual') },
    { id: 'layout', label: 'Size & Position', actions: QUICK_ACTIONS.filter(a => a.category === 'layout') },
    { id: 'sound', label: 'Sound & Music', actions: QUICK_ACTIONS.filter(a => a.category === 'sound') },
    { id: 'feature', label: 'Add Features', actions: QUICK_ACTIONS.filter(a => a.category === 'feature') }
  ];

  return (
    <div className="bg-[var(--bg-secondary)] rounded-xl p-4 space-y-4">
      {categories.map((category) => (
        <div key={category.id}>
          <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
            {category.label}
          </h3>
          <div className="flex flex-wrap gap-2">
            {category.actions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  onClick={() => onAction(action)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-sm ${action.color}`}
                >
                  <Icon size={14} />
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export { QUICK_ACTIONS };
