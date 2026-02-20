import {
  Gamepad2,
  BookOpen,
  Palette,
  Music,
  Calculator,
  Clock,
  MessageSquare,
  Sparkles,
  Rocket
} from 'lucide-react';

interface KidModeHomeProps {
  onSelectPreset: (presetId: string) => void;
  onOpenChat: () => void;
  recentProjects?: Array<{
    id: string;
    name: string;
    type: string;
    lastOpened: Date;
  }>;
}

const PRESETS = [
  {
    id: 'game',
    name: 'Make a Game',
    description: 'Create fun games with scores and levels',
    icon: Gamepad2,
    color: 'from-purple-500 to-pink-500',
    examples: ['Quiz game', 'Memory match', 'Whack-a-mole']
  },
  {
    id: 'story',
    name: 'Story Maker',
    description: 'Build interactive stories with choices',
    icon: BookOpen,
    color: 'from-blue-500 to-cyan-500',
    examples: ['Choose your adventure', 'Digital storybook', 'Comic creator']
  },
  {
    id: 'art',
    name: 'Art Studio',
    description: 'Create colorful art and animations',
    icon: Palette,
    color: 'from-orange-500 to-yellow-500',
    examples: ['Drawing app', 'Color picker', 'Animation tool']
  },
  {
    id: 'music',
    name: 'Music Maker',
    description: 'Make beats and melodies',
    icon: Music,
    color: 'from-green-500 to-emerald-500',
    examples: ['Drum machine', 'Piano app', 'Sound board']
  },
  {
    id: 'calculator',
    name: 'Math Helper',
    description: 'Fun math tools and calculators',
    icon: Calculator,
    color: 'from-red-500 to-rose-500',
    examples: ['Calculator', 'Times tables', 'Math quiz']
  },
  {
    id: 'timer',
    name: 'Time Tools',
    description: 'Timers, clocks, and countdowns',
    icon: Clock,
    color: 'from-indigo-500 to-purple-500',
    examples: ['Stopwatch', 'Countdown', 'Pomodoro timer']
  }
];

export default function KidModeHome({
  onSelectPreset,
  onOpenChat,
  recentProjects = []
}: KidModeHomeProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a2e] to-[#16162a] p-6 overflow-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-3 mb-4">
          <Rocket className="w-10 h-10 text-purple-400" />
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 text-transparent bg-clip-text">
            What do you want to create?
          </h1>
        </div>
        <p className="text-gray-400 text-lg">
          Pick a project type or tell me your idea!
        </p>
      </div>

      {/* AI Chat Button */}
      <button
        onClick={onOpenChat}
        className="w-full max-w-2xl mx-auto mb-8 p-6 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl shadow-lg hover:shadow-purple-500/25 transition-all hover:scale-[1.02] group"
      >
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-white/10 rounded-xl flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1 text-left">
            <h2 className="text-xl font-bold text-white mb-1">
              Tell me what you want to build!
            </h2>
            <p className="text-white/70">
              Describe your idea and I'll help you create it
            </p>
          </div>
          <Sparkles className="w-8 h-8 text-yellow-300 group-hover:animate-pulse" />
        </div>
      </button>

      {/* Preset Grid */}
      <div className="max-w-4xl mx-auto">
        <h2 className="text-lg font-medium text-gray-400 mb-4 flex items-center gap-2">
          <Sparkles size={18} className="text-yellow-400" />
          Or pick a project type
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {PRESETS.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              onClick={() => onSelectPreset(preset.id)}
            />
          ))}
        </div>
      </div>

      {/* Recent Projects */}
      {recentProjects.length > 0 && (
        <div className="max-w-4xl mx-auto mt-12">
          <h2 className="text-lg font-medium text-gray-400 mb-4">
            Continue working on...
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recentProjects.slice(0, 4).map((project) => (
              <button
                key={project.id}
                className="flex items-center gap-4 p-4 bg-[#27272a] rounded-xl hover:bg-[#3f3f46] transition-colors text-left"
              >
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-lg flex items-center justify-center">
                  <Gamepad2 size={24} className="text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-medium truncate">{project.name}</h3>
                  <p className="text-sm text-gray-500">
                    Last opened {formatTimeAgo(project.lastOpened)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fun footer */}
      <div className="text-center mt-12 text-gray-600">
        <p className="text-sm">
          Made with <span className="text-red-400">❤</span> by Singularity
        </p>
      </div>
    </div>
  );
}

interface PresetCardProps {
  preset: typeof PRESETS[0];
  onClick: () => void;
}

function PresetCard({ preset, onClick }: PresetCardProps) {
  const Icon = preset.icon;

  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl bg-[#27272a] p-5 text-left transition-all hover:scale-[1.03] hover:shadow-xl"
    >
      {/* Gradient background on hover */}
      <div className={`absolute inset-0 bg-gradient-to-br ${preset.color} opacity-0 group-hover:opacity-10 transition-opacity`} />

      <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${preset.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
        <Icon size={28} className="text-white" />
      </div>

      <h3 className="text-lg font-bold text-white mb-1">
        {preset.name}
      </h3>
      <p className="text-sm text-gray-400 mb-3">
        {preset.description}
      </p>

      <div className="flex flex-wrap gap-1">
        {preset.examples.slice(0, 2).map((example, i) => (
          <span
            key={i}
            className="text-[10px] px-2 py-1 bg-[#18181b] text-gray-500 rounded-full"
          >
            {example}
          </span>
        ))}
      </div>
    </button>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
