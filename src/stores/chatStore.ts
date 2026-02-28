import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost?: number };
  timestamp: number;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamContent: string;
  selectedModel: string;

  addMessage: (msg: Omit<ChatMessage, 'timestamp'>) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  clearMessages: () => void;
  setStreaming: (streaming: boolean) => void;
  setStreamContent: (content: string) => void;
  setSelectedModel: (model: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  streamContent: '',
  selectedModel: localStorage.getItem('singularity_selected_model') || 'claude-sonnet-4-6',

  addMessage: (msg) => set((state) => ({
    messages: [...state.messages, { ...msg, timestamp: Date.now() }]
  })),

  setMessages: (msgs) => set({ messages: msgs }),
  clearMessages: () => set({ messages: [] }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setStreamContent: (content) => set({ streamContent: content }),

  setSelectedModel: (model) => {
    localStorage.setItem('singularity_selected_model', model);
    set({ selectedModel: model });
  }
}));
