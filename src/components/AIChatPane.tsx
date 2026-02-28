import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Settings, StopCircle, Sparkles, Wrench } from 'lucide-react';
import APIKeyModal from './APIKeyModal';
import ModelSelector from './ModelSelector';
import ToolCallBubble from './ToolCallBubble';
import CodeBlock from './CodeBlock';
import ReactMarkdown from 'react-markdown';
import { useMcpTools } from '../hooks/useMcpTools';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    model?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost?: number };
    toolCalls?: Array<{ name: string; status: 'running' | 'done' | 'error'; result?: string; duration?: number; args?: Record<string, any> }>;
    thinkingContent?: string;
}

interface AIChatPaneProps {
    getActiveFileContent: () => string;
    activeFilePath?: string | null;
    onApplyCode?: (code: string) => void;
    projectRoot?: string | null;
}

const AIChatPane = React.memo<AIChatPaneProps>(({ getActiveFileContent, activeFilePath, onApplyCode, projectRoot }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamContent, setStreamContent] = useState('');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [selectedModel, setSelectedModel] = useState(() =>
        localStorage.getItem('singularity_selected_model') || 'anthropic:claude-sonnet-4-6'
    );

    const mcpToolCount = useMcpTools();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const abortRef = useRef<(() => void) | null>(null);
    const toolCallAbortRef = useRef(false);

    // Persist model selection
    useEffect(() => {
        localStorage.setItem('singularity_selected_model', selectedModel);
    }, [selectedModel]);

    // Initial Greeting
    useEffect(() => {
        if (!isSettingsOpen && messages.length === 0) {
            setMessages([{
                id: 'system-1',
                role: 'assistant',
                content: 'Please select your provider and connect your API key to use AI.'
            }]);
        }
    }, [isSettingsOpen]);

    // Event Listener for "Ask AI to Fix" from Editor
    useEffect(() => {
        const handleAskAi = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail) {
                const prompt = `Fix this code:\n\`\`\`\n${detail}\n\`\`\`\nExplain what was wrong.`;
                setInput(prompt);
                inputRef.current?.focus();
            }
        };
        window.addEventListener('singularity:ask-ai', handleAskAi);
        return () => window.removeEventListener('singularity:ask-ai', handleAskAi);
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages, streamContent]);

    // Model is already stored as "provider:model" format — pass through
    // Legacy bare model IDs get a fallback prefix
    const resolveModelId = useCallback((modelId: string): string => {
        if (modelId.includes(':')) return modelId;
        return `anthropic:${modelId}`;
    }, []);

    const handleStop = useCallback(() => {
        abortRef.current?.();
        abortRef.current = null;
        toolCallAbortRef.current = true;
        setIsStreaming(false);
    }, []);

    /**
     * Build system prompt and context (shared by both paths)
     */
    const buildContext = async () => {
        let filesList: string[] = [];
        if (projectRoot) {
            try {
                filesList = await window.ipcRenderer.invoke('fs:listAllFiles', projectRoot);
            } catch (e) {
                console.error("JIT File fetch failed", e);
            }
        }

        const currentContent = getActiveFileContent();
        let context = activeFilePath
            ? `Active File: ${activeFilePath}\n\nContent:\n${currentContent || ''}`
            : "No file currently open.";

        if (filesList.length > 0) {
            const relativePaths = filesList.map(f => f.replace(projectRoot || '', ''));
            context += `\n\nProject Structure (Total: ${relativePaths.length}):\n${relativePaths.slice(0, 1000).join('\n')}`;
        }

        let rulesContent = '';
        if (projectRoot) {
            try {
                rulesContent = await window.ipcRenderer.invoke('fs:readFile', `${projectRoot}/.singularity/rules.md`);
            } catch { /* no rules file */ }
        }

        const systemPrompt = `You are Singularity, an advanced AI coding agent integrated into a custom IDE.
You are helpful, concise, and expert at coding.

CAPABILITIES:
1.  **View Context**: You have access to the currently active file and the project structure (provided below).
2.  **Edit/Create Files**: You can create or overwrite files by outputting a special block.
    To write a file, use this exact format:

    <<<FILE: path/to/file.ext>>>
    File content goes here...
    <<<END>>>

    You can output multiple file blocks in a single response to create multiple files.
    Always use forward slashes (/) for paths.
3.  **Use Tools**: You have access to MCP tools. Use them when they can help accomplish the task.
${rulesContent ? `\nPROJECT RULES:\n${rulesContent}\n` : ''}
Current File Context:
${context}`;

        return systemPrompt;
    };

    /**
     * Process file writes in AI responses
     */
    const processFileWrites = (content: string) => {
        const fileBlockRegex = /<<<FILE: (.*?)>>>([\s\S]*?)<<<END>>>/g;
        let match;
        const writes: Array<{ filePath: string; content: string }> = [];
        while ((match = fileBlockRegex.exec(content)) !== null) {
            writes.push({ filePath: match[1].trim(), content: match[2].trim() });
        }

        if (writes.length > 0 && projectRoot) {
            (async () => {
                let systemMsg = "";
                for (const write of writes) {
                    try {
                        const targetPath = write.filePath.startsWith(projectRoot)
                            ? write.filePath
                            : `${projectRoot}/${write.filePath}`.replace(/\\/g, '/').replace(/\/+/g, '/');
                        await window.ipcRenderer.invoke('fs:writeFile', targetPath, write.content);
                        systemMsg += `\n[Agent] Created/Updated: ${write.filePath}`;
                    } catch {
                        systemMsg += `\n[Agent] Failed to write: ${write.filePath}`;
                    }
                }
                if (systemMsg) {
                    setMessages(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'assistant') {
                            return [...prev.slice(0, -1), { ...last, content: last.content + `\n\n_${systemMsg}_` }];
                        }
                        return prev;
                    });
                }
            })();
        }
    };

    /**
     * Tool-calling send: uses modelService.toolCall() + MCP tool execution loop
     */
    const handleToolCallingSend = async (
        apiMessages: Array<{ role: string; content: string }>,
        systemPrompt: string,
        resolvedModel: string,
        mcpTools: Array<{ name: string; registryName: string; description: string; parameters: any }>
    ) => {
        toolCallAbortRef.current = false;
        const MAX_ITERATIONS = 10;

        // Build tools array for the model service
        const toolDefs = mcpTools.map(t => ({
            name: t.registryName,
            description: t.description,
            parameters: t.parameters,
            execute: async () => ({ success: true }), // placeholder — execution happens via IPC
        }));

        let conversationMessages = [...apiMessages];
        let iteration = 0;

        while (iteration < MAX_ITERATIONS && !toolCallAbortRef.current) {
            iteration++;
            setStreamContent('Thinking...');

            let response: any;
            try {
                response = await (window as any).modelService.toolCall({
                    messages: conversationMessages,
                    model: resolvedModel,
                    systemPrompt,
                    maxTokens: 4096,
                    temperature: 0.7,
                    tools: toolDefs,
                });
            } catch (err: any) {
                setMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: `Error: ${err.message || 'Tool call failed'}`
                }]);
                break;
            }

            // No tool calls — final text response
            if (!response.toolCalls || response.toolCalls.length === 0) {
                const aiMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: response.content || '',
                    model: response.model,
                    usage: response.usage,
                };
                setMessages(prev => [...prev, aiMsg]);
                processFileWrites(response.content || '');
                break;
            }

            // Execute tool calls
            const toolCallResults: Array<{ name: string; status: 'running' | 'done' | 'error'; result?: string; duration?: number; args?: Record<string, any> }> = [];

            // Show the assistant's partial content + running tool calls
            const partialMsg: Message = {
                id: `tc-${Date.now()}`,
                role: 'assistant',
                content: response.content || '',
                toolCalls: response.toolCalls.map((tc: any) => {
                    const args = typeof tc.function?.arguments === 'string'
                        ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })()
                        : tc.function?.arguments || {};
                    return {
                        name: tc.function?.name || tc.name || 'unknown',
                        status: 'running' as const,
                        args,
                    };
                }),
            };
            setMessages(prev => [...prev, partialMsg]);
            setStreamContent('');

            // Execute each tool call
            for (let i = 0; i < response.toolCalls.length; i++) {
                if (toolCallAbortRef.current) break;
                const tc = response.toolCalls[i];
                const toolName = tc.function?.name || tc.name;
                const toolArgs = typeof tc.function?.arguments === 'string'
                    ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })()
                    : tc.function?.arguments || {};

                const startTime = Date.now();
                try {
                    const result = await (window as any).mcp.callTool(toolName, toolArgs);
                    const duration = Date.now() - startTime;
                    toolCallResults.push({
                        name: toolName,
                        status: result.success ? 'done' : 'error',
                        result: result.data || result.error || '',
                        duration,
                        args: toolArgs,
                    });
                } catch (err: any) {
                    toolCallResults.push({
                        name: toolName,
                        status: 'error',
                        result: err.message,
                        duration: Date.now() - startTime,
                        args: toolArgs,
                    });
                }

                // Update the message in-place with completed tool calls
                setMessages(prev => {
                    const idx = prev.findIndex(m => m.id === partialMsg.id);
                    if (idx < 0) return prev;
                    const updated = { ...prev[idx], toolCalls: [...toolCallResults] };
                    // Mark remaining tools as still running
                    for (let j = toolCallResults.length; j < response.toolCalls.length; j++) {
                        const remainingTc = response.toolCalls[j];
                        const remainingArgs = typeof remainingTc.function?.arguments === 'string'
                            ? (() => { try { return JSON.parse(remainingTc.function.arguments); } catch { return {}; } })()
                            : remainingTc.function?.arguments || {};
                        updated.toolCalls!.push({
                            name: remainingTc.function?.name || remainingTc.name || 'unknown',
                            status: 'running',
                            args: remainingArgs,
                        });
                    }
                    return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
                });
            }

            // Build tool result messages for the next iteration
            conversationMessages = [
                ...conversationMessages,
                { role: 'assistant', content: response.content || '' },
            ];

            for (let i = 0; i < response.toolCalls.length; i++) {
                const tc = response.toolCalls[i];
                const result = toolCallResults[i];
                conversationMessages.push({
                    role: 'tool' as any,
                    content: JSON.stringify({ result: result?.result || '', success: result?.status === 'done' }),
                    ...(tc.id ? { toolCallId: tc.id, name: tc.function?.name } : {}),
                } as any);
            }
        }

        setStreamContent('');
        setIsStreaming(false);
        abortRef.current = null;
    };

    const handleSend = async () => {
        if (!input.trim() || isStreaming) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input
        };

        const newMessages = [...messages, userMsg];
        setMessages(newMessages);
        setInput('');
        setIsStreaming(true);
        setStreamContent('');

        try {
            const systemPrompt = await buildContext();
            const resolvedModel = resolveModelId(selectedModel);

            // Build messages for the API
            const apiMessages = newMessages
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({
                    role: m.role as 'user' | 'assistant',
                    content: m.content
                }));

            // Check for MCP tools — use tool-calling path if available
            let mcpTools: any[] = [];
            try {
                mcpTools = await (window as any).mcp?.getTools?.() || [];
            } catch { /* no MCP */ }

            if (mcpTools.length > 0) {
                await handleToolCallingSend(apiMessages, systemPrompt, resolvedModel, mcpTools);
                return;
            }

            // Fallback: streaming path (no tools)
            let fullContent = '';

            const cleanup = (window as any).modelService.stream(
                {
                    messages: apiMessages,
                    model: resolvedModel,
                    systemPrompt,
                    maxTokens: 4096,
                    temperature: 0.7
                },
                {
                    onChunk: (chunk: any) => {
                        if (chunk.type === 'content' && chunk.content) {
                            fullContent += chunk.content;
                            setStreamContent(fullContent);
                        }
                    },
                    onDone: (response: any) => {
                        processFileWrites(fullContent);
                        const aiMsg: Message = {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: fullContent,
                            model: response?.model,
                            usage: response?.usage
                        };
                        setMessages(prev => [...prev, aiMsg]);
                        setStreamContent('');
                        setIsStreaming(false);
                        abortRef.current = null;
                    },
                    onError: (error: any) => {
                        if (fullContent) {
                            setMessages(prev => [...prev, {
                                id: (Date.now() + 1).toString(),
                                role: 'assistant',
                                content: fullContent + `\n\n_[Stream interrupted: ${error.message}]_`
                            }]);
                        } else {
                            setMessages(prev => [...prev, {
                                id: (Date.now() + 1).toString(),
                                role: 'assistant',
                                content: `Error: ${error.message || 'Failed to connect to AI service.'}`
                            }]);
                        }
                        setStreamContent('');
                        setIsStreaming(false);
                        abortRef.current = null;
                    }
                }
            );

            abortRef.current = cleanup;
        } catch (error: any) {
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Error: ${error.message || 'Failed to connect to AI service.'}`
            }]);
            setIsStreaming(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-full glass border-l-0">
            {/* Header */}
            <div className="p-3 border-b border-[var(--border-primary)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Bot size={18} className="text-[var(--accent-primary)]" />
                    <span className="font-semibold text-[var(--text-secondary)] text-sm">Singularity AI</span>
                </div>
                <div className="flex items-center gap-2">
                    {mcpToolCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-[var(--success)] bg-[var(--success)]/10 px-1.5 py-0.5 rounded-full" title={`${mcpToolCount} MCP tool${mcpToolCount !== 1 ? 's' : ''} available`}>
                            <Wrench size={10} />
                            {mcpToolCount}
                        </span>
                    )}
                    <button onClick={() => setIsSettingsOpen(true)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        <Settings size={16} />
                    </button>
                </div>
            </div>

            {/* Model Selector */}
            <div className="px-3 py-2 border-b border-[var(--border-primary)]">
                <ModelSelector
                    selectedModel={selectedModel}
                    onModelChange={setSelectedModel}
                    compact
                />
            </div>

            <APIKeyModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map(msg => (
                    <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-[var(--bg-tertiary)]' : 'bg-[var(--accent-bg)]'}`}>
                            {msg.role === 'user' ? <User size={14} /> : <Bot size={14} className="text-[var(--accent-primary)]" />}
                        </div>
                        <div className={`rounded-lg p-3 text-sm max-w-[85%] ${msg.role === 'user' ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'}`}>
                            {msg.role === 'user' ? (
                                msg.content
                            ) : (
                                <>
                                    <ReactMarkdown
                                        components={{
                                            code({ inline, className, children, ...props }: any) {
                                                const match = /language-(\w+)/.exec(className || '');
                                                const codeString = String(children).replace(/\n$/, '');
                                                if (!inline && match) {
                                                    return <CodeBlock language={match[1]} code={codeString} onApply={onApplyCode || undefined} />;
                                                }
                                                return <code className={`bg-[var(--bg-hover)] px-1 py-0.5 rounded ${className}`} {...props}>{children}</code>;
                                            }
                                        }}
                                    >
                                        {msg.content}
                                    </ReactMarkdown>
                                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                                        <div className="mt-2">
                                            {msg.toolCalls.map((tc, idx) => (
                                                <ToolCallBubble
                                                    key={`${msg.id}-tc-${idx}`}
                                                    toolCall={{
                                                        id: `${msg.id}-tc-${idx}`,
                                                        name: tc.name.replace(/^mcp__[^_]+__/, ''),
                                                        args: tc.args,
                                                        status: tc.status,
                                                        result: tc.result,
                                                        durationMs: tc.duration,
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {msg.usage && (
                                        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[var(--bg-hover)] text-[10px] text-[var(--text-muted)]">
                                            <span>{msg.usage.totalTokens} tokens</span>
                                            {msg.usage.estimatedCost !== undefined && (
                                                <span>${msg.usage.estimatedCost.toFixed(4)}</span>
                                            )}
                                            {msg.model && <span>{msg.model.split(':').pop()}</span>}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                ))}

                {/* Streaming message */}
                {isStreaming && (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--accent-bg)] flex items-center justify-center shrink-0">
                            <Bot size={14} className="text-[var(--accent-primary)]" />
                        </div>
                        <div className="rounded-lg p-3 text-sm max-w-[85%] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                            {streamContent ? (
                                <ReactMarkdown
                                    components={{
                                        code({ inline, className, children, ...props }: any) {
                                            const match = /language-(\w+)/.exec(className || '');
                                            const codeString = String(children).replace(/\n$/, '');
                                            if (!inline && match) {
                                                return <CodeBlock language={match[1]} code={codeString} />;
                                            }
                                            return <code className={`bg-[var(--bg-hover)] px-1 py-0.5 rounded ${className}`} {...props}>{children}</code>;
                                        }
                                    }}
                                >
                                    {streamContent}
                                </ReactMarkdown>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <Sparkles size={14} className="text-[var(--accent-primary)] animate-pulse" />
                                    <span className="text-[var(--text-secondary)] text-xs">Thinking...</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-[var(--border-primary)]">
                <div className="relative">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask Singularity..."
                        className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg pl-3 pr-10 py-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] min-h-[44px] max-h-32"
                        rows={1}
                        disabled={isStreaming}
                    />
                    {isStreaming ? (
                        <button
                            onClick={handleStop}
                            className="absolute right-2 bottom-2 p-1.5 bg-[var(--error)] text-[var(--text-primary)] rounded-md hover:bg-[var(--error)] transition-colors"
                            title="Stop generation"
                        >
                            <StopCircle size={14} />
                        </button>
                    ) : (
                        <button
                            onClick={handleSend}
                            disabled={!input.trim()}
                            className="absolute right-2 bottom-2 p-1.5 bg-[var(--accent-primary)] text-[var(--text-primary)] rounded-md hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Send size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
});

export default AIChatPane;
