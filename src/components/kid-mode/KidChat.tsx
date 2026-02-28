import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Palette,
  Music,
  Image,
  Zap,
  ArrowLeft,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  RefreshCw
} from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface KidChatProps {
  onBack: () => void;
  onSendMessage: (message: string) => Promise<string>;
  presetContext?: string;
  initialMessages?: Message[];
}

const QUICK_ACTIONS = [
  { id: 'colors', label: 'Change Colors', icon: Palette, prompt: 'Can you change the colors to...' },
  { id: 'sound', label: 'Add Sound', icon: Music, prompt: 'Can you add a sound when...' },
  { id: 'image', label: 'Add Picture', icon: Image, prompt: 'Can you add a picture of...' },
  { id: 'feature', label: 'Add Feature', icon: Zap, prompt: 'Can you add...' }
];

const STARTER_PROMPTS = [
  "Can you make it more colorful?",
  "Can you add a button?",
  "Can you make it bigger?",
  "Can you add more levels?",
  "Can you make it faster?",
  "Can you add a score?"
];

export default function KidChat({
  onBack,
  onSendMessage,
  presetContext,
  initialMessages = []
}: KidChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showStarters, setShowStarters] = useState(messages.length === 0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Add welcome message on mount
  useEffect(() => {
    if (messages.length === 0) {
      const welcomeMessage: Message = {
        id: 'welcome',
        role: 'assistant',
        content: presetContext
          ? `Great choice! Let's create something awesome together. ${presetContext} What would you like it to do?`
          : "Hi there! I'm here to help you create something amazing. What would you like to build?",
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
    }
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setShowStarters(false);

    try {
      const response = await onSendMessage(input.trim());
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "Oops! Something went wrong. Let's try that again!",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  const handleStarterPrompt = (prompt: string) => {
    setInput(prompt);
    handleSend();
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#1a1a2e] to-[#16162a]">
      {/* Header */}
      <div className="flex items-center gap-4 p-4 border-b border-[var(--border-primary)]">
        <button
          onClick={onBack}
          className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
        >
          <ArrowLeft size={20} className="text-[var(--text-muted)]" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-semibold">AI Helper</h1>
            <p className="text-xs text-[var(--text-muted)]">Here to help you build</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {isLoading && (
          <div className="flex items-center gap-3 p-4 bg-[var(--bg-tertiary)] rounded-2xl max-w-[80%]">
            <Loader2 className="w-5 h-5 text-[var(--accent-primary)] animate-spin" />
            <span className="text-[var(--text-muted)]">Thinking...</span>
          </div>
        )}

        {/* Starter prompts */}
        {showStarters && !isLoading && (
          <div className="mt-4">
            <p className="text-sm text-[var(--text-muted)] mb-3">Try asking me something like:</p>
            <div className="flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleStarterPrompt(prompt)}
                  className="px-4 py-2 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-full text-sm hover:bg-[var(--bg-hover)] hover:text-white transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      <div className="px-4 py-2 border-t border-[var(--border-primary)]">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action.prompt)}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-full text-sm whitespace-nowrap hover:bg-[var(--bg-hover)] hover:text-white transition-colors"
              >
                <Icon size={16} />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[var(--border-primary)]">
        <div className="flex items-end gap-3">
          <div className="flex-1 bg-[var(--bg-tertiary)] rounded-2xl p-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type what you want to do..."
              className="w-full bg-transparent text-white placeholder-[var(--text-muted)] resize-none outline-none text-base"
              rows={1}
              disabled={isLoading}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="p-4 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl text-white disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-purple-500/25 transition-all"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface ChatMessageProps {
  message: Message;
}

function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] p-4 rounded-2xl ${
          isUser
            ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-br-md'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-bl-md'
        }`}
      >
        <p className="text-base leading-relaxed whitespace-pre-wrap">
          {message.content}
        </p>

        {/* Feedback buttons for assistant messages */}
        {!isUser && (
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-white/10">
            <button className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
              <ThumbsUp size={14} className="text-[var(--text-muted)]" />
            </button>
            <button className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
              <ThumbsDown size={14} className="text-[var(--text-muted)]" />
            </button>
            <button className="p-1.5 hover:bg-white/10 rounded-lg transition-colors ml-auto">
              <RefreshCw size={14} className="text-[var(--text-muted)]" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
