
export type AIProvider = 'openai' | 'gemini' | 'anthropic' | 'xai' | 'deepseek' | 'kimi' | 'qwen';

export interface AIMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface ProviderConfig {
    url: string;
    model: string;
    headers: (apiKey: string) => Record<string, string>;
    formatBody: (messages: AIMessage[], systemPrompt: string, model: string) => Record<string, unknown>;
    extractContent: (data: any) => string;
}

const formatOpenAICompatible = (messages: AIMessage[], systemPrompt: string, model: string) => ({
    model,
    messages: [
        { role: 'system', content: systemPrompt },
        ...messages
    ],
    temperature: 0.7
});

const PROVIDERS: Record<string, ProviderConfig> = {
    openai: {
        url: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o',
        headers: (k) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }),
        formatBody: formatOpenAICompatible,
        extractContent: (d) => d.choices[0].message.content
    },
    xai: {
        url: 'https://api.x.ai/v1/chat/completions',
        model: 'grok-beta',
        headers: (k) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }),
        formatBody: formatOpenAICompatible,
        extractContent: (d) => d.choices[0].message.content
    },
    deepseek: {
        url: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-chat',
        headers: (k) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }),
        formatBody: formatOpenAICompatible,
        extractContent: (d) => d.choices[0].message.content
    },
    kimi: {
        url: 'https://api.moonshot.cn/v1/chat/completions',
        model: 'moonshot-v1-8k',
        headers: (k) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }),
        formatBody: formatOpenAICompatible,
        extractContent: (d) => d.choices[0].message.content
    },
    qwen: {
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        model: 'qwen-plus',
        headers: (k) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }),
        formatBody: formatOpenAICompatible,
        extractContent: (d) => d.choices[0].message.content
    },
    anthropic: {
        url: 'https://api.anthropic.com/v1/messages',
        model: 'claude-3-5-sonnet-20241022',
        headers: (k) => ({
            'Content-Type': 'application/json',
            'x-api-key': k,
            'anthropic-version': '2023-06-01'
        }),
        formatBody: (messages, systemPrompt, model) => ({
            model,
            system: systemPrompt,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            max_tokens: 4096
        }),
        extractContent: (d) => d.content[0].text
    }
};

export const generateResponse = async (
    messages: AIMessage[],
    context: string,
    apiKey: string,
    provider: AIProvider
): Promise<string> => {

    const systemPrompt = `You are Singularity, an advanced AI coding agent integrated into a custom IDE.
    You are helpful, concise, and expert at coding.

    CAPABILITIES:
    1.  **View Context**: You have access to the currently active file and the project structure (provided below).
    2.  **Edit/Create Files**: You can create or overwrite files by outputting a special block.
        To write a file, use this exact format:
        
        <<<FILE: path/to/file.ext>>>
        File content goes here...
        <<<END>>>

        Example:
        <<<FILE: src/components/Button.tsx>>>
        import React from 'react';
        export const Button = () => <button>Click me</button>;
        <<<END>>>

        You can output multiple file blocks in a single response to create multiple files.
        Always use forward slashes (/) for paths.
    
    Current File Context:
    ${context}
    `;

    try {
        if (provider === 'gemini') {
            // Basic Gemini implementation (Google AI Studio)
            // Gemini doesn't strictly follow "system" role in the same way as OpenAI in `contents` array for v1beta usually
            // But we can prepend it.

            const geminiContent = [
                { role: 'user', parts: [{ text: systemPrompt }] },
                { role: 'model', parts: [{ text: "Understood. I am ready to help." }] },
                ...messages.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                }))
            ];

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: geminiContent
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || 'Failed to fetch from Gemini');
            }

            const data = await response.json();
            return data.candidates[0].content.parts[0].text;
        }

        const config = PROVIDERS[provider];
        if (!config) throw new Error(`Provider ${provider} not configured`);

        const response = await fetch(config.url, {
            method: 'POST',
            headers: config.headers(apiKey),
            body: JSON.stringify(config.formatBody(messages, systemPrompt, config.model))
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(err.error?.message || `Failed to fetch from ${provider}`);
        }

        const data = await response.json();
        return config.extractContent(data);

    } catch (error: any) {
        console.error("AI Service Error:", error);
        return `Error (${provider}): ${error.message}`;
    }
};
