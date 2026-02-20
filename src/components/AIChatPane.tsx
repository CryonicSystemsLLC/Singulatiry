import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Settings, Terminal } from 'lucide-react';
import { generateResponse, AIMessage } from '../services/ai';
import SettingsModal from './SettingsModal';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
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
    const [isTyping, setIsTyping] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Initial Greeting & API Key Check
    useEffect(() => {
        // Run this check on mount and whenever the settings modal closes
        if (!isSettingsOpen) {
            const apiKey = localStorage.getItem('singularity_api_key');
            setMessages(prev => {
                const hasConfigMessage = prev.some(m => m.content.includes("Please configure your API key"));
                const hasHelloMessage = prev.some(m => m.content.includes("Hello! I am Singularity"));

                if (!apiKey) {
                    if (prev.length === 0 || (!hasConfigMessage && prev.length === 1 && hasHelloMessage)) {
                        return [{ id: 'system-1', role: 'assistant', content: 'Please configure your API key in settings first to use Singularity AI.' }];
                    }
                    return prev;
                } else {
                    if (hasConfigMessage) {
                        return [{ id: 'system-2', role: 'assistant', content: 'Hello! I am Singularity. How can I help you with your code today?' }];
                    }
                    if (prev.length === 0) {
                        return [{ id: 'system-2', role: 'assistant', content: 'Hello! I am Singularity. How can I help you with your code today?' }];
                    }
                    return prev;
                }
            });
        }
    }, [isSettingsOpen]);

    // Event Listener for "Ask AI to Fix" from Editor
    useEffect(() => {
        const handleAskAi = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail) {
                const prompt = `Fix this code:\n\`\`\`\n${detail}\n\`\`\`\nExplain what was wrong.`;
                setInput(prompt);

                // Focus the input area so user sees it
                if (inputRef.current) {
                    inputRef.current.focus();
                }
            }
        };
        window.addEventListener('singularity:ask-ai', handleAskAi);
        return () => window.removeEventListener('singularity:ask-ai', handleAskAi);
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSend = async () => {
        if (!input.trim()) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input
        };

        const newMessages = [...messages, userMsg];
        setMessages(newMessages);
        setInput('');
        setIsTyping(true);

        const apiKey = localStorage.getItem('singularity_api_key');
        const provider = (localStorage.getItem('singularity_provider') as 'openai' | 'gemini') || 'openai';

        if (!apiKey) {
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: "Please configure your API key in settings first."
            }]);
            setIsTyping(false);
            return;
        }

        try {
            // JIT Context Loading: Fetch files ONLY when sending
            // This prevents main-thread blocking during idle time.
            let filesList: string[] = [];
            if (projectRoot) {
                try {
                    // We invoke this just-in-time. It might take a moment for large repos, 
                    // but it saves the UI from lagging while typing.
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
                // Optimize context: Only send first 500 files or filtered list to avoid token limits
                // For now, we send relative paths
                const relativePaths = filesList.map(f => f.replace(projectRoot || '', ''));
                context += `\n\nProject Structure (Total: ${relativePaths.length}):\n${relativePaths.slice(0, 1000).join('\n')}`;
            }

            const aiMessages: AIMessage[] = newMessages.map(m => ({
                role: m.role,
                content: m.content
            }));

            const response = await generateResponse(aiMessages, context, apiKey, provider);

            // Agentic: Parse response for File Writes
            const fileBlockRegex = /<<<FILE: (.*?)>>>([\s\S]*?)<<<END>>>/g;
            let match;
            const writes = [];
            while ((match = fileBlockRegex.exec(response)) !== null) {
                const [_, filePath, content] = match;
                writes.push({ filePath: filePath.trim(), content: content.trim() });
            }

            // Execute Writes
            let systemMsg = "";
            if (writes.length > 0 && projectRoot) {
                for (const write of writes) {
                    try {
                        // Normalize path
                        const targetPath = write.filePath.startsWith(projectRoot)
                            ? write.filePath
                            : `${projectRoot}/${write.filePath}`.replace(/\\/g, '/').replace(/\/+/g, '/'); // simple join

                        await window.ipcRenderer.invoke('fs:writeFile', targetPath, write.content);
                        systemMsg += `\n[Agent] Created/Updated: ${write.filePath}`;
                    } catch (err) {
                        systemMsg += `\n[Agent] Failed to write: ${write.filePath}`;
                    }
                }
            }

            const aiMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response + (systemMsg ? `\n\n_${systemMsg}_` : "")
            };
            setMessages(prev => [...prev, aiMsg]);
        } catch (error) {
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: "Error connecting to AI service."
            }]);
        } finally {
            setIsTyping(false);
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
            <div className="p-3 border-b border-[#27272a] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Bot size={18} className="text-purple-400" />
                    <span className="font-semibold text-gray-200 text-sm">Singularity AI</span>
                </div>
                <button onClick={() => setIsSettingsOpen(true)} className="text-gray-400 hover:text-white transition-colors">
                    <Settings size={16} />
                </button>
            </div>

            <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map(msg => (
                    <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-[#27272a]' : 'bg-purple-900/30'}`}>
                            {msg.role === 'user' ? <User size={14} /> : <Bot size={14} className="text-purple-400" />}
                        </div>
                        <div className={`rounded-lg p-3 text-sm max-w-[85%] ${msg.role === 'user' ? 'bg-[#3f3f46] text-white' : 'bg-[#27272a] text-gray-300'}`}>
                            {msg.role === 'user' ? (
                                msg.content
                            ) : (
                                <ReactMarkdown
                                    components={{
                                        code({ inline, className, children, ...props }: any) {
                                            const match = /language-(\w+)/.exec(className || '');
                                            const codeString = String(children).replace(/\n$/, '');

                                            if (!inline && match) {
                                                return (
                                                    <div className="relative group my-2 rounded-md overflow-hidden bg-[#1e1e1e] border border-[#3f3f46]">
                                                        <div className="flex justify-between items-center px-3 py-1.5 bg-[#27272a] border-b border-[#3f3f46]">
                                                            <span className="text-xs text-gray-400">{match[1]}</span>
                                                            {onApplyCode && (
                                                                <button
                                                                    onClick={() => onApplyCode(codeString)}
                                                                    className="flex items-center gap-1 text-[10px] bg-purple-600 hover:bg-purple-500 text-white px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                                                >
                                                                    <Terminal size={10} />
                                                                    Apply
                                                                </button>
                                                            )}
                                                        </div>
                                                        <SyntaxHighlighter
                                                            style={vscDarkPlus}
                                                            language={match[1]}
                                                            PreTag="div"
                                                            customStyle={{ margin: 0, padding: '12px', background: 'transparent' }}
                                                        >
                                                            {codeString}
                                                        </SyntaxHighlighter>
                                                    </div>
                                                );
                                            }
                                            return <code className={`bg-[#3f3f46] px-1 py-0.5 rounded ${className}`} {...props}>{children}</code>;
                                        }
                                    }}
                                >
                                    {msg.content}
                                </ReactMarkdown>
                            )}
                        </div>
                    </div>
                ))}
                {isTyping && (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-900/30 flex items-center justify-center shrink-0">
                            <Bot size={14} className="text-purple-400" />
                        </div>
                        <div className="flex items-center gap-1 h-8">
                            <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"></span>
                            <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce delay-75"></span>
                            <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce delay-150"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-[#27272a]">
                <div className="relative">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask Singularity..."
                        className="w-full bg-[#27272a] text-white rounded-lg pl-3 pr-10 py-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-purple-500 min-h-[44px] max-h-32"
                        rows={1}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim()}
                        className="absolute right-2 bottom-2 p-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Send size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
});

export default AIChatPane;
