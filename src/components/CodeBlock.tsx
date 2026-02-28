import React from 'react';
import { Terminal } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockProps {
    language: string;
    code: string;
    onApply?: (code: string) => void;
}

/**
 * Syntax-highlighted code block with optional "Apply" button.
 * Used in both message rendering and streaming display.
 */
const CodeBlock: React.FC<CodeBlockProps> = ({ language, code, onApply }) => (
    <div className={`relative ${onApply ? 'group' : ''} my-2 rounded-md overflow-hidden bg-[var(--bg-primary)] border border-[var(--bg-hover)]`}>
        <div className="flex justify-between items-center px-3 py-1.5 bg-[var(--bg-tertiary)] border-b border-[var(--bg-hover)]">
            <span className="text-xs text-[var(--text-secondary)]">{language}</span>
            {onApply && (
                <button
                    onClick={() => onApply(code)}
                    className="flex items-center gap-1 text-[10px] bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--text-primary)] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <Terminal size={10} />
                    Apply
                </button>
            )}
        </div>
        <SyntaxHighlighter
            style={vscDarkPlus}
            language={language}
            PreTag="div"
            customStyle={{ margin: 0, padding: '12px', background: 'transparent' }}
        >
            {code}
        </SyntaxHighlighter>
    </div>
);

export default CodeBlock;
