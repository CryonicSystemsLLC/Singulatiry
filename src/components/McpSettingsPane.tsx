import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Play, Square, RotateCcw, Wrench, ChevronDown, ChevronRight, Server, AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';

interface McpServer {
    id: string;
    config: {
        command: string;
        args?: string[];
        env?: Record<string, string>;
    };
    status: 'stopped' | 'starting' | 'running' | 'error';
    error?: string;
    serverName?: string;
    serverVersion?: string;
    toolCount: number;
    tools: Array<{ name: string; description?: string }>;
    scope: 'project' | 'user';
}

const statusIcons: Record<string, React.ReactNode> = {
    stopped: <Square size={12} className="text-[var(--text-muted)]" />,
    starting: <Loader2 size={12} className="text-[var(--warning)] animate-spin" />,
    running: <CheckCircle2 size={12} className="text-[var(--success)]" />,
    error: <AlertCircle size={12} className="text-[var(--error)]" />,
};

const statusColors: Record<string, string> = {
    stopped: 'text-[var(--text-muted)]',
    starting: 'text-[var(--warning)]',
    running: 'text-[var(--success)]',
    error: 'text-[var(--error)]',
};

const McpSettingsPane: React.FC = () => {
    const [servers, setServers] = useState<McpServer[]>([]);
    const [expandedServer, setExpandedServer] = useState<string | null>(null);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [newId, setNewId] = useState('');
    const [newCommand, setNewCommand] = useState('');
    const [newArgs, setNewArgs] = useState('');
    const [newScope, setNewScope] = useState<'project' | 'user'>('user');

    const refreshServers = useCallback(async () => {
        try {
            const list = await (window as any).mcp?.listServers?.();
            setServers(list || []);
        } catch { /* MCP not available */ }
    }, []);

    useEffect(() => {
        refreshServers();
        const unsub = (window as any).mcp?.onStatusChange?.(() => refreshServers());
        return () => unsub?.();
    }, [refreshServers]);

    const handleStart = async (id: string) => {
        try {
            await (window as any).mcp.startServer(id);
            await refreshServers();
        } catch (err: any) {
            console.error('Failed to start MCP server:', err);
        }
    };

    const handleStop = async (id: string) => {
        try {
            await (window as any).mcp.stopServer(id);
            await refreshServers();
        } catch (err: any) {
            console.error('Failed to stop MCP server:', err);
        }
    };

    const handleRestart = async (id: string) => {
        try {
            await (window as any).mcp.restartServer(id);
            await refreshServers();
        } catch (err: any) {
            console.error('Failed to restart MCP server:', err);
        }
    };

    const handleRemove = async (id: string, scope: 'project' | 'user') => {
        try {
            await (window as any).mcp.removeServer(id, scope);
            await refreshServers();
        } catch (err: any) {
            console.error('Failed to remove MCP server:', err);
        }
    };

    const handleAdd = async () => {
        if (!newId.trim() || !newCommand.trim()) return;
        try {
            const args = newArgs.trim() ? newArgs.split(/\s+/) : [];
            await (window as any).mcp.addServer(newId.trim(), { command: newCommand.trim(), args }, newScope);
            setShowAddDialog(false);
            setNewId('');
            setNewCommand('');
            setNewArgs('');
            await refreshServers();
        } catch (err: any) {
            console.error('Failed to add MCP server:', err);
        }
    };

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[var(--text-primary)]">MCP Servers</span>
                <button
                    onClick={() => setShowAddDialog(true)}
                    className="flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:text-[var(--accent-hover)] transition-colors"
                >
                    <Plus size={12} />
                    Add Server
                </button>
            </div>

            {servers.length === 0 && (
                <div className="text-center py-8">
                    <Server size={32} className="text-[var(--text-muted)] mx-auto mb-2" />
                    <p className="text-xs text-[var(--text-muted)]">No MCP servers configured</p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">
                        Add servers here or create a <code className="bg-[var(--bg-tertiary)] px-1 rounded">.mcp.json</code> file
                    </p>
                </div>
            )}

            <div className="space-y-2">
                {servers.map(server => {
                    const isExpanded = expandedServer === server.id;
                    return (
                        <div
                            key={server.id}
                            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] overflow-hidden"
                        >
                            {/* Server Header */}
                            <div
                                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                                onClick={() => setExpandedServer(isExpanded ? null : server.id)}
                            >
                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {statusIcons[server.status]}
                                <span className="text-xs font-mono text-[var(--text-primary)] flex-1">{server.id}</span>
                                <span className={`text-[10px] ${statusColors[server.status]}`}>{server.status}</span>
                                {server.toolCount > 0 && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]">
                                        <Wrench size={10} />
                                        {server.toolCount}
                                    </span>
                                )}
                                <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-primary)] px-1.5 py-0.5 rounded">
                                    {server.scope}
                                </span>
                            </div>

                            {/* Expanded Details */}
                            {isExpanded && (
                                <div className="px-3 pb-3 border-t border-[var(--border-primary)] space-y-2">
                                    {/* Command Info */}
                                    <div className="mt-2">
                                        <div className="text-[10px] text-[var(--text-muted)] uppercase mb-1">Command</div>
                                        <code className="text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] px-2 py-1 rounded block overflow-x-auto">
                                            {server.config.command} {server.config.args?.join(' ') || ''}
                                        </code>
                                    </div>

                                    {/* Server Info */}
                                    {server.serverName && (
                                        <div className="text-[10px] text-[var(--text-muted)]">
                                            Server: {server.serverName} {server.serverVersion ? `v${server.serverVersion}` : ''}
                                        </div>
                                    )}

                                    {/* Error */}
                                    {server.error && (
                                        <div className="text-xs text-[var(--error)] bg-[var(--error)]/10 rounded p-2">
                                            {server.error}
                                        </div>
                                    )}

                                    {/* Tools List */}
                                    {server.tools.length > 0 && (
                                        <div>
                                            <div className="text-[10px] text-[var(--text-muted)] uppercase mb-1">Tools ({server.tools.length})</div>
                                            <div className="space-y-0.5 max-h-32 overflow-y-auto">
                                                {server.tools.map(tool => (
                                                    <div key={tool.name} className="flex items-start gap-1.5 text-xs">
                                                        <Wrench size={10} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                                                        <div>
                                                            <span className="font-mono text-[var(--text-secondary)]">{tool.name}</span>
                                                            {tool.description && (
                                                                <span className="text-[var(--text-muted)] ml-1">— {tool.description}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex gap-2 pt-1">
                                        {server.status === 'running' ? (
                                            <button onClick={() => handleStop(server.id)} className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--error)] transition-colors">
                                                <Square size={10} /> Stop
                                            </button>
                                        ) : (
                                            <button onClick={() => handleStart(server.id)} className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--success)] transition-colors">
                                                <Play size={10} /> Start
                                            </button>
                                        )}
                                        <button onClick={() => handleRestart(server.id)} className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors">
                                            <RotateCcw size={10} /> Restart
                                        </button>
                                        <button onClick={() => handleRemove(server.id, server.scope)} className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--error)] transition-colors ml-auto">
                                            <Trash2 size={10} /> Remove
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Add Server Dialog */}
            {showAddDialog && (
                <div className="rounded-lg border border-[var(--accent-primary)]/30 bg-[var(--bg-tertiary)] p-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--text-primary)]">Add MCP Server</span>
                        <button onClick={() => setShowAddDialog(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                            <X size={14} />
                        </button>
                    </div>

                    <div className="space-y-2">
                        <div>
                            <label className="text-[10px] text-[var(--text-muted)] uppercase block mb-1">Server ID</label>
                            <input
                                value={newId}
                                onChange={e => setNewId(e.target.value)}
                                placeholder="e.g., filesystem"
                                className="w-full bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-[var(--border-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-[var(--text-muted)] uppercase block mb-1">Command</label>
                            <input
                                value={newCommand}
                                onChange={e => setNewCommand(e.target.value)}
                                placeholder="e.g., npx"
                                className="w-full bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-[var(--border-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-[var(--text-muted)] uppercase block mb-1">Arguments (space-separated)</label>
                            <input
                                value={newArgs}
                                onChange={e => setNewArgs(e.target.value)}
                                placeholder="e.g., -y @modelcontextprotocol/server-filesystem C:/Projects"
                                className="w-full bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 border border-[var(--border-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-[10px] text-[var(--text-muted)] uppercase">Scope:</label>
                            <div className="flex items-center gap-1 bg-[var(--bg-primary)] rounded p-0.5 border border-[var(--border-primary)]">
                                {(['user', 'project'] as const).map(s => (
                                    <button
                                        key={s}
                                        onClick={() => setNewScope(s)}
                                        className={`px-2.5 py-1 text-[10px] rounded transition-colors ${
                                            newScope === s
                                                ? 'bg-[var(--accent-primary)] text-white'
                                                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                        }`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setShowAddDialog(false)}
                            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAdd}
                            disabled={!newId.trim() || !newCommand.trim()}
                            className="px-3 py-1.5 text-xs bg-[var(--accent-primary)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Add
                        </button>
                    </div>
                </div>
            )}

            {/* Help */}
            <div className="text-[10px] text-[var(--text-muted)] mt-4 space-y-1">
                <p>MCP servers provide tools that the AI can use during conversations.</p>
                <p>Config files: <code className="bg-[var(--bg-tertiary)] px-1 rounded">~/.singularity/mcp.json</code> (user) or <code className="bg-[var(--bg-tertiary)] px-1 rounded">.mcp.json</code> (project)</p>
                <p>Compatible with Claude Desktop <code className="bg-[var(--bg-tertiary)] px-1 rounded">claude_desktop_config.json</code> format.</p>
            </div>
        </div>
    );
};

export default React.memo(McpSettingsPane);
