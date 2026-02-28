import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Gamepad2,
  BookOpen,
  Palette,
  Music,
  Calculator,
  ChevronRight,
  Star,
  Sparkles
} from 'lucide-react';

interface Preset {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string;
  variants: PresetVariant[];
}

interface PresetVariant {
  id: string;
  name: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  features: string[];
}

const PRESETS: Preset[] = [
  {
    id: 'game',
    name: 'Games',
    description: 'Create fun interactive games',
    icon: Gamepad2,
    color: 'from-purple-500 to-pink-500',
    variants: [
      {
        id: 'quiz',
        name: 'Quiz Game',
        description: 'Make a trivia game with questions and answers',
        difficulty: 'easy',
        features: ['Questions', 'Score counter', 'Multiple choice']
      },
      {
        id: 'memory',
        name: 'Memory Match',
        description: 'Match pairs of cards to win',
        difficulty: 'medium',
        features: ['Card flipping', 'Timer', 'High scores']
      },
      {
        id: 'clicker',
        name: 'Clicker Game',
        description: 'Click to earn points and unlock upgrades',
        difficulty: 'easy',
        features: ['Click counter', 'Upgrades', 'Achievements']
      },
      {
        id: 'platformer',
        name: 'Platformer',
        description: 'Jump and run through levels',
        difficulty: 'hard',
        features: ['Movement', 'Jumping', 'Obstacles', 'Levels']
      }
    ]
  },
  {
    id: 'story',
    name: 'Stories',
    description: 'Build interactive tales',
    icon: BookOpen,
    color: 'from-blue-500 to-cyan-500',
    variants: [
      {
        id: 'adventure',
        name: 'Choose Your Adventure',
        description: 'Make choices that change the story',
        difficulty: 'easy',
        features: ['Story text', 'Choice buttons', 'Multiple endings']
      },
      {
        id: 'storybook',
        name: 'Digital Storybook',
        description: 'Create a picture book with pages',
        difficulty: 'easy',
        features: ['Pages', 'Images', 'Text', 'Page turning']
      },
      {
        id: 'comic',
        name: 'Comic Creator',
        description: 'Make comics with panels and speech bubbles',
        difficulty: 'medium',
        features: ['Panels', 'Speech bubbles', 'Characters']
      }
    ]
  },
  {
    id: 'art',
    name: 'Art & Drawing',
    description: 'Create visual projects',
    icon: Palette,
    color: 'from-orange-500 to-yellow-500',
    variants: [
      {
        id: 'drawing',
        name: 'Drawing App',
        description: 'A simple canvas to draw on',
        difficulty: 'easy',
        features: ['Brush tool', 'Colors', 'Clear button']
      },
      {
        id: 'coloring',
        name: 'Coloring Book',
        description: 'Fill in shapes with colors',
        difficulty: 'easy',
        features: ['Shapes', 'Color picker', 'Fill tool']
      },
      {
        id: 'animation',
        name: 'Animation Maker',
        description: 'Create simple animations',
        difficulty: 'hard',
        features: ['Frames', 'Timeline', 'Playback']
      }
    ]
  },
  {
    id: 'music',
    name: 'Music & Sound',
    description: 'Make musical creations',
    icon: Music,
    color: 'from-green-500 to-emerald-500',
    variants: [
      {
        id: 'drumpad',
        name: 'Drum Pad',
        description: 'Tap pads to make beats',
        difficulty: 'easy',
        features: ['Sound pads', 'Different sounds', 'Recording']
      },
      {
        id: 'piano',
        name: 'Piano',
        description: 'Play piano notes on a keyboard',
        difficulty: 'easy',
        features: ['Piano keys', 'Notes', 'Octaves']
      },
      {
        id: 'soundboard',
        name: 'Sound Board',
        description: 'Create a board of fun sounds',
        difficulty: 'easy',
        features: ['Sound buttons', 'Categories', 'Custom sounds']
      }
    ]
  },
  {
    id: 'tools',
    name: 'Useful Tools',
    description: 'Build helpful utilities',
    icon: Calculator,
    color: 'from-red-500 to-rose-500',
    variants: [
      {
        id: 'calculator',
        name: 'Calculator',
        description: 'A simple math calculator',
        difficulty: 'easy',
        features: ['Numbers', 'Operations', 'Display']
      },
      {
        id: 'todo',
        name: 'To-Do List',
        description: 'Keep track of tasks',
        difficulty: 'easy',
        features: ['Add tasks', 'Check off', 'Delete']
      },
      {
        id: 'timer',
        name: 'Timer',
        description: 'Count up or count down',
        difficulty: 'easy',
        features: ['Countdown', 'Stopwatch', 'Alerts']
      }
    ]
  }
];

interface PresetPickerProps {
  onSelectVariant: (presetId: string, variantId: string) => void;
  onBack: () => void;
}

export default function PresetPicker({ onSelectVariant, onBack }: PresetPickerProps) {
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);

  if (selectedPreset) {
    return (
      <VariantPicker
        preset={selectedPreset}
        onSelect={(variantId) => onSelectVariant(selectedPreset.id, variantId)}
        onBack={() => setSelectedPreset(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a2e] to-[#16162a] p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <button
          onClick={onBack}
          className="absolute top-6 left-6 text-[var(--text-muted)] hover:text-white"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white mb-2">
          Choose a Category
        </h1>
        <p className="text-[var(--text-muted)]">
          What kind of project do you want to make?
        </p>
      </div>

      {/* Preset Grid */}
      <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PRESETS.map((preset) => {
          const Icon = preset.icon;
          return (
            <button
              key={preset.id}
              onClick={() => setSelectedPreset(preset)}
              className="group relative overflow-hidden rounded-2xl bg-[var(--bg-tertiary)] p-6 text-left transition-all hover:scale-105 hover:shadow-xl"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${preset.color} opacity-0 group-hover:opacity-20 transition-opacity`} />

              <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${preset.color} flex items-center justify-center mb-4`}>
                <Icon size={32} className="text-white" />
              </div>

              <h3 className="text-xl font-bold text-white mb-1">{preset.name}</h3>
              <p className="text-[var(--text-muted)] mb-3">{preset.description}</p>

              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">
                  {preset.variants.length} templates
                </span>
                <ChevronRight size={20} className="text-[var(--text-muted)] group-hover:text-white transition-colors" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface VariantPickerProps {
  preset: Preset;
  onSelect: (variantId: string) => void;
  onBack: () => void;
}

function VariantPicker({ preset, onSelect, onBack }: VariantPickerProps) {
  const Icon = preset.icon;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a2e] to-[#16162a] p-6">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[var(--text-muted)] hover:text-white mb-4"
        >
          ← Back to categories
        </button>
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${preset.color} flex items-center justify-center`}>
            <Icon size={32} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">{preset.name}</h1>
            <p className="text-[var(--text-muted)]">{preset.description}</p>
          </div>
        </div>
      </div>

      {/* Variant Grid */}
      <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
        {preset.variants.map((variant) => (
          <button
            key={variant.id}
            onClick={() => onSelect(variant.id)}
            className="group bg-[var(--bg-tertiary)] rounded-2xl p-6 text-left hover:bg-[var(--bg-hover)] transition-all"
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-xl font-bold text-white">{variant.name}</h3>
              <DifficultyBadge difficulty={variant.difficulty} />
            </div>

            <p className="text-[var(--text-muted)] mb-4">{variant.description}</p>

            <div className="flex flex-wrap gap-2">
              {variant.features.map((feature, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-1 bg-[var(--bg-secondary)] text-[var(--text-muted)] rounded-full"
                >
                  {feature}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2 text-[var(--accent-primary)] opacity-0 group-hover:opacity-100 transition-opacity">
              <Sparkles size={16} />
              <span className="text-sm font-medium">Start building</span>
              <ChevronRight size={16} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: 'easy' | 'medium' | 'hard' }) {
  const config = {
    easy: { label: 'Easy', color: 'bg-[var(--success)]/20 text-[var(--success)]', stars: 1 },
    medium: { label: 'Medium', color: 'bg-[var(--warning)]/20 text-[var(--warning)]', stars: 2 },
    hard: { label: 'Hard', color: 'bg-[var(--error)]/20 text-[var(--error)]', stars: 3 }
  };

  const { label, color, stars } = config[difficulty];

  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${color}`}>
      {Array(stars).fill(0).map((_, i) => (
        <Star key={i} size={10} fill="currentColor" />
      ))}
      <span className="ml-1">{label}</span>
    </div>
  );
}
