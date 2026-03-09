import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const TerminalPane = React.memo(() => {
    const terminalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new Terminal({
            theme: {
                background: '#1e1e1e',
                foreground: '#e0e0e0',
                cursor: '#ffffff',
            },
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', Consolas, 'Liberation Mono', monospace",
            fontSize: 13,
            rows: 10,
            convertEol: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(terminalRef.current);
        fitAddon.fit();

        // Initialize Backend — send initial cols/rows so the PTY matches xterm.js
        const initTerminal = async () => {
            try {
                const result = await window.ipcRenderer.invoke(
                    'terminal:create',
                    term.cols,
                    term.rows,
                );
                if (!result) {
                    term.writeln('\x1b[31mFailed to start shell.\x1b[0m');
                }
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

        // Right-click in terminal: copy selection or paste from clipboard
        const handleContextMenu = async (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const selection = term.getSelection();
            if (selection) {
                // If there's selected text, copy it to clipboard
                await navigator.clipboard.writeText(selection);
                term.clearSelection();
            } else {
                // If no selection, paste from clipboard
                try {
                    const text = await navigator.clipboard.readText();
                    if (text) {
                        window.ipcRenderer.send('terminal:write', text);
                    }
                } catch {
                    // Clipboard access denied — ignore
                }
            }
        };
        terminalRef.current.addEventListener('contextmenu', handleContextMenu);

        // Notify the PTY backend whenever xterm.js dimensions change
        const resizeDisposable = term.onResize(({ cols, rows }) => {
            window.ipcRenderer.send('terminal:resize', cols, rows);
        });

        // Resize handler — refit xterm.js when the window resizes
        const handleResize = () => fitAddon.fit();
        window.addEventListener('resize', handleResize);

        // IPC Listener for Menu Actions
        const handleNewTerminal = async () => {
            term.reset();
            await window.ipcRenderer.invoke('terminal:create', term.cols, term.rows);
            term.focus();
        };
        window.ipcRenderer.on('menu:new-terminal', handleNewTerminal);

        return () => {
            window.removeEventListener('resize', handleResize);
            window.ipcRenderer.removeListener('menu:new-terminal', handleNewTerminal);
            window.ipcRenderer.removeListener('terminal:incoming', handleTerminalData);
            terminalRef.current?.removeEventListener('contextmenu', handleContextMenu);
            resizeDisposable.dispose();
            term.dispose();
        };
    }, []);

    return (
        <div className="h-full bg-[var(--bg-primary)] border-t border-[var(--border-primary)] p-2">
            <div ref={terminalRef} className="h-full w-full" />
        </div>
    );
});

export default TerminalPane;
