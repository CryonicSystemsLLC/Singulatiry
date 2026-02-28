import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Check, X, Wrench, Clock } from 'lucide-react';

export interface ToolCallInfo {
  id: string;
  name: string;
  args?: Record<string, any>;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
  durationMs?: number;
}

interface ToolCallBubbleProps {
  toolCall: ToolCallInfo;
}

const ToolCallBubble: React.FC<ToolCallBubbleProps> = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    running: <Loader2 size={14} className="text-[var(--info)] animate-spin" />,
    done: <Check size={14} className="text-[var(--success)]" />,
    error: <X size={14} className="text-[var(--error)]" />
  }[toolCall.status];

  const statusColor = {
    running: 'border-[var(--info)]/30 bg-[var(--info)]/5',
    done: 'border-[var(--success)]/20 bg-[var(--success)]/5',
    error: 'border-[var(--error)]/20 bg-[var(--error)]/5'
  }[toolCall.status];

  return (
    <div className={`my-2 rounded-lg border ${statusColor} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={12} className="text-[var(--text-secondary)]" />
        <span className="text-[var(--text-secondary)] font-mono">{toolCall.name}</span>
        <span className="flex-1" />
        {toolCall.durationMs !== undefined && (
          <span className="flex items-center gap-1 text-[var(--text-muted)]">
            <Clock size={10} />
            {toolCall.durationMs}ms
          </span>
        )}
        {statusIcon}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-[var(--border-secondary)]">
          {toolCall.args && Object.keys(toolCall.args).length > 0 && (
            <div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase mt-2 mb-1">Arguments</div>
              <pre className="text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded p-2 overflow-x-auto">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.result && (
            <div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase mt-2 mb-1">Result</div>
              <pre className="text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded p-2 overflow-x-auto max-h-40">
                {toolCall.result.length > 500 ? toolCall.result.slice(0, 500) + '...' : toolCall.result}
              </pre>
            </div>
          )}
          {toolCall.error && (
            <div>
              <div className="text-[10px] text-[var(--error)] uppercase mt-2 mb-1">Error</div>
              <pre className="text-xs text-[var(--error)] bg-[var(--error)]/10 rounded p-2">{toolCall.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(ToolCallBubble);
