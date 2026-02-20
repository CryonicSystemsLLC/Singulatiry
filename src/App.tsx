import { useState, useCallback, useRef, useEffect } from 'react';
import CodeEditor, { CodeEditorRef } from './components/CodeEditor';
import Sidebar from './components/Sidebar';
import ActivityBar, { SidebarView } from './components/ActivityBar';
import TerminalPane from './components/TerminalPane';
import AIChatPane from './components/AIChatPane';
import QuickOpen from './components/QuickOpen';


function App() {
  const [initialFileContent, setInitialFileContent] = useState('// Singularity v1.5.3\nconsole.log("Hello World");');
  const codeRef = useRef(initialFileContent);
  const editorRef = useRef<CodeEditorRef>(null);

  const getActiveContent = useCallback(() => codeRef.current, []);

  const [currentFile, setCurrentFile] = useState('App.tsx');
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<SidebarView>('explorer');
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);

  // Listen for Go to File menu
  useEffect(() => {
    const handleGoToFile = () => {
      setIsQuickOpenOpen(true);
      // JIT Fetch for Quick Open
      if (projectRoot) {
        window.ipcRenderer.invoke('fs:listAllFiles', projectRoot).then(setProjectFiles).catch(console.error);
      }
    };

    const handleStartDebugging = () => {
      setActiveView('debug');
    };

    const handleOpenFolder = async () => {
      const path = await window.ipcRenderer.invoke('dialog:openDirectory');
      if (path) {
        setProjectRoot(path);
        setProjectFiles([]); // Clear cache
      }
    };

    const handleNewFile = () => {
      setProjectRoot(null); // Simple reset for now, or could create actual file
      setInitialFileContent('');
      setCurrentFile('Untitled');
      setCurrentFilePath(null);
      if (editorRef.current) {
        editorRef.current.setValue('');
        codeRef.current = '';
      }
    };

    window.ipcRenderer.on('menu:go-to-file', handleGoToFile);
    window.ipcRenderer.on('menu:start-debugging', handleStartDebugging);
    window.ipcRenderer.on('menu:open-folder', handleOpenFolder);
    window.ipcRenderer.on('menu:new-file', handleNewFile);

    return () => {
      window.ipcRenderer.removeListener('menu:go-to-file', handleGoToFile);
      window.ipcRenderer.removeListener('menu:start-debugging', handleStartDebugging);
      window.ipcRenderer.removeListener('menu:open-folder', handleOpenFolder);
      window.ipcRenderer.removeListener('menu:new-file', handleNewFile);
    };
  }, [projectRoot]); // Dep on projectRoot to fetch files

  // Optimize handlers to prevent Sidebar re-renders
  const handleFileSelect = useCallback((path: string, content: string) => {
    codeRef.current = content;
    setInitialFileContent(content);
    // Extract filename from path for the tab
    const filename = path.split(/[\\/]/).pop() || 'Untitled';
    setCurrentFile(filename);
    setCurrentFilePath(path);
  }, []); // No deps needed as state setters are stable

  const handleFileSave = useCallback(async (content: string) => {
    if (currentFilePath) {
      try {
        await window.ipcRenderer.invoke('fs:writeFile', currentFilePath, content);
        console.log('Saved!');
      } catch (e) {
        console.error('Failed to save', e);
      }
    }
  }, [currentFilePath]);

  const handleApplyCode = useCallback((newCode: string) => {
    if (editorRef.current) {
      editorRef.current.setValue(newCode);
      // Update ref immediately ensuring sync
      codeRef.current = newCode;
    }
  }, []);

  return (
    <div className="flex h-screen w-screen bg-[#1e1e1e] text-white overflow-hidden">
      {/* Activity Bar */}
      <ActivityBar activeView={activeView} onViewChange={setActiveView} />

      {/* Sidebar (Content Panel) */}
      <Sidebar
        activeView={activeView}
        onFileSelect={handleFileSelect}
        rootPath={projectRoot}
        onRootChange={setProjectRoot}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-[#0d0d12]/50">
        {/* Tabs / Header */}
        <div className="h-10 border-b border-white/5 flex items-center px-4 text-sm text-gray-400 shrink-0">
          <span className="bg-[#27272a]/50 backdrop-blur px-3 py-1 rounded-t text-gray-200 text-xs flex items-center gap-2 border-t border-l border-r border-white/5">
            {currentFile}
            {currentFilePath && <span className="text-[10px] opacity-50 ml-2 hover:opacity-100 cursor-help" title={currentFilePath}>path</span>}
          </span>
        </div>

        {/* Editor Area */}
        <div className="flex-1 relative min-h-0">
          <CodeEditor
            ref={editorRef}
            initialValue={initialFileContent}
            onChange={(val) => { codeRef.current = val || ''; }}
            onSave={handleFileSave}
          />
        </div>

        {/* Terminal Pane - Fixed height */}
        <div className="h-48 border-t border-white/5 shrink-0">
          <TerminalPane />
        </div>

        {/* Status Bar Removed */}
      </div>

      {/* AI Chat Pane (Right Sidebar) */}
      <div className="w-80 h-full border-l border-[#27272a]">
        <AIChatPane
          getActiveFileContent={getActiveContent}
          activeFilePath={currentFilePath}
          onApplyCode={handleApplyCode}
          projectRoot={projectRoot}
        />
      </div>
      {/* Quick Open Modal */}
      <QuickOpen
        isOpen={isQuickOpenOpen}
        onClose={() => setIsQuickOpenOpen(false)}
        files={projectFiles}
        onSelect={async (path) => {
          // Read file content
          try {
            const content = await window.ipcRenderer.invoke('fs:readFile', path);
            handleFileSelect(path, content);
          } catch (e) { console.error(e); }
        }}
        projectRoot={projectRoot}
      />
    </div>
  );
}

export default App;
