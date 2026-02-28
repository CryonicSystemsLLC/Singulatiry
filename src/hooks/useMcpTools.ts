import { useState, useEffect } from 'react';

/**
 * Track available MCP tools and their count.
 * Subscribes to tool-change events so the count stays current.
 */
export function useMcpTools() {
    const [toolCount, setToolCount] = useState(0);

    useEffect(() => {
        let mounted = true;
        const checkTools = async () => {
            try {
                const tools = await (window as any).mcp?.getTools?.();
                if (mounted) setToolCount(tools?.length || 0);
            } catch { /* no MCP available */ }
        };
        checkTools();
        const unsub = (window as any).mcp?.onToolsChanged?.(() => checkTools());
        return () => { mounted = false; unsub?.(); };
    }, []);

    return toolCount;
}
