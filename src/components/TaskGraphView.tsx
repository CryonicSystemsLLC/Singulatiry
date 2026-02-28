import React, { useMemo } from 'react';
import {
  CheckCircle,
  Circle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Clock,
  Zap,
  FileCode,
  Database,
  Terminal,
  Package,
  Settings,
  Play,
  SkipForward
} from 'lucide-react';
import type { TaskGraph, Task, TaskType } from '../types/ipc';

interface TaskGraphViewProps {
  graph: TaskGraph | null;
  onTaskClick?: (task: Task) => void;
  expandedTasks?: Set<string>;
  onToggleExpand?: (taskId: string) => void;
}

const TASK_TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  choose_stack: <Settings size={14} />,
  scaffold_project: <Package size={14} />,
  configure_environment: <Settings size={14} />,
  design_schema: <Database size={14} />,
  create_migration: <Database size={14} />,
  apply_migration: <Database size={14} />,
  seed_data: <Database size={14} />,
  generate_backend: <FileCode size={14} />,
  generate_frontend: <FileCode size={14} />,
  generate_component: <FileCode size={14} />,
  generate_api_route: <FileCode size={14} />,
  generate_test: <FileCode size={14} />,
  edit_file: <FileCode size={14} />,
  refactor_code: <FileCode size={14} />,
  fix_error: <AlertTriangle size={14} />,
  add_feature: <Zap size={14} />,
  install_dependencies: <Package size={14} />,
  run_build: <Terminal size={14} />,
  run_tests: <Play size={14} />,
  start_dev_server: <Play size={14} />,
  run_command: <Terminal size={14} />,
  analyze_code: <FileCode size={14} />,
  review_changes: <FileCode size={14} />,
  explain_code: <FileCode size={14} />,
  custom: <Circle size={14} />
};

const STATUS_COLORS = {
  pending: 'text-[var(--text-muted)]',
  queued: 'text-[var(--info)]',
  in_progress: 'text-[var(--warning)]',
  completed: 'text-[var(--success)]',
  failed: 'text-[var(--error)]',
  skipped: 'text-[var(--text-dim)]',
  cancelled: 'text-[var(--text-muted)]'
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Circle size={16} className="text-[var(--text-muted)]" />,
  queued: <Clock size={16} className="text-[var(--info)]" />,
  in_progress: <Loader2 size={16} className="text-[var(--warning)] animate-spin" />,
  completed: <CheckCircle size={16} className="text-[var(--success)]" />,
  failed: <XCircle size={16} className="text-[var(--error)]" />,
  skipped: <SkipForward size={16} className="text-[var(--text-dim)]" />,
  cancelled: <XCircle size={16} className="text-[var(--text-muted)]" />
};

function TaskItem({
  task,
  isExpanded,
  onToggle,
  onClick,
  depth = 0
}: {
  task: Task;
  isExpanded: boolean;
  onToggle: () => void;
  onClick?: () => void;
  depth?: number;
}) {
  const hasDetails = task.result || task.error;

  return (
    <div className="border-b border-[var(--border-primary)] last:border-b-0">
      <div
        className={`flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors ${
          task.status === 'in_progress' ? 'bg-[var(--warning)]/5' : ''
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={onClick}
      >
        {hasDetails ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px]" />
        )}

        {STATUS_ICONS[task.status]}

        <span className="text-[var(--text-muted)]">
          {TASK_TYPE_ICONS[task.type] || <Circle size={14} />}
        </span>

        <span className={`flex-1 text-sm ${STATUS_COLORS[task.status]}`}>
          {task.name}
        </span>

        {task.executionTimeMs && (
          <span className="text-xs text-[var(--text-dim)]">
            {(task.executionTimeMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {isExpanded && hasDetails && (
        <div className="px-4 py-2 bg-[var(--bg-primary)] text-xs font-mono border-t border-[var(--border-primary)]"
             style={{ marginLeft: `${12 + depth * 16}px` }}>
          {task.error && (
            <div className="text-[var(--error)] mb-2">
              <strong>Error:</strong> {task.error.message}
            </div>
          )}
          {task.result && (
            <div className="text-[var(--text-muted)]">
              {task.result.output ? (
                <pre className="whitespace-pre-wrap max-h-40 overflow-auto">
                  {task.result.output.slice(0, 1000)}
                  {task.result.output.length > 1000 && '...'}
                </pre>
              ) : (
                <span className="text-[var(--success)]">Completed successfully</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaskGraphView({
  graph,
  onTaskClick,
  expandedTasks = new Set(),
  onToggleExpand
}: TaskGraphViewProps) {
  const stats = useMemo(() => {
    if (!graph) return null;

    const total = graph.tasks.length;
    const completed = graph.tasks.filter(t => t.status === 'completed').length;
    const failed = graph.tasks.filter(t => t.status === 'failed').length;
    const inProgress = graph.tasks.filter(t => t.status === 'in_progress').length;
    const pending = graph.tasks.filter(t => t.status === 'pending' || t.status === 'queued').length;

    return { total, completed, failed, inProgress, pending };
  }, [graph]);

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        <div className="text-center">
          <Circle size={48} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No active plan</p>
        </div>
      </div>
    );
  }

  const progressPercent = stats ? (stats.completed / stats.total) * 100 : 0;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
      {/* Header */}
      <div className="p-3 border-b border-[var(--border-primary)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">{graph.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded ${
            graph.status === 'completed' ? 'bg-[var(--success)]/20 text-[var(--success)]' :
            graph.status === 'failed' ? 'bg-[var(--error)]/20 text-[var(--error)]' :
            graph.status === 'in_progress' ? 'bg-[var(--warning)]/20 text-[var(--warning)]' :
            'bg-[var(--text-muted)]/20 text-[var(--text-muted)]'
          }`}>
            {graph.status.replace('_', ' ')}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              stats?.failed ? 'bg-[var(--error)]' :
              graph.status === 'completed' ? 'bg-[var(--success)]' :
              'bg-[var(--accent-primary)]'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex gap-4 mt-2 text-xs">
            <span className="text-[var(--text-muted)]">
              {stats.completed}/{stats.total} tasks
            </span>
            {stats.inProgress > 0 && (
              <span className="text-[var(--warning)]">
                {stats.inProgress} running
              </span>
            )}
            {stats.failed > 0 && (
              <span className="text-[var(--error)]">
                {stats.failed} failed
              </span>
            )}
          </div>
        )}
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-auto">
        {graph.tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            isExpanded={expandedTasks.has(task.id)}
            onToggle={() => onToggleExpand?.(task.id)}
            onClick={() => onTaskClick?.(task)}
          />
        ))}
      </div>

      {/* Footer */}
      {graph.executionTimeMs && (
        <div className="p-2 border-t border-[var(--border-primary)] text-xs text-[var(--text-muted)] flex justify-between">
          <span>Total time: {(graph.executionTimeMs / 1000).toFixed(1)}s</span>
          {graph.totalCost !== undefined && (
            <span>Est. cost: ${graph.totalCost.toFixed(4)}</span>
          )}
        </div>
      )}
    </div>
  );
}
