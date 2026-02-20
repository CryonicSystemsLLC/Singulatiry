import React, { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';

interface SearchPaneProps {
    rootPath: string | null;
}

const SearchPane: React.FC<SearchPaneProps> = ({ rootPath }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<{ path: string, preview: string }[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Quick fix: We will try to search the parent dir of current file or standard scratch dir.
    // Real fix: Pass rootPath to Sidebar -> Pane. 

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        setIsSearching(true);
        setResults([]);
        try {
            if (!rootPath) return;

            const res = await window.ipcRenderer.invoke('fs:search', rootPath, query);
            setResults(res);
        } catch (error) {
            console.error(error);
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div className="flex flex-col h-full p-4 overflow-hidden">
            <h2 className="text-xs font-bold text-gray-400 uppercase mb-4 tracking-wider">Search</h2>
            <form onSubmit={handleSearch} className="relative mb-4 shrink-0">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search in project..."
                    className="w-full bg-[#27272a] text-white text-sm rounded-md px-3 py-1.5 pl-8 border border-transparent focus:border-purple-500 focus:outline-none placeholder-gray-500"
                />
                <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" />
            </form>

            <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
                {isSearching && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-purple-500" /></div>}

                {!isSearching && results.map((res, i) => (
                    <div key={i} className="group cursor-pointer hover:bg-white/5 p-2 rounded">
                        <div className="text-xs text-purple-400 font-mono truncate" title={res.path}>
                            {res.path.split(/[\\/]/).pop()}
                        </div>
                        <div className="text-xs text-gray-400 mt-1 line-clamp-2 pl-2 border-l-2 border-white/10">
                            {res.preview}
                        </div>
                    </div>
                ))}

                {!isSearching && results.length === 0 && query && (
                    <div className="text-center text-gray-500 text-xs mt-4">No results found</div>
                )}
            </div>
        </div>
    );
};

export default SearchPane;
