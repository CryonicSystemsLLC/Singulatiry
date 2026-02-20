import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const TerminalPane = React.memo(() => {
    const terminalRef = useRef<HTMLDivElement>(null);
    // const xtermRef = useRef<Terminal | null>(null); // Removed to fix unused variable lint

    useEffect(() => {
        if (!terminalRef.current) return;

        // Initialize Terminal
        const term = new Terminal({
            theme: {
                background: '#1e1e1e',
                foreground: '#e0e0e0',
                cursor: '#ffffff',
            },
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            fontSize: 13,
            rows: 10, // Initial rows
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(terminalRef.current);
        fitAddon.fit();

        // Welcome message
        term.writeln('\x1b[1;32mSingularity Terminal\x1b[0m');
        term.writeln('Powered by xterm.js');
        term.write('$ ');

        // Initialize Backend
        // We use an async function inside effect
        const initTerminal = async () => {
            try {
                await window.ipcRenderer.invoke('terminal:create');
                term.writeln('\x1b[32mTerminal Backend Connected.\x1b[0m');
                term.write('$ ');
            } catch (err) {
                term.writeln('\x1b[31mFailed to connect to backend shell.\x1b[0m');
                console.error(err);
            }
        };
        initTerminal();

        // IPC Listener for incoming terminal data
        const handleTerminalData = (_: any, data: string) => {
            term.write(data);
        };
        window.ipcRenderer.on('terminal:incoming', handleTerminalData);

        // Handle Input
        term.onData((data) => {
            window.ipcRenderer.send('terminal:write', data);
        });

        // Resize handler
        const handleResize = () => fitAddon.fit();
        window.addEventListener('resize', handleResize);

        // IPC Listener for Menu Actions
        const handleNewTerminal = async () => {
            await window.ipcRenderer.invoke('terminal:create');
            term.reset();
            term.writeln('\x1b[32mStarting new session...\x1b[0m');
            term.write('$ ');
            term.focus();
        };
        window.ipcRenderer.on('menu:new-terminal', handleNewTerminal);

        return () => {
            window.removeEventListener('resize', handleResize);
            window.ipcRenderer.removeListener('menu:new-terminal', handleNewTerminal);
            window.ipcRenderer.removeListener('terminal:incoming', handleTerminalData);
            term.dispose();
        };
    }, []);

    return (
        <div className="h-48 bg-[#1e1e1e] border-t border-[#27272a] p-2">
            <div ref={terminalRef} className="h-full w-full" />
        </div>
    );
});

export default TerminalPane;
