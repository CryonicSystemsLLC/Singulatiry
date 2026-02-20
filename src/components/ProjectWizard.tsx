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
      <div className="bg-[#18181b] w-[640px] rounded-xl border border-[#27272a] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#27272a]">
          <div className="flex items-center gap-3">
            <Rocket size={20} className="text-purple-400" />
            <h2 className="text-white font-semibold">New Project</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 py-4 border-b border-[#27272a]">
          {[1, 2, 3].map(s => (
            <React.Fragment key={s}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                s === step ? 'bg-purple-500 text-white' :
                s < step ? 'bg-green-500/20 text-green-400' :
                'bg-[#27272a] text-gray-500'
              }`}>
                {s < step ? <Check size={16} /> : s}
              </div>
              {s < 3 && (
                <div className={`w-12 h-0.5 ${s < step ? 'bg-green-500/50' : 'bg-[#27272a]'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 min-h-[320px]">
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Project Details</h3>

              <div>
                <label className="block text-xs text-gray-400 mb-1 uppercase font-bold tracking-wider">
                  Project Name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="my-awesome-app"
                  className="w-full bg-[#27272a] text-white rounded-lg px-4 py-3 text-sm border border-transparent focus:border-purple-500 focus:outline-none placeholder-gray-600"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1 uppercase font-bold tracking-wider">
                  Location
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="C:\Projects"
                    className="flex-1 bg-[#27272a] text-white rounded-lg px-4 py-3 text-sm border border-transparent focus:border-purple-500 focus:outline-none placeholder-gray-600"
                  />
                  <button
                    onClick={handleSelectFolder}
                    className="px-4 py-3 bg-[#27272a] text-gray-400 rounded-lg hover:text-white hover:bg-[#3f3f46] transition-colors"
                  >
                    <FolderOpen size={18} />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1 uppercase font-bold tracking-wider">
                  Description (Optional)
                </label>
                <textarea
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  placeholder="Describe your project..."
                  rows={3}
                  className="w-full bg-[#27272a] text-white rounded-lg px-4 py-3 text-sm border border-transparent focus:border-purple-500 focus:outline-none placeholder-gray-600 resize-none"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Choose a Stack</h3>

              <div className="grid grid-cols-2 gap-3">
                {stacks.map(stack => (
                  <button
                    key={stack.id}
                    onClick={() => setSelectedStackId(stack.id)}
                    className={`p-4 rounded-lg border text-left transition-all ${
                      selectedStackId === stack.id
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-[#27272a] hover:border-[#3f3f46] bg-[#1f1f23]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {stack.frontend.framework === 'next' && <Layout size={16} className="text-blue-400" />}
                      {stack.frontend.framework === 'react' && <Code size={16} className="text-cyan-400" />}
                      {stack.backend.framework === 'fastapi' && <Server size={16} className="text-green-400" />}
                      {stack.backend.framework === 'express' && <Server size={16} className="text-yellow-400" />}
                      <span className="text-sm font-medium text-white">{stack.name}</span>
                    </div>
                    <p className="text-xs text-gray-500">{stack.description}</p>
                    <div className="flex gap-1 mt-2">
                      {stack.database.type !== 'none' && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-[#27272a] text-gray-400 rounded">
                          {stack.database.type}
                        </span>
                      )}
                      {stack.database.orm && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-[#27272a] text-gray-400 rounded">
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
              <h3 className="text-lg font-medium text-white mb-4">Configuration</h3>

              {/* Features */}
              <div>
                <label className="block text-xs text-gray-400 mb-2 uppercase font-bold tracking-wider">
                  Features
                </label>
                <div className="space-y-2">
                  {FEATURE_OPTIONS.map(feature => (
                    <label
                      key={feature.id}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedFeatures.has(feature.id)
                          ? 'bg-purple-500/10 border border-purple-500/30'
                          : 'bg-[#1f1f23] border border-[#27272a] hover:border-[#3f3f46]'
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
                          ? 'bg-purple-500 border-purple-500'
                          : 'border-gray-600'
                      }`}>
                        {selectedFeatures.has(feature.id) && <Check size={12} className="text-white" />}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm text-white">{feature.label}</span>
                        <span className="text-xs text-gray-500 ml-2">{feature.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Database URL */}
              {selectedStack?.database.type === 'postgresql' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase font-bold tracking-wider">
                    <Database size={12} className="inline mr-1" />
                    Database URL (Optional)
                  </label>
                  <input
                    type="text"
                    value={databaseUrl}
                    onChange={(e) => setDatabaseUrl(e.target.value)}
                    placeholder="postgresql://user:pass@localhost:5432/mydb"
                    className="w-full bg-[#27272a] text-white rounded-lg px-4 py-3 text-sm border border-transparent focus:border-purple-500 focus:outline-none placeholder-gray-600 font-mono"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Leave blank to use a local SQLite database for development
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[#27272a] bg-[#0d0d12]">
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1}
            className="flex items-center gap-1 px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>

            {step < 3 ? (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={!canProceed()}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={loading || !canProceed()}
                className="flex items-center gap-2 px-6 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
