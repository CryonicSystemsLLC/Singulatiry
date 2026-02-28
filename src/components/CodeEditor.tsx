import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import Editor, { OnMount, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Use locally bundled Monaco instead of CDN (required for Electron/offline)
loader.config({ monaco });

export interface CodeEditorRef {
    setValue: (value: string) => void;
    getValue: () => string;
}

interface CodeEditorProps {
    initialValue?: string;
    language?: string;
    theme?: string;
    onChange?: (value: string | undefined) => void;
    onSave?: (value: string) => void;
}

// ── Structural Syntax Checker ───────────────────────────────────────────────
// Works for ALL languages: checks brackets, strings, block comments.
// Monaco already handles TS/JS/JSON/CSS/HTML validation natively;
// this adds basic checks for C#, Python, Java, Go, Rust, etc.

const LANGUAGES_WITH_BUILTIN_VALIDATION = new Set([
    'typescript', 'javascript', 'json', 'css', 'scss', 'less', 'html',
]);

interface SyntaxError {
    line: number;
    col: number;
    endLine: number;
    endCol: number;
    message: string;
    severity: 'error' | 'warning';
}

function checkStructuralSyntax(code: string, language: string): SyntaxError[] {
    const errors: SyntaxError[] = [];
    const lines = code.split('\n');

    // ── Bracket matching ────────────────────────────────────────────────
    const bracketPairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    const closingBrackets: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const stack: { char: string; line: number; col: number }[] = [];

    // Track string/comment state to skip brackets inside them
    let inSingleLineComment = false;
    let inBlockComment = false;
    let inString: string | null = null; // quote char or null
    let blockCommentStartLine = 0;
    let blockCommentStartCol = 0;

    // Language-specific comment styles
    const hasLineComment = !['html', 'css', 'xml'].includes(language);
    const lineCommentToken = language === 'python' || language === 'ruby' || language === 'shell' || language === 'yaml' || language === 'r'
        ? '#'
        : language === 'lua' ? '--' : '//';
    const hasBlockComment = !['python', 'ruby', 'shell', 'yaml', 'r'].includes(language);
    // Python triple-quotes handled as strings below

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        inSingleLineComment = false;

        for (let col = 0; col < line.length; col++) {
            const ch = line[col];
            const next = col + 1 < line.length ? line[col + 1] : '';

            // ── Inside block comment ────────────────────────────────
            if (inBlockComment) {
                if (ch === '*' && next === '/') {
                    inBlockComment = false;
                    col++; // skip /
                }
                continue;
            }

            // ── Inside single-line comment ──────────────────────────
            if (inSingleLineComment) continue;

            // ── Inside string ───────────────────────────────────────
            if (inString) {
                if (ch === '\\') { col++; continue; } // skip escaped char
                if (ch === inString) inString = null;
                continue;
            }

            // ── Check for comment start ─────────────────────────────
            if (hasLineComment && line.substring(col, col + lineCommentToken.length) === lineCommentToken) {
                inSingleLineComment = true;
                continue;
            }
            if (hasBlockComment && ch === '/' && next === '*') {
                inBlockComment = true;
                blockCommentStartLine = lineIdx;
                blockCommentStartCol = col;
                col++;
                continue;
            }

            // ── Check for string start ──────────────────────────────
            if (ch === '"' || ch === "'" || ch === '`') {
                inString = ch;
                continue;
            }

            // ── Bracket matching ────────────────────────────────────
            if (bracketPairs[ch]) {
                stack.push({ char: ch, line: lineIdx, col });
            } else if (closingBrackets[ch]) {
                if (stack.length === 0) {
                    errors.push({
                        line: lineIdx + 1, col: col + 1,
                        endLine: lineIdx + 1, endCol: col + 2,
                        message: `Unexpected closing '${ch}' with no matching opening bracket`,
                        severity: 'error',
                    });
                } else {
                    const top = stack[stack.length - 1];
                    if (top.char !== closingBrackets[ch]) {
                        errors.push({
                            line: lineIdx + 1, col: col + 1,
                            endLine: lineIdx + 1, endCol: col + 2,
                            message: `Mismatched bracket: expected '${bracketPairs[top.char]}' to close '${top.char}' from line ${top.line + 1}, but found '${ch}'`,
                            severity: 'error',
                        });
                        stack.pop();
                    } else {
                        stack.pop();
                    }
                }
            }
        }
    }

    // Unclosed brackets
    for (const item of stack) {
        errors.push({
            line: item.line + 1, col: item.col + 1,
            endLine: item.line + 1, endCol: item.col + 2,
            message: `Unclosed '${item.char}' — expected '${bracketPairs[item.char]}'`,
            severity: 'error',
        });
    }

    // Unclosed block comment
    if (inBlockComment) {
        errors.push({
            line: blockCommentStartLine + 1, col: blockCommentStartCol + 1,
            endLine: blockCommentStartLine + 1, endCol: blockCommentStartCol + 3,
            message: 'Unclosed block comment — missing closing */',
            severity: 'error',
        });
    }

    // Unclosed string (only report if it's on the last line — mid-file strings
    // are usually multi-line or template literals which are hard to detect)
    if (inString && inString !== '`') {
        const lastLine = lines.length;
        errors.push({
            line: lastLine, col: 1,
            endLine: lastLine, endCol: (lines[lastLine - 1]?.length || 0) + 1,
            message: `Unclosed string literal (started with ${inString})`,
            severity: 'warning',
        });
    }

    return errors;
}

function applyDiagnostics(
    monacoInstance: typeof monaco,
    model: monaco.editor.ITextModel,
    diagnostics: SyntaxError[]
) {
    const markers: monaco.editor.IMarkerData[] = diagnostics.map(d => ({
        severity: d.severity === 'error'
            ? monacoInstance.MarkerSeverity.Error
            : monacoInstance.MarkerSeverity.Warning,
        startLineNumber: d.line,
        startColumn: d.col,
        endLineNumber: d.endLine,
        endColumn: d.endCol,
        message: d.message,
        source: 'Singularity',
    }));
    monacoInstance.editor.setModelMarkers(model, 'singularity-syntax', markers);
}

// ── Component ───────────────────────────────────────────────────────────────

const CodeEditor = React.memo(forwardRef<CodeEditorRef, CodeEditorProps>(({
    initialValue = '// Welcome to Singularity\n',
    language = 'typescript',
    theme = 'vs-dark',
    onChange,
    onSave
}, ref) => {
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<any>(null);
    const syntaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;

    useImperativeHandle(ref, () => ({
        setValue: (value: string) => {
            if (editorRef.current) {
                editorRef.current.setValue(value);
            }
        },
        getValue: () => {
            if (editorRef.current) {
                return editorRef.current.getValue();
            }
            return '';
        }
    }));

    // Run structural syntax check (debounced)
    const runSyntaxCheck = (editor: any, monacoInstance: typeof monaco) => {
        if (syntaxTimerRef.current) clearTimeout(syntaxTimerRef.current);
        syntaxTimerRef.current = setTimeout(() => {
            const model = editor.getModel();
            if (!model) return;
            const lang = model.getLanguageId();
            // Skip languages with built-in Monaco validation
            if (LANGUAGES_WITH_BUILTIN_VALIDATION.has(lang)) {
                // Clear our custom markers so we don't double-report
                monacoInstance.editor.setModelMarkers(model, 'singularity-syntax', []);
                return;
            }
            const code = model.getValue();
            const errors = checkStructuralSyntax(code, lang);
            applyDiagnostics(monacoInstance, model, errors);
        }, 500);
    };

    const handleEditorDidMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Enable semantic validation for real IntelliSense
        monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
        });
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
        });

        // Enable JSON validation
        monaco.languages.json?.jsonDefaults?.setDiagnosticsOptions?.({
            validate: true,
            allowComments: true,
            trailingCommas: 'warning' as any,
        });

        // Configure TypeScript compiler options for better IntelliSense
        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ES2020,
            module: monaco.languages.typescript.ModuleKind.ESNext,
            moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
            allowJs: true,
            checkJs: false,
            jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
            strict: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            allowNonTsExtensions: true,
        });

        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ES2020,
            module: monaco.languages.typescript.ModuleKind.ESNext,
            allowJs: true,
            checkJs: false,
            jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
            allowNonTsExtensions: true,
        });

        // Basic configuration
        editor.updateOptions({
            minimap: { enabled: true },
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', Consolas, 'Liberation Mono', monospace",
            fontLigatures: true,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 16 },
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true },
        });

        // Run initial syntax check
        runSyntaxCheck(editor, monaco);

        // Run syntax check on content change
        editor.onDidChangeModelContent(() => {
            runSyntaxCheck(editor, monaco);
        });

        // Re-run when language changes (tab switch)
        editor.onDidChangeModelLanguage(() => {
            runSyntaxCheck(editor, monaco);
        });

        // "Ask AI to Fix" Context Menu Action
        editor.addAction({
            id: 'singularity.askAi',
            label: 'Ask AI to Fix',
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1,
            run: (ed: any) => {
                const selection = ed.getSelection();
                const model = ed.getModel();
                if (selection && model) {
                    const code = model.getValueInRange(selection);
                    if (code.trim()) {
                        window.dispatchEvent(new CustomEvent('singularity:ask-ai', { detail: code }));
                    }
                }
            }
        });

        // Keybinding for Save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            if (onSaveRef.current) {
                onSaveRef.current(editor.getValue());
            }
        });

        // Ctrl+K: Inline AI Edit
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
            const selection = editor.getSelection();
            const model = editor.getModel();
            if (selection && model) {
                const code = model.getValueInRange(selection);
                if (code.trim()) {
                    const pos = editor.getScrolledVisiblePosition(selection.getStartPosition());
                    if (pos) {
                        const editorDom = editor.getDomNode();
                        const rect = editorDom?.getBoundingClientRect();
                        window.dispatchEvent(new CustomEvent('singularity:inline-edit', {
                            detail: {
                                code,
                                position: {
                                    top: (rect?.top || 0) + pos.top + 20,
                                    left: (rect?.left || 0) + pos.left
                                },
                                selection: {
                                    startLineNumber: selection.startLineNumber,
                                    startColumn: selection.startColumn,
                                    endLineNumber: selection.endLineNumber,
                                    endColumn: selection.endColumn
                                }
                            }
                        }));
                    }
                }
            }
        });

        // IPC Listeners for Menu Actions
        const disposables: (() => void)[] = [];

        const registerMenuAction = (channel: string, actionId: string) => {
            const handler = () => {
                editor.trigger('menu', actionId, null);
                editor.focus();
            };
            window.ipcRenderer.on(channel, handler);
            disposables.push(() => window.ipcRenderer.removeListener(channel, handler));
        };

        // Selection
        registerMenuAction('menu:selection-expand', 'editor.action.smartSelect.expand');
        registerMenuAction('menu:selection-shrink', 'editor.action.smartSelect.shrink');
        registerMenuAction('menu:copy-line-up', 'editor.action.copyLinesUpAction');
        registerMenuAction('menu:copy-line-down', 'editor.action.copyLinesDownAction');
        registerMenuAction('menu:move-line-up', 'editor.action.moveLinesUpAction');
        registerMenuAction('menu:move-line-down', 'editor.action.moveLinesDownAction');

        // Go (Navigation)
        registerMenuAction('menu:next-problem', 'editor.action.marker.next');
        registerMenuAction('menu:previous-problem', 'editor.action.marker.prev');

        // Store disposables for cleanup
        (editor as any)._menuDisposables = disposables;
    };

    // Cleanup on unmount — use stored disposables instead of removeAllListeners
    useEffect(() => {
        return () => {
            if (syntaxTimerRef.current) clearTimeout(syntaxTimerRef.current);
            const editor = editorRef.current;
            if (editor && (editor as any)._menuDisposables) {
                for (const dispose of (editor as any)._menuDisposables) {
                    dispose();
                }
            }
        };
    }, []);

    // Effect to handle external file changes (e.g. tab switch)
    useEffect(() => {
        if (editorRef.current && initialValue !== editorRef.current.getValue()) {
            editorRef.current.setValue(initialValue);
        }
    }, [initialValue]);

    return (
        <div className="h-full w-full overflow-hidden">
            <Editor
                height="100%"
                defaultLanguage={language}
                defaultValue={initialValue}
                theme={theme}
                onMount={handleEditorDidMount}
                onChange={onChange}
            />
        </div>
    );
}));

export default CodeEditor;
