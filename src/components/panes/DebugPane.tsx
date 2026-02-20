import React, { useEffect, useState } from 'react';
import { Play, Loader2, RefreshCw } from 'lucide-react';

interface DebugPaneProps {
    rootPath: string | null;
}

const DebugPane: React.FC<DebugPaneProps> = ({ rootPath }) => {
    const [scripts, setScripts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [runningScript, setRunningScript] = useState<string | null>(null);
    const [output, setOutput] = useState<string>('');

    const loadScripts = async () => {
        if (!rootPath) {
            setScripts({});
            return;
        }
        setLoading(true);
        try {
            const pkgPath = `${rootPath}\\package.json`;
            const content = await window.ipcRenderer.invoke('fs:readFile', pkgPath);
            const pkg = JSON.parse(content);
            setScripts(pkg.scripts || {});
        } catch (e) {
            console.error('Failed to load scripts', e);
            setScripts({});
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadScripts();
    }, [rootPath]); // Reload when rootPath changes

    const runScript = async (name: string) => {
        if (runningScript) return;
        setRunningScript(name);
        setOutput(`> Running "${name}"...\n`);

        try {
            if (!rootPath) return;
            const cmd = `npm run ${name}`;
            const res = await window.ipcRenderer.invoke('os:runCommand', cmd, rootPath);
            setOutput(prev => prev + (res.success ? res.output : `Error:\n${res.output}`));
        } catch (e) {
            setOutput(prev => prev + `Failed to execute: ${e}`);
        } finally {
            setRunningScript(null);
        }
    };

    return (
        <div className="flex flex-col h-full p-4 overflow-hidden">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">NPM Scripts</h2>
                <button onClick={loadScripts} title="Refresh Scripts" className="text-gray-500 hover:text-white transition-colors">
                    <RefreshCw size={12} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto mb-4 border-b border-white/5 pb-4">
                {loading && <div className="flex justify-center"><Loader2 className="animate-spin text-purple-500" /></div>}

                {!loading && Object.keys(scripts).length === 0 && (
                    <div className="text-xs text-gray-500 text-center">No scripts found in package.json</div>
                )}

                {!loading && Object.entries(scripts).map(([name, cmd]) => (
                    <div key={name} className="flex items-center justify-between group hover:bg-white/5 p-2 rounded mb-1">
                        <div className="min-w-0">
                            <div className="text-sm text-gray-200 font-mono">{name}</div>
                            <div className="text-[10px] text-gray-500 truncate" title={cmd}>{cmd}</div>
                        </div>
                        <button
                            onClick={() => runScript(name)}
                            disabled={!!runningScript}
                            className={`p-1.5 rounded transition-colors ${runningScript === name ? 'bg-yellow-500/20 text-yellow-500 animate-pulse' : 'bg-green-600 hover:bg-green-500 text-white'}`}
                        >
                            <Play size={12} fill="currentColor" />
                        </button>
                    </div>
                ))}
            </div>

            <div className="h-1/3 bg-[#0d0d12] rounded p-2 text-[10px] font-mono whitespace-pre-wrap overflow-y-auto text-gray-400 border border-white/5">
                {output || '// Script output will appear here'}
                {runningScript && <span className="animate-pulse">_</span>}
            </div>
        </div>
    );
};

export default DebugPane;
