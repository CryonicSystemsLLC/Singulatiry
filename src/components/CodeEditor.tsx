import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';

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

const CodeEditor = React.memo(forwardRef<CodeEditorRef, CodeEditorProps>(({
    initialValue = '// Welcome to Singularity\n',
    language = 'typescript',
    theme = 'vs-dark',
    onChange,
    onSave
}, ref) => {
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<any>(null);

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

    const handleEditorDidMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // DISABLE SEMANTIC VALIDATION to remove "red squigglies" for missing types
        monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
            noSyntaxValidation: false, // Keep syntax errors (e.g. missing brace)
        });
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
            noSyntaxValidation: false,
        });

        // Basic configuration
        editor.updateOptions({
            minimap: { enabled: true },
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            fontLigatures: true,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 16 }
        });

        // "Ask AI to Fix" Context Menu Action
        editor.addAction({
            id: 'singularity.askAi',
            label: 'Ask AI to Fix',
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1,
            run: (ed) => {
                const selection = ed.getSelection();
                const model = ed.getModel();
                if (selection && model) {
                    const code = model.getValueInRange(selection);
                    if (code.trim()) {
                        // Dispatch event for AIChatPane to pick up
                        window.dispatchEvent(new CustomEvent('singularity:ask-ai', { detail: code }));
                    }
                }
            }
        });

        // Keybinding for Save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            if (onSave) {
                onSave(editor.getValue());
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

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            window.ipcRenderer.removeAllListeners('menu:selection-expand');
            window.ipcRenderer.removeAllListeners('menu:selection-shrink');
            window.ipcRenderer.removeAllListeners('menu:copy-line-up');
            window.ipcRenderer.removeAllListeners('menu:copy-line-down');
            window.ipcRenderer.removeAllListeners('menu:move-line-up');
            window.ipcRenderer.removeAllListeners('menu:move-line-down');
            window.ipcRenderer.removeAllListeners('menu:next-problem');
            window.ipcRenderer.removeAllListeners('menu:previous-problem');
        };
    }, []);

    // Effect to handle external file changes (e.g. tab switch)
    // When initialValue changes, we update the editor
    useEffect(() => {
        if (editorRef.current && initialValue !== editorRef.current.getValue()) {
            // Check if modification is significant or just a small diff?
            // For now, if initialValue changes (which implies parent changed the "file"), we overwrite.
            // We use pushEditOperations or setValue. setValue resets undo stack.
            // App.tsx manages file switching, so setValue is appropriate.
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
            // We REMOVE 'value' prop to make it uncontrolled regarding the 'value' state flow during typing
            // But we use useEffect above to sync when file changes.
            />
        </div>
    );
}));

export default CodeEditor;
