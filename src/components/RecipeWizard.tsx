import React, { useState, useCallback } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Play,
  Check,
  AlertCircle,
  Loader2,
  FileCode,
  Terminal,
  Eye,
  Info
} from 'lucide-react';

export interface RecipeParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  label: string;
  description: string;
  required: boolean;
  default?: string | number | boolean | string[];
  options?: { value: string; label: string }[];
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: RecipeParameter[];
  steps: { id: string; name: string; description: string; type: string }[];
}

export interface RecipeExecutionResult {
  success: boolean;
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  commandsRun: string[];
  errors: string[];
  warnings: string[];
  executionTimeMs: number;
}

interface RecipeWizardProps {
  recipe: Recipe;
  onExecute: (params: Record<string, any>) => Promise<RecipeExecutionResult>;
  onClose: () => void;
  projectRoot?: string;
}

export default function RecipeWizard({
  recipe,
  onExecute,
  onClose,
  projectRoot
}: RecipeWizardProps) {
  const [step, setStep] = useState<'params' | 'preview' | 'executing' | 'result'>('params');
  const [params, setParams] = useState<Record<string, any>>(() => {
    // Initialize with defaults
    const initial: Record<string, any> = {};
    for (const param of recipe.parameters) {
      if (param.default !== undefined) {
        initial[param.name] = param.default;
      }
    }
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RecipeExecutionResult | null>(null);
  const [executing, setExecuting] = useState(false);

  const validateParams = useCallback(() => {
    const newErrors: Record<string, string> = {};

    for (const param of recipe.parameters) {
      const value = params[param.name];

      // Required check
      if (param.required) {
        if (value === undefined || value === '' ||
            (Array.isArray(value) && value.length === 0)) {
          newErrors[param.name] = `${param.label} is required`;
          continue;
        }
      }

      // Skip further validation if empty and optional
      if (!value) continue;

      // Type-specific validation
      if (param.validation) {
        const v = param.validation;

        if (param.type === 'string' && typeof value === 'string') {
          if (v.pattern && !new RegExp(v.pattern).test(value)) {
            newErrors[param.name] = `Invalid format`;
          }
          if (v.minLength && value.length < v.minLength) {
            newErrors[param.name] = `Minimum ${v.minLength} characters`;
          }
          if (v.maxLength && value.length > v.maxLength) {
            newErrors[param.name] = `Maximum ${v.maxLength} characters`;
          }
        }

        if (param.type === 'number' && typeof value === 'number') {
          if (v.min !== undefined && value < v.min) {
            newErrors[param.name] = `Minimum value is ${v.min}`;
          }
          if (v.max !== undefined && value > v.max) {
            newErrors[param.name] = `Maximum value is ${v.max}`;
          }
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [params, recipe.parameters]);

  const handleParamChange = (name: string, value: any) => {
    setParams(prev => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (errors[name]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleNext = () => {
    if (validateParams()) {
      setStep('preview');
    }
  };

  const handleExecute = async () => {
    setStep('executing');
    setExecuting(true);

    try {
      const executionResult = await onExecute(params);
      setResult(executionResult);
      setStep('result');
    } catch (error: any) {
      setResult({
        success: false,
        filesCreated: [],
        filesModified: [],
        filesDeleted: [],
        commandsRun: [],
        errors: [error.message || 'Execution failed'],
        warnings: [],
        executionTimeMs: 0
      });
      setStep('result');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-[var(--bg-secondary)] w-[600px] max-h-[80vh] rounded-xl border border-[var(--border-primary)] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
          <div>
            <h2 className="text-[var(--text-primary)] font-semibold">{recipe.name}</h2>
            <p className="text-sm text-[var(--text-muted)]">{recipe.description}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={20} />
          </button>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">
          {['params', 'preview', 'result'].map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`flex items-center gap-1 text-xs ${
                  s === step || (step === 'executing' && s === 'preview')
                    ? 'text-[var(--accent-primary)]'
                    : step === 'result' || (step === 'executing' && s === 'params') ||
                      (step === 'preview' && s === 'params')
                    ? 'text-[var(--success)]'
                    : 'text-[var(--text-dim)]'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
                  s === step || (step === 'executing' && s === 'preview')
                    ? 'bg-[var(--accent-bg)]'
                    : step === 'result' || (step === 'executing' && s === 'params') ||
                      (step === 'preview' && s === 'params')
                    ? 'bg-[var(--success)]/20'
                    : 'bg-[var(--bg-tertiary)]'
                }`}>
                  {i + 1}
                </span>
                <span className="hidden sm:inline">
                  {s === 'params' ? 'Configure' : s === 'preview' ? 'Preview' : 'Complete'}
                </span>
              </div>
              {i < 2 && <ChevronRight size={14} className="text-[var(--text-dim)]" />}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {step === 'params' && (
            <div className="space-y-4">
              {recipe.parameters.length === 0 ? (
                <div className="text-center py-8 text-[var(--text-muted)]">
                  <Info size={32} className="mx-auto mb-2 opacity-50" />
                  <p>This recipe has no configurable parameters</p>
                </div>
              ) : (
                recipe.parameters.map(param => (
                  <ParameterInput
                    key={param.name}
                    parameter={param}
                    value={params[param.name]}
                    onChange={(value) => handleParamChange(param.name, value)}
                    error={errors[param.name]}
                  />
                ))
              )}
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              {/* Parameters Summary */}
              {recipe.parameters.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2">Configuration</h3>
                  <div className="bg-[var(--bg-primary)] rounded-lg p-3 space-y-2">
                    {recipe.parameters.map(param => (
                      <div key={param.name} className="flex justify-between text-sm">
                        <span className="text-[var(--text-muted)]">{param.label}</span>
                        <span className="text-[var(--text-primary)]">
                          {Array.isArray(params[param.name])
                            ? params[param.name].join(', ')
                            : String(params[param.name] ?? '-')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Steps Preview */}
              <div>
                <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2">
                  Steps to execute ({recipe.steps.length})
                </h3>
                <div className="bg-[var(--bg-primary)] rounded-lg divide-y divide-[var(--border-primary)]">
                  {recipe.steps.map((s, i) => (
                    <div key={s.id} className="p-3 flex items-start gap-3">
                      <span className="text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-muted)] w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {s.type === 'file_create' && <FileCode size={12} className="text-[var(--success)]" />}
                          {s.type === 'file_modify' && <FileCode size={12} className="text-[var(--warning)]" />}
                          {s.type === 'file_delete' && <FileCode size={12} className="text-[var(--error)]" />}
                          {s.type === 'command' && <Terminal size={12} className="text-[var(--info)]" />}
                          {s.type === 'prompt' && <Eye size={12} className="text-[var(--accent-primary)]" />}
                          <span className="text-sm text-[var(--text-primary)]">{s.name}</span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-1">{s.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {projectRoot && (
                <p className="text-xs text-[var(--text-muted)]">
                  Will execute in: <code className="text-[var(--text-muted)]">{projectRoot}</code>
                </p>
              )}
            </div>
          )}

          {step === 'executing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={48} className="text-[var(--accent-primary)] animate-spin mb-4" />
              <p className="text-[var(--text-primary)] font-medium">Executing recipe...</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">This may take a moment</p>
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-4">
              {/* Status */}
              <div className={`flex items-center gap-3 p-4 rounded-lg ${
                result.success
                  ? 'bg-[var(--success)]/10 border border-[var(--success)]/30'
                  : 'bg-[var(--error)]/10 border border-[var(--error)]/30'
              }`}>
                {result.success ? (
                  <Check size={24} className="text-[var(--success)]" />
                ) : (
                  <AlertCircle size={24} className="text-[var(--error)]" />
                )}
                <div>
                  <p className={`font-medium ${result.success ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                    {result.success ? 'Recipe executed successfully!' : 'Recipe execution failed'}
                  </p>
                  <p className="text-sm text-[var(--text-muted)]">
                    Completed in {(result.executionTimeMs / 1000).toFixed(1)}s
                  </p>
                </div>
              </div>

              {/* Files Created */}
              {result.filesCreated.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2 flex items-center gap-2">
                    <FileCode size={14} className="text-[var(--success)]" />
                    Files Created ({result.filesCreated.length})
                  </h3>
                  <div className="bg-[var(--bg-primary)] rounded-lg p-3 font-mono text-xs space-y-1">
                    {result.filesCreated.map(f => (
                      <div key={f} className="text-[var(--success)]">+ {f}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Files Modified */}
              {result.filesModified.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2 flex items-center gap-2">
                    <FileCode size={14} className="text-[var(--warning)]" />
                    Files Modified ({result.filesModified.length})
                  </h3>
                  <div className="bg-[var(--bg-primary)] rounded-lg p-3 font-mono text-xs space-y-1">
                    {result.filesModified.map(f => (
                      <div key={f} className="text-[var(--warning)]">~ {f}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Commands Run */}
              {result.commandsRun.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2 flex items-center gap-2">
                    <Terminal size={14} className="text-[var(--info)]" />
                    Commands Run ({result.commandsRun.length})
                  </h3>
                  <div className="bg-[var(--bg-primary)] rounded-lg p-3 font-mono text-xs space-y-1">
                    {result.commandsRun.map((c, i) => (
                      <div key={i} className="text-[var(--info)]">$ {c}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Errors */}
              {result.errors.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-[var(--error)] mb-2">Errors</h3>
                  <div className="bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-lg p-3 text-sm space-y-1">
                    {result.errors.map((e, i) => (
                      <div key={i} className="text-[var(--error)]">{e}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-[var(--warning)] mb-2">Warnings</h3>
                  <div className="bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-lg p-3 text-sm space-y-1">
                    {result.warnings.map((w, i) => (
                      <div key={i} className="text-[var(--warning)]">{w}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]">
          <button
            onClick={() => {
              if (step === 'preview') setStep('params');
              else if (step === 'result') onClose();
            }}
            disabled={step === 'executing'}
            className="flex items-center gap-1 px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {step === 'result' ? (
              'Close'
            ) : (
              <>
                <ChevronLeft size={16} />
                Back
              </>
            )}
          </button>

          {step === 'params' && (
            <button
              onClick={handleNext}
              className="flex items-center gap-1 px-4 py-2 text-sm bg-[var(--accent-hover)] hover:bg-[var(--accent-primary)] text-[var(--text-primary)] rounded-lg font-medium"
            >
              {recipe.parameters.length === 0 ? 'Preview' : 'Continue'}
              <ChevronRight size={16} />
            </button>
          )}

          {step === 'preview' && (
            <button
              onClick={handleExecute}
              disabled={executing}
              className="flex items-center gap-2 px-6 py-2 text-sm bg-[var(--accent-hover)] hover:bg-[var(--accent-primary)] text-[var(--text-primary)] rounded-lg font-medium disabled:opacity-50"
            >
              <Play size={16} />
              Execute Recipe
            </button>
          )}

          {step === 'result' && result?.success && (
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-6 py-2 text-sm bg-[var(--success)] hover:bg-[var(--success)] text-[var(--text-primary)] rounded-lg font-medium"
            >
              <Check size={16} />
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ParameterInputProps {
  parameter: RecipeParameter;
  value: any;
  onChange: (value: any) => void;
  error?: string;
}

function ParameterInput({ parameter, value, onChange, error }: ParameterInputProps) {
  const inputClass = `w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg px-4 py-2 text-sm border ${
    error ? 'border-[var(--error)]' : 'border-transparent focus:border-[var(--accent-primary)]'
  } focus:outline-none`;

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
        {parameter.label}
        {parameter.required && <span className="text-[var(--error)] ml-1">*</span>}
      </label>
      <p className="text-xs text-[var(--text-muted)] mb-2">{parameter.description}</p>

      {parameter.type === 'string' && (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder={`Enter ${parameter.label.toLowerCase()}`}
        />
      )}

      {parameter.type === 'number' && (
        <input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          className={inputClass}
          min={parameter.validation?.min}
          max={parameter.validation?.max}
        />
      )}

      {parameter.type === 'boolean' && (
        <label className="flex items-center gap-3 cursor-pointer">
          <div className={`relative w-10 h-5 rounded-full transition-colors ${
            value ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-tertiary)]'
          }`}>
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              value ? 'translate-x-5' : ''
            }`} />
          </div>
          <input
            type="checkbox"
            checked={value || false}
            onChange={(e) => onChange(e.target.checked)}
            className="sr-only"
          />
          <span className="text-sm text-[var(--text-muted)]">{value ? 'Enabled' : 'Disabled'}</span>
        </label>
      )}

      {parameter.type === 'select' && (
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          <option value="">Select an option</option>
          {parameter.options?.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {parameter.type === 'multiselect' && (
        <div className="space-y-2">
          {parameter.options?.map(opt => (
            <label
              key={opt.value}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                (value || []).includes(opt.value)
                  ? 'bg-[var(--accent-bg)] border border-[var(--accent-primary)]/30'
                  : 'bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--bg-hover)]'
              }`}
            >
              <input
                type="checkbox"
                checked={(value || []).includes(opt.value)}
                onChange={(e) => {
                  const current = value || [];
                  if (e.target.checked) {
                    onChange([...current, opt.value]);
                  } else {
                    onChange(current.filter((v: string) => v !== opt.value));
                  }
                }}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                (value || []).includes(opt.value)
                  ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]'
                  : 'border-[var(--text-dim)]'
              }`}>
                {(value || []).includes(opt.value) && (
                  <Check size={12} className="text-[var(--text-primary)]" />
                )}
              </div>
              <span className="text-sm text-[var(--text-primary)]">{opt.label}</span>
            </label>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-[var(--error)] mt-1">{error}</p>
      )}
    </div>
  );
}
