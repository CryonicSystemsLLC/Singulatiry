import React, { useState, useEffect } from 'react';
import {
  X,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  Rocket,
  Database,
  Layout,
  Server,
  Code,
  Check,
  Loader2,
  AlertCircle
} from 'lucide-react';
import type { StackConfig } from '../types/ipc';

interface ProjectWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (config: ProjectConfig) => void;
}

interface ProjectConfig {
  name: string;
  path: string;
  stack: StackConfig;
  description: string;
  features: string[];
  databaseUrl?: string;
}

const FEATURE_OPTIONS = [
  { id: 'auth', label: 'Authentication', description: 'User login and registration' },
  { id: 'api', label: 'REST API', description: 'Backend API endpoints' },
  { id: 'database', label: 'Database', description: 'PostgreSQL with Prisma ORM' },
  { id: 'tailwind', label: 'Tailwind CSS', description: 'Utility-first styling' },
  { id: 'typescript', label: 'TypeScript', description: 'Type-safe code' }
];

export default function ProjectWizard({
  isOpen,
  onClose,
  onCreateProject
}: ProjectWizardProps) {
  const [step, setStep] = useState(1);
  const [stacks, setStacks] = useState<StackConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [selectedStackId, setSelectedStackId] = useState<string>('');
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set(['typescript', 'tailwind']));
  const [databaseUrl, setDatabaseUrl] = useState('');

  // Load stacks
  useEffect(() => {
    if (isOpen && window.templates) {
      window.templates.getStacks().then(setStacks);
    }
  }, [isOpen]);

  // Set default stack
  useEffect(() => {
    if (stacks.length > 0 && !selectedStackId) {
      setSelectedStackId(stacks[0].id);
    }
  }, [stacks, selectedStackId]);

  const selectedStack = stacks.find(s => s.id === selectedStackId);

  const handleSelectFolder = async () => {
    if (window.ipcRenderer) {
      const path = await window.ipcRenderer.invoke('dialog:openDirectory');
      if (path) {
        setProjectPath(path);
      }
    }
  };

  const handleToggleFeature = (featureId: string) => {
    setSelectedFeatures(prev => {
      const next = new Set(prev);
      if (next.has(featureId)) {
        next.delete(featureId);
      } else {
        next.add(featureId);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!selectedStack || !projectName || !projectPath) return;

    setLoading(true);
    setError(null);

    try {
      await onCreateProject({
        name: projectName,
        path: projectPath,
        stack: selectedStack,
        description: projectDescription,
        features: Array.from(selectedFeatures),
        databaseUrl: databaseUrl || undefined
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1: return projectName.trim().length > 0 && projectPath.trim().length > 0;
      case 2: return !!selectedStackId;
      case 3: return true;
      default: return true;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-[var(--bg-secondary)] w-[640px] rounded-xl border border-[var(--border-primary)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <Rocket size={20} className="text-[var(--accent-primary)]" />
            <h2 className="text-[var(--text-primary)] font-semibold">New Project</h2>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={20} />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 py-4 border-b border-[var(--border-primary)]">
          {[1, 2, 3].map(s => (
            <React.Fragment key={s}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                s === step ? 'bg-[var(--accent-primary)] text-[var(--text-primary)]' :
                s < step ? 'bg-[var(--success)]/20 text-[var(--success)]' :
                'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
              }`}>
                {s < step ? <Check size={16} /> : s}
              </div>
              {s < 3 && (
                <div className={`w-12 h-0.5 ${s < step ? 'bg-[var(--success)]/50' : 'bg-[var(--bg-tertiary)]'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 min-h-[320px]">
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">Project Details</h3>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1 uppercase font-bold tracking-wider">
                  Project Name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="my-awesome-app"
                  className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg px-4 py-3 text-sm border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)]"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1 uppercase font-bold tracking-wider">
                  Location
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder={navigator.platform.toUpperCase().includes('WIN') ? 'C:\\Projects' : '~/projects'}
                    className="flex-1 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg px-4 py-3 text-sm border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)]"
                  />
                  <button
                    onClick={handleSelectFolder}
                    className="px-4 py-3 bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded-lg hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <FolderOpen size={18} />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1 uppercase font-bold tracking-wider">
                  Description (Optional)
                </label>
                <textarea
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  placeholder="Describe your project..."
                  rows={3}
                  className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg px-4 py-3 text-sm border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)] resize-none"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">Choose a Stack</h3>

              <div className="grid grid-cols-2 gap-3">
                {stacks.map(stack => (
                  <button
                    key={stack.id}
                    onClick={() => setSelectedStackId(stack.id)}
                    className={`p-4 rounded-lg border text-left transition-all ${
                      selectedStackId === stack.id
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-bg)]'
                        : 'border-[var(--border-primary)] hover:border-[var(--bg-hover)] bg-[var(--bg-secondary)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {stack.frontend.framework === 'next' && <Layout size={16} className="text-[var(--info)]" />}
                      {stack.frontend.framework === 'react' && <Code size={16} className="text-cyan-400" />}
                      {stack.backend.framework === 'fastapi' && <Server size={16} className="text-[var(--success)]" />}
                      {stack.backend.framework === 'express' && <Server size={16} className="text-[var(--warning)]" />}
                      <span className="text-sm font-medium text-[var(--text-primary)]">{stack.name}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">{stack.description}</p>
                    <div className="flex gap-1 mt-2">
                      {stack.database.type !== 'none' && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded">
                          {stack.database.type}
                        </span>
                      )}
                      {stack.database.orm && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded">
                          {stack.database.orm}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">Configuration</h3>

              {/* Features */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-2 uppercase font-bold tracking-wider">
                  Features
                </label>
                <div className="space-y-2">
                  {FEATURE_OPTIONS.map(feature => (
                    <label
                      key={feature.id}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedFeatures.has(feature.id)
                          ? 'bg-[var(--accent-bg)] border border-[var(--accent-primary)]/30'
                          : 'bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--bg-hover)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFeatures.has(feature.id)}
                        onChange={() => handleToggleFeature(feature.id)}
                        className="sr-only"
                      />
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                        selectedFeatures.has(feature.id)
                          ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]'
                          : 'border-[var(--text-dim)]'
                      }`}>
                        {selectedFeatures.has(feature.id) && <Check size={12} className="text-[var(--text-primary)]" />}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm text-[var(--text-primary)]">{feature.label}</span>
                        <span className="text-xs text-[var(--text-muted)] ml-2">{feature.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Database URL */}
              {selectedStack?.database.type === 'postgresql' && (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1 uppercase font-bold tracking-wider">
                    <Database size={12} className="inline mr-1" />
                    Database URL (Optional)
                  </label>
                  <input
                    type="text"
                    value={databaseUrl}
                    onChange={(e) => setDatabaseUrl(e.target.value)}
                    placeholder="postgresql://user:pass@localhost:5432/mydb"
                    className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg px-4 py-3 text-sm border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)] font-mono"
                  />
                  <p className="text-xs text-[var(--text-dim)] mt-1">
                    Leave blank to use a local SQLite database for development
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-lg flex items-center gap-2 text-[var(--error)] text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]">
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1}
            className="flex items-center gap-1 px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>

            {step < 3 ? (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={!canProceed()}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-[var(--accent-hover)] hover:bg-[var(--accent-primary)] text-[var(--text-primary)] rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={loading || !canProceed()}
                className="flex items-center gap-2 px-6 py-2 text-sm bg-[var(--accent-hover)] hover:bg-[var(--accent-primary)] text-[var(--text-primary)] rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Rocket size={16} />
                    Create Project
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
