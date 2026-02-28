import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
    Play, Pause, Square, SkipForward, ArrowDownToLine, ArrowUpFromLine,
    RefreshCw, Loader2, ChevronRight, ChevronDown, Plus, Trash2, Eye,
    Circle, Bug, Terminal, Settings, X, CornerDownRight
} from 'lucide-react';

const ipc = window.ipcRenderer;

type DebugState = 'inactive' | 'initializing' | 'running' | 'stopped' | 'terminated';

interface LaunchConfig {
    type: 'node' | 'python';
    request: 'launch' | 'attach';
    name: string;
    program?: string;
    args?: string[];
    cwd?: string;
    stopOnEntry?: boolean;
    runtimeArgs?: string[];
    port?: number;
}

interface StackFrame {
    id: number;
    name: string;
    source?: { path?: string; name?: string };
    line: number;
    column: number;
}

interface Variable {
    name: string;
    value: string;
    type?: string;
    variablesReference: number;
}

interface BreakpointInfo {
    file: string;
    line: number;
    verified: boolean;
    condition?: string;
}

interface DebugPaneProps {
    rootPath: string | null;
}

// ============================================================
// Launch Config Editor
// ============================================================

const defaultConfigs: LaunchConfig[] = [
    { type: 'node', request: 'launch', name: 'Node.js: Current File', program: '${file}' },
    { type: 'node', request: 'launch', name: 'Node.js: index.js', program: 'index.js' },
    { type: 'node', request: 'launch', name: 'Node.js: npm start', program: 'node_modules/.bin/ts-node', args: ['src/index.ts'] },
    { type: 'node', request: 'attach', name: 'Node.js: Attach', port: 9229 },
];

// ============================================================
// Debug Pane
// ============================================================

const DebugPane: React.FC<DebugPaneProps> = ({ rootPath }) => {
    const [debugState, setDebugState] = useState<DebugState>('inactive');
    const [selectedConfig, setSelectedConfig] = useState(0);
    const [configs, setConfigs] = useState<LaunchConfig[]>(defaultConfigs);
    const [stackFrames, setStackFrames] = useState<StackFrame[]>([]);
    const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
    const [scopes, setScopes] = useState<{ name: string; variablesReference: number; expensive: boolean }[]>([]);
    const [variables, setVariables] = useState<Map<number, Variable[]>>(new Map());
    const [expandedScopes, setExpandedScopes] = useState<Set<number>>(new Set());
    const [expandedVars, setExpandedVars] = useState<Set<number>>(new Set());
    const [watchExpressions, setWatchExpressions] = useState<string[]>([]);
    const [watchResults, setWatchResults] = useState<Map<string, string>>(new Map());
    const [breakpoints] = useState<BreakpointInfo[]>([]);
    const [consoleOutput, setConsoleOutput] = useState<{ text: string; category: string }[]>([]);
    const [consoleInput, setConsoleInput] = useState('');
    const [activeSection, setActiveSection] = useState<'variables' | 'watch' | 'callstack' | 'breakpoints'>('variables');
    const [showConfigEditor, setShowConfigEditor] = useState(false);
    const consoleEndRef = useRef<HTMLDivElement>(null);
    const threadId = useRef<number | null>(null);

    // Load launch.json if it exists
    useEffect(() => {
        if (!rootPath) return;
        (async () => {
            try {
                const launchPath = `${rootPath}/.vscode/launch.json`;
                const content = await ipc.invoke('fs:readFile', launchPath);
                if (content) {
                    // Strip comments from JSONC
                    const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
                    const parsed = JSON.parse(cleaned);
                    if (parsed.configurations?.length > 0) {
                        setConfigs(parsed.configurations);
                    }
                }
            } catch { /* no launch.json, use defaults */ }
        })();
    }, [rootPath]);

    // Listen for debug events from main process
    useEffect(() => {
        const onState = (_e: any, data: { state: DebugState; threadId: number | null }) => {
            setDebugState(data.state);
            threadId.current = data.threadId;
        };
        const onStopped = async (_e: any, data: { reason: string; threadId: number }) => {
            threadId.current = data.threadId;
            // Fetch stack trace
            try {
                const result = await ipc.invoke('debug:get-stack-trace', data.threadId);
                setStackFrames(result.stackFrames || []);
                if (result.stackFrames?.length > 0) {
                    const topFrame = result.stackFrames[0];
                    setSelectedFrame(topFrame.id);
                    // Fetch scopes for top frame
                    const frameScopes = await ipc.invoke('debug:get-scopes', topFrame.id);
                    setScopes(frameScopes);
                    // Auto-expand Local scope
                    const localScope = frameScopes.find((s: any) => s.name === 'Local');
                    if (localScope) {
                        setExpandedScopes(new Set([localScope.variablesReference]));
                        const vars = await ipc.invoke('debug:get-variables', localScope.variablesReference);
                        setVariables(prev => new Map(prev).set(localScope.variablesReference, vars));
                    }
                }
                // Refresh watch expressions
                refreshWatches();
            } catch (e) {
                console.error('[DebugPane] Failed to fetch stack:', e);
            }
        };
        const onOutput = (_e: any, data: { category: string; output: string }) => {
            if (data.output) {
                setConsoleOutput(prev => [...prev.slice(-500), { text: data.output, category: data.category }]);
            }
        };
        const onTerminated = () => {
            setDebugState('inactive');
            setStackFrames([]);
            setScopes([]);
            setVariables(new Map());
            setConsoleOutput(prev => [...prev, { text: '--- Debug session ended ---\n', category: 'info' }]);
        };

        ipc.on('debug:state', onState);
        ipc.on('debug:stopped', onStopped);
        ipc.on('debug:output', onOutput);
        ipc.on('debug:terminated', onTerminated);
        ipc.on('debug:exited', onOutput);

        return () => {
            ipc.off('debug:state', onState);
            ipc.off('debug:stopped', onStopped);
            ipc.off('debug:output', onOutput);
            ipc.off('debug:terminated', onTerminated);
            ipc.off('debug:exited', onOutput);
        };
    }, []);

    // Auto-scroll console
    useEffect(() => {
        consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [consoleOutput]);

    // Refresh watch expressions
    const refreshWatches = useCallback(async () => {
        const results = new Map<string, string>();
        for (const expr of watchExpressions) {
            try {
                const result = await ipc.invoke('debug:evaluate', expr, selectedFrame, 'watch');
                results.set(expr, result.result);
            } catch (e: any) {
                results.set(expr, `<${e.message}>`);
            }
        }
        setWatchResults(results);
    }, [watchExpressions, selectedFrame]);

    // Actions
    const startDebug = useCallback(async () => {
        if (!rootPath) return;
        const config = configs[selectedConfig];
        if (!config) return;

        setConsoleOutput([{ text: `Starting debug session: ${config.name}\n`, category: 'info' }]);
        setStackFrames([]);
        setScopes([]);
        setVariables(new Map());

        try {
            await ipc.invoke('debug:launch', config, rootPath);
        } catch (e: any) {
            setConsoleOutput(prev => [...prev, { text: `Failed to start: ${e.message}\n`, category: 'stderr' }]);
        }
    }, [rootPath, configs, selectedConfig]);

    const stopDebug = useCallback(async () => {
        try { await ipc.invoke('debug:terminate'); } catch {}
    }, []);

    const continueExec = useCallback(async () => {
        try { await ipc.invoke('debug:continue', threadId.current); } catch {}
    }, []);

    const pauseExec = useCallback(async () => {
        try { await ipc.invoke('debug:pause', threadId.current); } catch {}
    }, []);

    const stepOver = useCallback(async () => {
        try { await ipc.invoke('debug:step-over', threadId.current); } catch {}
    }, []);

    const stepInto = useCallback(async () => {
        try { await ipc.invoke('debug:step-into', threadId.current); } catch {}
    }, []);

    const stepOut = useCallback(async () => {
        try { await ipc.invoke('debug:step-out', threadId.current); } catch {}
    }, []);

    const restartDebug = useCallback(async () => {
        try { await ipc.invoke('debug:restart'); } catch {}
    }, []);

    const evaluateConsole = useCallback(async () => {
        if (!consoleInput.trim()) return;
        const expr = consoleInput.trim();
        setConsoleInput('');
        setConsoleOutput(prev => [...prev, { text: `> ${expr}\n`, category: 'input' }]);
        try {
            const result = await ipc.invoke('debug:evaluate', expr, selectedFrame, 'repl');
            setConsoleOutput(prev => [...prev, { text: `${result.result}\n`, category: 'stdout' }]);
        } catch (e: any) {
            setConsoleOutput(prev => [...prev, { text: `Error: ${e.message}\n`, category: 'stderr' }]);
        }
    }, [consoleInput, selectedFrame]);

    const loadVariables = useCallback(async (ref: number) => {
        try {
            const vars = await ipc.invoke('debug:get-variables', ref);
            setVariables(prev => new Map(prev).set(ref, vars));
        } catch {}
    }, []);

    const toggleScope = useCallback((ref: number) => {
        setExpandedScopes(prev => {
            const next = new Set(prev);
            if (next.has(ref)) next.delete(ref);
            else { next.add(ref); loadVariables(ref); }
            return next;
        });
    }, [loadVariables]);

    const toggleVar = useCallback((ref: number) => {
        setExpandedVars(prev => {
            const next = new Set(prev);
            if (next.has(ref)) next.delete(ref);
            else { next.add(ref); loadVariables(ref); }
            return next;
        });
    }, [loadVariables]);

    const addWatch = useCallback(() => {
        const expr = prompt('Enter watch expression:');
        if (expr?.trim()) {
            setWatchExpressions(prev => [...prev, expr.trim()]);
        }
    }, []);

    const removeWatch = useCallback((idx: number) => {
        setWatchExpressions(prev => prev.filter((_, i) => i !== idx));
    }, []);

    const isActive = debugState !== 'inactive' && debugState !== 'terminated';
    const isStopped = debugState === 'stopped';

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* ===== Header: Config selector + Launch button ===== */}
            <div className="px-3 py-2 border-b border-[var(--border-secondary)] shrink-0">
                <div className="flex items-center gap-1.5">
                    {!isActive ? (
                        <>
                            <button
                                onClick={startDebug}
                                disabled={!rootPath}
                                className="p-1.5 rounded bg-green-600 hover:bg-green-500 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Start Debugging (F5)"
                            >
                                <Play size={14} fill="currentColor" />
                            </button>
                            <select
                                value={selectedConfig}
                                onChange={e => setSelectedConfig(Number(e.target.value))}
                                className="flex-1 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 min-w-0"
                            >
                                {configs.map((c, i) => (
                                    <option key={i} value={i}>{c.name}</option>
                                ))}
                            </select>
                            <button
                                onClick={() => setShowConfigEditor(!showConfigEditor)}
                                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
                                title="Edit Launch Configuration"
                            >
                                <Settings size={12} />
                            </button>
                        </>
                    ) : (
                        /* ===== Step Controls ===== */
                        <div className="flex items-center gap-0.5 w-full">
                            {isStopped ? (
                                <button onClick={continueExec} className="p-1.5 rounded hover:bg-green-600/20 text-green-400" title="Continue (F5)">
                                    <Play size={14} fill="currentColor" />
                                </button>
                            ) : (
                                <button onClick={pauseExec} className="p-1.5 rounded hover:bg-yellow-600/20 text-yellow-400" title="Pause (F6)">
                                    <Pause size={14} />
                                </button>
                            )}
                            <button onClick={stepOver} disabled={!isStopped} className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] disabled:opacity-30" title="Step Over (F10)">
                                <SkipForward size={14} />
                            </button>
                            <button onClick={stepInto} disabled={!isStopped} className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] disabled:opacity-30" title="Step Into (F11)">
                                <ArrowDownToLine size={14} />
                            </button>
                            <button onClick={stepOut} disabled={!isStopped} className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] disabled:opacity-30" title="Step Out (Shift+F11)">
                                <ArrowUpFromLine size={14} />
                            </button>
                            <button onClick={restartDebug} className="p-1.5 rounded hover:bg-green-600/20 text-green-400" title="Restart (Ctrl+Shift+F5)">
                                <RefreshCw size={14} />
                            </button>
                            <button onClick={stopDebug} className="p-1.5 rounded hover:bg-red-600/20 text-red-400" title="Stop (Shift+F5)">
                                <Square size={14} fill="currentColor" />
                            </button>
                            <div className="flex-1" />
                            <span className={`text-[10px] ${debugState === 'running' ? 'text-green-400' : debugState === 'stopped' ? 'text-yellow-400' : 'text-[var(--text-muted)]'}`}>
                                {debugState === 'running' && 'Running'}
                                {debugState === 'stopped' && 'Paused'}
                                {debugState === 'initializing' && 'Starting...'}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* ===== Config Editor (inline) ===== */}
            {showConfigEditor && !isActive && (
                <ConfigEditor
                    configs={configs}
                    onSave={(newConfigs) => { setConfigs(newConfigs); setShowConfigEditor(false); }}
                    onClose={() => setShowConfigEditor(false)}
                    rootPath={rootPath}
                />
            )}

            {/* ===== Section Tabs ===== */}
            <div className="flex border-b border-[var(--border-secondary)] shrink-0">
                {(['variables', 'watch', 'callstack', 'breakpoints'] as const).map(section => (
                    <button
                        key={section}
                        onClick={() => setActiveSection(section)}
                        className={`flex-1 text-[10px] py-1.5 uppercase tracking-wider font-medium transition-colors ${
                            activeSection === section
                                ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent-primary)]'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                        }`}
                    >
                        {section === 'callstack' ? 'Call Stack' : section}
                    </button>
                ))}
            </div>

            {/* ===== Panel Content ===== */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {activeSection === 'variables' && (
                    <VariablesPanel
                        scopes={scopes}
                        variables={variables}
                        expandedScopes={expandedScopes}
                        expandedVars={expandedVars}
                        onToggleScope={toggleScope}
                        onToggleVar={toggleVar}
                        isActive={isActive}
                        isStopped={isStopped}
                    />
                )}
                {activeSection === 'watch' && (
                    <WatchPanel
                        expressions={watchExpressions}
                        results={watchResults}
                        onAdd={addWatch}
                        onRemove={removeWatch}
                        onRefresh={refreshWatches}
                        isStopped={isStopped}
                    />
                )}
                {activeSection === 'callstack' && (
                    <CallStackPanel
                        frames={stackFrames}
                        selectedFrame={selectedFrame}
                        onSelectFrame={async (frameId) => {
                            setSelectedFrame(frameId);
                            try {
                                const s = await ipc.invoke('debug:get-scopes', frameId);
                                setScopes(s);
                            } catch {}
                        }}
                    />
                )}
                {activeSection === 'breakpoints' && (
                    <BreakpointsPanel breakpoints={breakpoints} />
                )}
            </div>

            {/* ===== Debug Console ===== */}
            <div className="shrink-0 border-t border-[var(--border-secondary)]">
                <div className="flex items-center px-2 py-1 gap-1">
                    <Terminal size={10} className="text-[var(--text-muted)] shrink-0" />
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Debug Console</span>
                </div>
                <div className="h-32 overflow-y-auto px-2 bg-[var(--bg-primary)] text-[10px] font-mono">
                    {consoleOutput.map((entry, i) => (
                        <div
                            key={i}
                            className={
                                entry.category === 'stderr' ? 'text-red-400' :
                                entry.category === 'input' ? 'text-[var(--accent-primary)]' :
                                entry.category === 'info' ? 'text-[var(--text-muted)] italic' :
                                'text-[var(--text-secondary)]'
                            }
                        >
                            {entry.text}
                        </div>
                    ))}
                    <div ref={consoleEndRef} />
                </div>
                <div className="flex items-center border-t border-[var(--border-secondary)] px-2">
                    <CornerDownRight size={10} className="text-[var(--accent-primary)] shrink-0 mr-1" />
                    <input
                        value={consoleInput}
                        onChange={e => setConsoleInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') evaluateConsole(); }}
                        disabled={!isStopped}
                        placeholder={isStopped ? 'Evaluate expression...' : 'Pause execution to evaluate'}
                        className="flex-1 text-[10px] font-mono py-1.5 bg-transparent text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]/50 outline-none"
                    />
                </div>
            </div>
        </div>
    );
};

// ============================================================
// Variables Panel
// ============================================================

const VariablesPanel: React.FC<{
    scopes: { name: string; variablesReference: number; expensive: boolean }[];
    variables: Map<number, Variable[]>;
    expandedScopes: Set<number>;
    expandedVars: Set<number>;
    onToggleScope: (ref: number) => void;
    onToggleVar: (ref: number) => void;
    isActive: boolean;
    isStopped: boolean;
}> = ({ scopes, variables, expandedScopes, expandedVars, onToggleScope, onToggleVar, isActive, isStopped }) => {
    if (!isActive) {
        return (
            <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                <Bug size={24} className="mx-auto mb-2 opacity-20" />
                <p>Start a debug session to inspect variables</p>
            </div>
        );
    }
    if (!isStopped) {
        return (
            <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                <Loader2 size={16} className="mx-auto mb-2 animate-spin opacity-40" />
                <p>Running... pause execution to inspect variables</p>
            </div>
        );
    }
    if (scopes.length === 0) {
        return <div className="p-4 text-center text-xs text-[var(--text-muted)]">No variables available</div>;
    }

    return (
        <div className="text-xs">
            {scopes.map(scope => (
                <div key={scope.variablesReference}>
                    <button
                        onClick={() => onToggleScope(scope.variablesReference)}
                        className="flex items-center gap-1 w-full px-2 py-1 hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium"
                    >
                        {expandedScopes.has(scope.variablesReference)
                            ? <ChevronDown size={12} />
                            : <ChevronRight size={12} />}
                        {scope.name}
                    </button>
                    {expandedScopes.has(scope.variablesReference) && (
                        <VariableTree
                            vars={variables.get(scope.variablesReference) || []}
                            variables={variables}
                            expandedVars={expandedVars}
                            onToggleVar={onToggleVar}
                            depth={1}
                        />
                    )}
                </div>
            ))}
        </div>
    );
};

const VariableTree: React.FC<{
    vars: Variable[];
    variables: Map<number, Variable[]>;
    expandedVars: Set<number>;
    onToggleVar: (ref: number) => void;
    depth: number;
}> = ({ vars, variables, expandedVars, onToggleVar, depth }) => (
    <>
        {vars.map((v, i) => (
            <div key={`${v.name}-${i}`}>
                <div
                    className="flex items-center gap-1 px-2 py-0.5 hover:bg-[var(--bg-hover)] cursor-default"
                    style={{ paddingLeft: `${depth * 16 + 8}px` }}
                    onClick={() => v.variablesReference > 0 && onToggleVar(v.variablesReference)}
                >
                    {v.variablesReference > 0 ? (
                        expandedVars.has(v.variablesReference) ? <ChevronDown size={10} className="shrink-0 text-[var(--text-muted)]" /> : <ChevronRight size={10} className="shrink-0 text-[var(--text-muted)]" />
                    ) : (
                        <span className="w-[10px] shrink-0" />
                    )}
                    <span className="text-blue-400 shrink-0">{v.name}</span>
                    <span className="text-[var(--text-muted)] mx-0.5">=</span>
                    <span className={`truncate ${
                        v.type === 'string' ? 'text-green-400' :
                        v.type === 'number' ? 'text-yellow-400' :
                        v.type === 'boolean' ? 'text-purple-400' :
                        v.value === 'undefined' || v.value === 'null' ? 'text-[var(--text-muted)]' :
                        'text-[var(--text-secondary)]'
                    }`}>
                        {v.value}
                    </span>
                    {v.type && <span className="text-[var(--text-muted)] text-[9px] ml-1">({v.type})</span>}
                </div>
                {v.variablesReference > 0 && expandedVars.has(v.variablesReference) && (
                    <VariableTree
                        vars={variables.get(v.variablesReference) || []}
                        variables={variables}
                        expandedVars={expandedVars}
                        onToggleVar={onToggleVar}
                        depth={depth + 1}
                    />
                )}
            </div>
        ))}
    </>
);

// ============================================================
// Watch Panel
// ============================================================

const WatchPanel: React.FC<{
    expressions: string[];
    results: Map<string, string>;
    onAdd: () => void;
    onRemove: (idx: number) => void;
    onRefresh: () => void;
    isStopped: boolean;
}> = ({ expressions, results, onAdd, onRemove, onRefresh, isStopped }) => (
    <div className="text-xs">
        <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--border-secondary)]">
            <span className="text-[var(--text-muted)]">{expressions.length} expression{expressions.length !== 1 ? 's' : ''}</span>
            <div className="flex gap-1">
                <button onClick={onRefresh} className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]" title="Refresh"><RefreshCw size={10} /></button>
                <button onClick={onAdd} className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]" title="Add Expression"><Plus size={10} /></button>
            </div>
        </div>
        {expressions.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-muted)]">
                <Eye size={16} className="mx-auto mb-1 opacity-20" />
                <p>Add watch expressions to monitor values</p>
            </div>
        ) : (
            expressions.map((expr, i) => (
                <div key={i} className="flex items-center px-2 py-1 hover:bg-[var(--bg-hover)] group">
                    <span className="text-blue-400 shrink-0 mr-1">{expr}</span>
                    <span className="text-[var(--text-muted)] mx-0.5">=</span>
                    <span className="text-[var(--text-secondary)] truncate flex-1">
                        {isStopped ? (results.get(expr) || 'not available') : '<not paused>'}
                    </span>
                    <button
                        onClick={() => onRemove(i)}
                        className="p-0.5 rounded hover:bg-red-600/20 text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100"
                    >
                        <X size={10} />
                    </button>
                </div>
            ))
        )}
    </div>
);

// ============================================================
// Call Stack Panel
// ============================================================

const CallStackPanel: React.FC<{
    frames: StackFrame[];
    selectedFrame: number | null;
    onSelectFrame: (frameId: number) => void;
}> = ({ frames, selectedFrame, onSelectFrame }) => {
    if (frames.length === 0) {
        return (
            <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                No call stack available
            </div>
        );
    }

    return (
        <div className="text-xs">
            {frames.map((frame, i) => {
                const fileName = frame.source?.path?.split(/[/\\]/).pop() || frame.source?.name || '<unknown>';
                return (
                    <button
                        key={frame.id}
                        onClick={() => onSelectFrame(frame.id)}
                        className={`flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-[var(--bg-hover)] ${
                            selectedFrame === frame.id ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'
                        }`}
                    >
                        {i === 0 && <CornerDownRight size={10} className="text-yellow-400 shrink-0" />}
                        <span className="font-medium truncate">{frame.name}</span>
                        <span className="text-[var(--text-muted)] shrink-0 ml-auto">
                            {fileName}:{frame.line}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

// ============================================================
// Breakpoints Panel
// ============================================================

const BreakpointsPanel: React.FC<{
    breakpoints: BreakpointInfo[];
}> = ({ breakpoints }) => {
    if (breakpoints.length === 0) {
        return (
            <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                <Circle size={16} className="mx-auto mb-1 opacity-20" />
                <p>No breakpoints set</p>
                <p className="mt-1 text-[9px]">Click in the editor gutter to add breakpoints</p>
            </div>
        );
    }

    return (
        <div className="text-xs">
            {breakpoints.map((bp, i) => {
                const fileName = bp.file.split(/[/\\]/).pop() || bp.file;
                return (
                    <div key={i} className="flex items-center gap-1.5 px-2 py-1 hover:bg-[var(--bg-hover)]">
                        <Circle size={8} className={`shrink-0 fill-current ${bp.verified ? 'text-red-500' : 'text-[var(--text-muted)]'}`} />
                        <span className="text-[var(--text-secondary)] truncate">{fileName}</span>
                        <span className="text-[var(--text-muted)] shrink-0">:{bp.line}</span>
                        {bp.condition && (
                            <span className="text-yellow-400 text-[9px] truncate">({bp.condition})</span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// ============================================================
// Config Editor
// ============================================================

const ConfigEditor: React.FC<{
    configs: LaunchConfig[];
    onSave: (configs: LaunchConfig[]) => void;
    onClose: () => void;
    rootPath: string | null;
}> = ({ configs, onSave, onClose, rootPath }) => {
    const [editConfigs, setEditConfigs] = useState<LaunchConfig[]>([...configs]);
    const [editIdx, setEditIdx] = useState(0);

    const current = editConfigs[editIdx];

    const updateCurrent = (patch: Partial<LaunchConfig>) => {
        setEditConfigs(prev => prev.map((c, i) => i === editIdx ? { ...c, ...patch } : c));
    };

    const addConfig = () => {
        const newConfig: LaunchConfig = {
            type: 'node',
            request: 'launch',
            name: 'New Configuration',
            program: 'index.js',
        };
        setEditConfigs(prev => [...prev, newConfig]);
        setEditIdx(editConfigs.length);
    };

    const removeConfig = (idx: number) => {
        setEditConfigs(prev => prev.filter((_, i) => i !== idx));
        if (editIdx >= editConfigs.length - 1) setEditIdx(Math.max(0, editConfigs.length - 2));
    };

    const saveToDisk = async () => {
        if (!rootPath) return;
        const launchJson = JSON.stringify({ version: '0.2.0', configurations: editConfigs }, null, 2);
        try {
            await ipc.invoke('fs:mkdir', `${rootPath}/.vscode`);
        } catch {}
        await ipc.invoke('fs:writeFile', `${rootPath}/.vscode/launch.json`, launchJson);
        onSave(editConfigs);
    };

    return (
        <div className="border-b border-[var(--border-secondary)] p-2 bg-[var(--bg-secondary)]/50 text-xs space-y-2">
            <div className="flex items-center gap-1">
                <select
                    value={editIdx}
                    onChange={e => setEditIdx(Number(e.target.value))}
                    className="flex-1 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded px-1.5 py-0.5"
                >
                    {editConfigs.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
                </select>
                <button onClick={addConfig} className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]" title="Add Configuration"><Plus size={12} /></button>
                <button onClick={() => removeConfig(editIdx)} className="p-0.5 rounded hover:bg-red-600/20 text-[var(--text-muted)]" title="Remove"><Trash2 size={12} /></button>
            </div>
            {current && (
                <div className="space-y-1.5">
                    <div className="flex gap-2">
                        <label className="flex-1">
                            <span className="text-[var(--text-muted)]">Name</span>
                            <input value={current.name} onChange={e => updateCurrent({ name: e.target.value })}
                                className="w-full mt-0.5 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded px-1.5 py-0.5" />
                        </label>
                        <label className="w-20">
                            <span className="text-[var(--text-muted)]">Type</span>
                            <select value={current.type} onChange={e => updateCurrent({ type: e.target.value as any })}
                                className="w-full mt-0.5 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded px-1.5 py-0.5">
                                <option value="node">Node.js</option>
                                <option value="python">Python</option>
                            </select>
                        </label>
                        <label className="w-20">
                            <span className="text-[var(--text-muted)]">Request</span>
                            <select value={current.request} onChange={e => updateCurrent({ request: e.target.value as any })}
                                className="w-full mt-0.5 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded px-1.5 py-0.5">
                                <option value="launch">Launch</option>
                                <option value="attach">Attach</option>
                            </select>
                        </label>
                    </div>
                    {current.request === 'launch' && (
                        <label>
                            <span className="text-[var(--text-muted)]">Program</span>
                            <input value={current.program || ''} onChange={e => updateCurrent({ program: e.target.value })}
                                placeholder="e.g. index.js or src/main.ts"
                                className="w-full mt-0.5 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded px-1.5 py-0.5" />
                        </label>
                    )}
                    {current.request === 'attach' && (
                        <label>
                            <span className="text-[var(--text-muted)]">Port</span>
                            <input type="number" value={current.port || 9229} onChange={e => updateCurrent({ port: Number(e.target.value) })}
                                className="w-full mt-0.5 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded px-1.5 py-0.5" />
                        </label>
                    )}
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[var(--text-muted)]">
                            <input type="checkbox" checked={current.stopOnEntry || false} onChange={e => updateCurrent({ stopOnEntry: e.target.checked })}
                                className="rounded" />
                            Stop on entry
                        </label>
                    </div>
                </div>
            )}
            <div className="flex gap-1 justify-end">
                <button onClick={onClose} className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                    Cancel
                </button>
                <button onClick={() => onSave(editConfigs)} className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-primary)] text-white hover:opacity-80">
                    Apply
                </button>
                <button onClick={saveToDisk} className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-primary)] text-white hover:opacity-80">
                    Save to launch.json
                </button>
            </div>
        </div>
    );
};

export default DebugPane;
