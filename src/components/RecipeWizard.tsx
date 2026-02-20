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
      <div className="bg-[#18181b] w-[600px] max-h-[80vh] rounded-xl border border-[#27272a] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#27272a]">
          <div>
            <h2 className="text-white font-semibold">{recipe.name}</h2>
            <p className="text-sm text-gray-500">{recipe.description}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#27272a] bg-[#0d0d12]">
          {['params', 'preview', 'result'].map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`flex items-center gap-1 text-xs ${
                  s === step || (step === 'executing' && s === 'preview')
                    ? 'text-purple-400'
                    : step === 'result' || (step === 'executing' && s === 'params') ||
                      (step === 'preview' && s === 'params')
                    ? 'text-green-400'
                    : 'text-gray-600'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
                  s === step || (step === 'executing' && s === 'preview')
                    ? 'bg-purple-500/20'
                    : step === 'result' || (step === 'executing' && s === 'params') ||
                      (step === 'preview' && s === 'params')
                    ? 'bg-green-500/20'
                    : 'bg-[#27272a]'
                }`}>
                  {i + 1}
                </span>
                <span className="hidden sm:inline">
                  {s === 'params' ? 'Configure' : s === 'preview' ? 'Preview' : 'Complete'}
                </span>
              </div>
              {i < 2 && <ChevronRight size={14} className="text-gray-600" />}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {step === 'params' && (
            <div className="space-y-4">
              {recipe.parameters.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
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
                  <h3 className="text-sm font-medium text-gray-400 mb-2">Configuration</h3>
                  <div className="bg-[#0d0d12] rounded-lg p-3 space-y-2">
                    {recipe.parameters.map(param => (
                      <div key={param.name} className="flex justify-between text-sm">
                        <span className="text-gray-500">{param.label}</span>
                        <span className="text-white">
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
                <h3 className="text-sm font-medium text-gray-400 mb-2">
                  Steps to execute ({recipe.steps.length})
                </h3>
                <div className="bg-[#0d0d12] rounded-lg divide-y divide-[#27272a]">
                  {recipe.steps.map((s, i) => (
                    <div key={s.id} className="p-3 flex items-start gap-3">
                      <span className="text-[10px] bg-[#27272a] text-gray-500 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {s.type === 'file_create' && <FileCode size={12} className="text-green-400" />}
                          {s.type === 'file_modify' && <FileCode size={12} className="text-yellow-400" />}
                          {s.type === 'file_delete' && <FileCode size={12} className="text-red-400" />}
                          {s.type === 'command' && <Terminal size={12} className="text-blue-400" />}
                          {s.type === 'prompt' && <Eye size={12} className="text-purple-400" />}
                          <span className="text-sm text-white">{s.name}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{s.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {projectRoot && (
                <p className="text-xs text-gray-500">
                  Will execute in: <code className="text-gray-400">{projectRoot}</code>
                </p>
              )}
            </div>
          )}

          {step === 'executing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={48} className="text-purple-400 animate-spin mb-4" />
              <p className="text-white font-medium">Executing recipe...</p>
              <p className="text-sm text-gray-500 mt-1">This may take a moment</p>
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-4">
              {/* Status */}
              <div className={`flex items-center gap-3 p-4 rounded-lg ${
                result.success
                  ? 'bg-green-500/10 border border-green-500/30'
                  : 'bg-red-500/10 border border-red-500/30'
              }`}>
                {result.success ? (
                  <Check size={24} className="text-green-400" />
                ) : (
                  <AlertCircle size={24} className="text-red-400" />
                )}
                <div>
                  <p className={`font-medium ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                    {result.success ? 'Recipe executed successfully!' : 'Recipe execution failed'}
                  </p>
                  <p className="text-sm text-gray-500">
                    Completed in {(result.executionTimeMs / 1000).toFixed(1)}s
                  </p>
                </div>
              </div>

              {/* Files Created */}
              {result.filesCreated.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                    <FileCode size={14} className="text-green-400" />
                    Files Created ({result.filesCreated.length})
                  </h3>
                  <div className="bg-[#0d0d12] rounded-lg p-3 font-mono text-xs space-y-1">
                    {result.filesCreated.map(f => (
                      <div key={f} className="text-green-400">+ {f}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Files Modified */}
              {result.filesModified.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                    <FileCode size={14} className="text-yellow-400" />
                    Files Modified ({result.filesModified.length})
                  </h3>
                  <div className="bg-[#0d0d12] rounded-lg p-3 font-mono text-xs space-y-1">
                    {result.filesModified.map(f => (
                      <div key={f} className="text-yellow-400">~ {f}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Commands Run */}
              {result.commandsRun.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                    <Terminal size={14} className="text-blue-400" />
                    Commands Run ({result.commandsRun.length})
                  </h3>
                  <div className="bg-[#0d0d12] rounded-lg p-3 font-mono text-xs space-y-1">
                    {result.commandsRun.map((c, i) => (
                      <div key={i} className="text-blue-400">$ {c}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Errors */}
              {result.errors.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-red-400 mb-2">Errors</h3>
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm space-y-1">
                    {result.errors.map((e, i) => (
                      <div key={i} className="text-red-400">{e}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-yellow-400 mb-2">Warnings</h3>
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm space-y-1">
                    {result.warnings.map((w, i) => (
                      <div key={i} className="text-yellow-400">{w}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[#27272a] bg-[#0d0d12]">
          <button
            onClick={() => {
              if (step === 'preview') setStep('params');
              else if (step === 'result') onClose();
            }}
            disabled={step === 'executing'}
            className="flex items-center gap-1 px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-50"
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
              className="flex items-center gap-1 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium"
            >
              {recipe.parameters.length === 0 ? 'Preview' : 'Continue'}
              <ChevronRight size={16} />
            </button>
          )}

          {step === 'preview' && (
            <button
              onClick={handleExecute}
              disabled={executing}
              className="flex items-center gap-2 px-6 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium disabled:opacity-50"
            >
              <Play size={16} />
              Execute Recipe
            </button>
          )}

          {step === 'result' && result?.success && (
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-6 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium"
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
  const inputClass = `w-full bg-[#27272a] text-white rounded-lg px-4 py-2 text-sm border ${
    error ? 'border-red-500' : 'border-transparent focus:border-purple-500'
  } focus:outline-none`;

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">
        {parameter.label}
        {parameter.required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <p className="text-xs text-gray-500 mb-2">{parameter.description}</p>

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
            value ? 'bg-purple-500' : 'bg-[#27272a]'
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
          <span className="text-sm text-gray-400">{value ? 'Enabled' : 'Disabled'}</span>
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
                  ? 'bg-purple-500/10 border border-purple-500/30'
                  : 'bg-[#1f1f23] border border-[#27272a] hover:border-[#3f3f46]'
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
                  ? 'bg-purple-500 border-purple-500'
                  : 'border-gray-600'
              }`}>
                {(value || []).includes(opt.value) && (
                  <Check size={12} className="text-white" />
                )}
              </div>
              <span className="text-sm text-white">{opt.label}</span>
            </label>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
