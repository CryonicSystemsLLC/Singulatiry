import React, { useState, useEffect } from 'react';
import { Search, Star, Loader2 } from 'lucide-react';

interface Extension {
    namespace: string;
    name: string;
    version: string;
    displayName: string;
    description: string;
    publisher: string;
    icon?: string;
}

const ExtensionsPane: React.FC = () => {
    const [query, setQuery] = useState('');
    const [extensions, setExtensions] = useState<Extension[]>([]);
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const fetchExtensions = async (searchQuery: string) => {
        setLoading(true);
        try {
            // Use Open VSX Registry API
            let url = 'https://open-vsx.org/api/-/search?size=20';
            if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;

            const req = await fetch(url);
            const data = await req.json();
            setExtensions(data.extensions || []);
        } catch (e) {
            console.error('Failed to fetch extensions', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchExtensions('');
    }, []);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchExtensions(query);
    };

    return (
        <div className="flex flex-col h-full p-4 overflow-hidden">
            <h2 className="text-xs font-bold text-gray-400 uppercase mb-4 tracking-wider">Extensions</h2>
            <form onSubmit={handleSearch} className="relative mb-4 shrink-0">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Marketplace..."
                    className="w-full bg-[#27272a] text-white text-sm rounded-md px-3 py-1.5 pl-8 border border-transparent focus:border-purple-500 focus:outline-none placeholder-gray-500"
                />
                <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" />
            </form>

            <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
                {loading && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-purple-500" /></div>}

                {/* Toast Notification */}
                {toast && (
                    <div className="fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded shadow-lg text-xs z-50 animate-fade-in">
                        {toast}
                    </div>
                )}

                {!loading && extensions.map((ext) => (
                    <div key={`${ext.namespace}.${ext.name}`} className="group flex gap-3 p-2 hover:bg-white/5 rounded cursor-pointer">
                        <div className="w-10 h-10 bg-[#27272a] rounded overflow-hidden shrink-0 flex items-center justify-center text-xs text-gray-500">
                            {/* Attempt to use icon if available, else placeholder */}
                            {ext.icon ? <img src={ext.icon} alt="" className="w-full h-full object-cover" /> : 'EXT'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-sm truncate text-gray-200">{ext.displayName || ext.name}</span>
                                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 rounded">{ext.version}</span>
                            </div>
                            <div className="text-xs text-gray-500 truncate">{ext.description}</div>
                            <div className="flex items-center gap-4 mt-2">
                                <button
                                    className="text-[10px] bg-[#007acc] hover:bg-[#0063a5] text-white px-2 py-0.5 rounded flex items-center gap-1 active:scale-95 transition-transform"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setToast(`Installing ${ext.displayName}... (Backend Coming Soon)`);
                                        setTimeout(() => setToast(null), 3000);
                                    }}
                                >
                                    Install
                                </button>
                                <span className="text-[10px] text-gray-500 flex items-center gap-1">
                                    <Star size={10} /> {ext.publisher}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ExtensionsPane;
