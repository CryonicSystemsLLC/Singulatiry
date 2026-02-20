import React from 'react';
import { Files, Search, Puzzle, Play } from 'lucide-react';

export type SidebarView = 'explorer' | 'search' | 'extensions' | 'debug';

interface ActivityBarProps {
    activeView: SidebarView;
    onViewChange: (view: SidebarView) => void;
}

const ActivityBar = React.memo<ActivityBarProps>(({ activeView, onViewChange }) => {
    return (
        <div className="w-12 h-full bg-[#18181b] border-r border-[#27272a] flex flex-col items-center py-4 gap-6 shrink-0 z-20">
            <button
                onClick={() => onViewChange('explorer')}
                className={`p-2 rounded-md ${activeView === 'explorer' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                title="Explorer"
            >
                <Files size={24} strokeWidth={1.5} />
            </button>
            <button
                onClick={() => onViewChange('search')}
                className={`p-2 rounded-md ${activeView === 'search' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                title="Search"
            >
                <Search size={24} strokeWidth={1.5} />
            </button>
            <button
                onClick={() => onViewChange('extensions')}
                className={`p-2 rounded-md ${activeView === 'extensions' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                title="Extensions"
            >
                <Puzzle size={24} strokeWidth={1.5} />
            </button>
            <button
                onClick={() => onViewChange('debug')}
                className={`p-2 rounded-md ${activeView === 'debug' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                title="Run and Debug"
            >
                <Play size={24} strokeWidth={1.5} />
            </button>
        </div>
    );
});

export default ActivityBar;
