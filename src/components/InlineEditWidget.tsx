import React, { useState, useRef, useEffect } from 'react';
import { Loader2, Check, X, Sparkles } from 'lucide-react';

interface InlineEditWidgetProps {
  position: { top: number; left: number };
  selectedCode: string;
  filePath?: string;
  onApply: (newCode: string) => void;
  onCancel: () => void;
}

const InlineEditWidget: React.FC<InlineEditWidgetProps> = ({
  position, selectedCode, onApply, onCancel
}) => {
  const [instruction, setInstruction] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!instruction.trim() || isLoading) return;

    setIsLoading(true);
    try {
      const response = await (window as any).modelService.chat({
        messages: [{
          role: 'user',
          content: `Edit the following code according to this instruction: "${instruction}"\n\nCode:\n\`\`\`\n${selectedCode}\n\`\`\`\n\nReturn ONLY the modified code, no explanations or markdown fences.`
        }],
        systemPrompt: 'You are a code editing assistant. Return only the modified code, nothing else. No markdown fences, no explanations.',
        maxTokens: 2048,
        temperature: 0.3
      });

      if (response?.content) {
        // Strip markdown fences if present
        let code = response.content.trim();
        if (code.startsWith('```')) {
          code = code.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
        }
        setResult(code);
      }
    } catch (error: any) {
      console.error('Inline edit failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (result) {
        onApply(result);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div
      className="fixed z-50 bg-[var(--bg-secondary)] border border-[var(--accent-primary)]/50 rounded-lg shadow-2xl overflow-hidden"
      style={{ top: position.top, left: position.left, width: 420 }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)]">
        <Sparkles size={14} className="text-[var(--accent-primary)]" />
        <input
          ref={inputRef}
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the edit (e.g., 'add error handling')"
          className="flex-1 bg-transparent text-[var(--text-primary)] text-sm focus:outline-none placeholder-[var(--text-muted)]"
          disabled={isLoading}
        />
        {isLoading && <Loader2 size={14} className="text-[var(--accent-primary)] animate-spin" />}
      </div>

      {result && (
        <div className="border-t border-[var(--border-primary)]">
          <pre className="text-xs text-[var(--text-secondary)] p-3 max-h-48 overflow-auto bg-[var(--bg-primary)]">
            {result}
          </pre>
          <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-[var(--border-primary)]">
            <button
              onClick={onCancel}
              className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <X size={12} /> Reject
            </button>
            <button
              onClick={() => onApply(result)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--success)] hover:bg-[var(--success)] text-[var(--text-primary)] rounded"
            >
              <Check size={12} /> Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(InlineEditWidget);
