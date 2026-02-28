import { useState } from 'react';
import {
  Settings,
  Thermometer,
  Hash,
  Clock,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Info,
  Save
} from 'lucide-react';

export interface ModelConfigValues {
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  timeout: number;
  stopSequences: string[];
}

interface ModelConfigProps {
  modelId: string;
  config: ModelConfigValues;
  onChange: (config: ModelConfigValues) => void;
  onSave?: () => void;
  expanded?: boolean;
}

const DEFAULT_CONFIG: ModelConfigValues = {
  temperature: 0.7,
  maxTokens: 4096,
  topP: 1.0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  timeout: 60000,
  stopSequences: []
};

const PRESETS: Record<string, Partial<ModelConfigValues>> = {
  'Creative': {
    temperature: 1.0,
    topP: 0.95,
    frequencyPenalty: 0.5,
    presencePenalty: 0.5
  },
  'Balanced': {
    temperature: 0.7,
    topP: 1.0,
    frequencyPenalty: 0,
    presencePenalty: 0
  },
  'Precise': {
    temperature: 0.2,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0
  },
  'Code': {
    temperature: 0.1,
    topP: 0.95,
    frequencyPenalty: 0,
    presencePenalty: 0
  }
};

export default function ModelConfig({
  modelId,
  config,
  onChange,
  onSave,
  expanded: initialExpanded = false
}: ModelConfigProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [stopInput, setStopInput] = useState('');

  const handleChange = (key: keyof ModelConfigValues, value: number | string[]) => {
    onChange({ ...config, [key]: value });
  };

  const handleReset = () => {
    onChange(DEFAULT_CONFIG);
  };

  const handlePreset = (presetName: string) => {
    const preset = PRESETS[presetName];
    if (preset) {
      onChange({ ...config, ...preset });
    }
  };

  const addStopSequence = () => {
    if (stopInput.trim() && !config.stopSequences.includes(stopInput.trim())) {
      handleChange('stopSequences', [...config.stopSequences, stopInput.trim()]);
      setStopInput('');
    }
  };

  const removeStopSequence = (seq: string) => {
    handleChange('stopSequences', config.stopSequences.filter(s => s !== seq));
  };

  return (
    <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Settings size={18} className="text-[var(--text-muted)]" />
          <span className="text-[var(--text-primary)] font-medium">Model Configuration</span>
          <span className="text-xs text-[var(--text-muted)]">({modelId})</span>
        </div>
        {expanded ? (
          <ChevronUp size={18} className="text-[var(--text-muted)]" />
        ) : (
          <ChevronDown size={18} className="text-[var(--text-muted)]" />
        )}
      </button>

      {expanded && (
        <div className="p-4 border-t border-[var(--border-primary)] space-y-6">
          {/* Presets */}
          <div>
            <label className="text-sm text-[var(--text-muted)] mb-2 block">Quick Presets</label>
            <div className="flex flex-wrap gap-2">
              {Object.keys(PRESETS).map(preset => (
                <button
                  key={preset}
                  onClick={() => handlePreset(preset)}
                  className="px-3 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-lg text-sm hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Temperature */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Thermometer size={14} className="text-[var(--warning)]" />
                <label className="text-sm text-[var(--text-muted)]">Temperature</label>
                <button className="group relative">
                  <Info size={12} className="text-[var(--text-dim)]" />
                  <div className="absolute bottom-full left-0 mb-1 w-48 p-2 bg-[var(--bg-tertiary)] rounded-lg text-xs text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    Controls randomness. Lower = more focused, higher = more creative.
                  </div>
                </button>
              </div>
              <span className="text-sm text-[var(--text-primary)] font-mono">{config.temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={config.temperature}
              onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
              className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-primary)]"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-dim)] mt-1">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Hash size={14} className="text-[var(--info)]" />
                <label className="text-sm text-[var(--text-muted)]">Max Output Tokens</label>
              </div>
              <span className="text-sm text-[var(--text-primary)] font-mono">{config.maxTokens}</span>
            </div>
            <input
              type="range"
              min="256"
              max="16384"
              step="256"
              value={config.maxTokens}
              onChange={(e) => handleChange('maxTokens', parseInt(e.target.value))}
              className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-primary)]"
            />
          </div>

          {/* Top P */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <label className="text-sm text-[var(--text-muted)]">Top P (Nucleus Sampling)</label>
                <button className="group relative">
                  <Info size={12} className="text-[var(--text-dim)]" />
                  <div className="absolute bottom-full left-0 mb-1 w-48 p-2 bg-[var(--bg-tertiary)] rounded-lg text-xs text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    Alternative to temperature. Limits token selection to top probability mass.
                  </div>
                </button>
              </div>
              <span className="text-sm text-[var(--text-primary)] font-mono">{config.topP.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={config.topP}
              onChange={(e) => handleChange('topP', parseFloat(e.target.value))}
              className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-primary)]"
            />
          </div>

          {/* Frequency & Presence Penalty */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-[var(--text-muted)]">Frequency Penalty</label>
                <span className="text-sm text-[var(--text-primary)] font-mono">{config.frequencyPenalty.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.1"
                value={config.frequencyPenalty}
                onChange={(e) => handleChange('frequencyPenalty', parseFloat(e.target.value))}
                className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-primary)]"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-[var(--text-muted)]">Presence Penalty</label>
                <span className="text-sm text-[var(--text-primary)] font-mono">{config.presencePenalty.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.1"
                value={config.presencePenalty}
                onChange={(e) => handleChange('presencePenalty', parseFloat(e.target.value))}
                className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-primary)]"
              />
            </div>
          </div>

          {/* Timeout */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-[var(--success)]" />
                <label className="text-sm text-[var(--text-muted)]">Request Timeout</label>
              </div>
              <span className="text-sm text-[var(--text-primary)] font-mono">{(config.timeout / 1000).toFixed(0)}s</span>
            </div>
            <input
              type="range"
              min="10000"
              max="300000"
              step="5000"
              value={config.timeout}
              onChange={(e) => handleChange('timeout', parseInt(e.target.value))}
              className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-primary)]"
            />
          </div>

          {/* Stop Sequences */}
          <div>
            <label className="text-sm text-[var(--text-muted)] mb-2 block">Stop Sequences</label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={stopInput}
                onChange={(e) => setStopInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addStopSequence()}
                placeholder="Add stop sequence..."
                className="flex-1 px-3 py-2 bg-[var(--bg-tertiary)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
              />
              <button
                onClick={addStopSequence}
                className="px-3 py-2 bg-[var(--accent-primary)] text-[var(--text-primary)] rounded-lg text-sm hover:bg-[var(--accent-hover)] transition-colors"
              >
                Add
              </button>
            </div>
            {config.stopSequences.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {config.stopSequences.map((seq) => (
                  <span
                    key={seq}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--bg-tertiary)] rounded text-xs text-[var(--text-secondary)]"
                  >
                    <code>{seq}</code>
                    <button
                      onClick={() => removeStopSequence(seq)}
                      className="text-[var(--text-muted)] hover:text-[var(--error)]"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-[var(--border-primary)]">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-3 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <RotateCcw size={14} />
              <span className="text-sm">Reset to Defaults</span>
            </button>
            {onSave && (
              <button
                onClick={onSave}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
              >
                <Save size={14} />
                <span className="text-sm">Save Configuration</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { DEFAULT_CONFIG, PRESETS };
