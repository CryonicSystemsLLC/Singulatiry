import React, { useState, useMemo } from 'react';
import {
  Book,
  Search,
  Lock,
  Database,
  Palette,
  Server,
  TestTube,
  Upload,
  Zap,
  Settings,
  ChevronRight,
  Star,
  Filter
} from 'lucide-react';

export interface Recipe {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  tags: string[];
  compatibleStacks: string[];
  version: string;
  author?: string;
}

interface RecipeLibraryProps {
  recipes: Recipe[];
  currentStackId?: string;
  onSelectRecipe: (recipe: Recipe) => void;
  onClose?: () => void;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  authentication: <Lock size={16} />,
  database: <Database size={16} />,
  ui: <Palette size={16} />,
  api: <Server size={16} />,
  testing: <TestTube size={16} />,
  deployment: <Upload size={16} />,
  feature: <Zap size={16} />,
  utility: <Settings size={16} />
};

const CATEGORY_LABELS: Record<string, string> = {
  authentication: 'Authentication',
  database: 'Database',
  ui: 'UI & Styling',
  api: 'API',
  testing: 'Testing',
  deployment: 'Deployment',
  feature: 'Features',
  utility: 'Utilities'
};

export default function RecipeLibrary({
  recipes,
  currentStackId,
  onSelectRecipe,
  onClose
}: RecipeLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showCompatibleOnly, setShowCompatibleOnly] = useState(true);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(recipes.map(r => r.category));
    return Array.from(cats);
  }, [recipes]);

  // Filter recipes
  const filteredRecipes = useMemo(() => {
    return recipes.filter(recipe => {
      // Filter by search
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          recipe.name.toLowerCase().includes(query) ||
          recipe.description.toLowerCase().includes(query) ||
          recipe.tags.some(t => t.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      // Filter by category
      if (selectedCategory && recipe.category !== selectedCategory) {
        return false;
      }

      // Filter by compatibility
      if (showCompatibleOnly && currentStackId) {
        if (!recipe.compatibleStacks.includes('*') &&
            !recipe.compatibleStacks.includes(currentStackId)) {
          return false;
        }
      }

      return true;
    });
  }, [recipes, searchQuery, selectedCategory, showCompatibleOnly, currentStackId]);

  // Group by category
  const groupedRecipes = useMemo(() => {
    const groups: Record<string, Recipe[]> = {};
    for (const recipe of filteredRecipes) {
      if (!groups[recipe.category]) {
        groups[recipe.category] = [];
      }
      groups[recipe.category].push(recipe);
    }
    return groups;
  }, [filteredRecipes]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <Book size={20} className="text-[var(--accent-primary)]" />
          <h2 className="text-[var(--text-primary)] font-semibold">Recipe Library</h2>
          <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">
            {filteredRecipes.length} recipes
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1"
          >
            &times;
          </button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="p-4 border-b border-[var(--border-primary)] space-y-3">
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search recipes..."
            className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg pl-10 pr-4 py-2 text-sm border border-transparent focus:border-[var(--accent-primary)] focus:outline-none placeholder-[var(--text-dim)]"
          />
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              selectedCategory === null
                ? 'bg-[var(--accent-primary)] text-[var(--text-primary)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
              className={`flex items-center gap-1 px-3 py-1 text-xs rounded-full transition-colors ${
                selectedCategory === cat
                  ? 'bg-[var(--accent-primary)] text-[var(--text-primary)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {CATEGORY_ICONS[cat]}
              {CATEGORY_LABELS[cat] || cat}
            </button>
          ))}
        </div>

        {/* Compatible Only Toggle */}
        {currentStackId && (
          <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={showCompatibleOnly}
              onChange={(e) => setShowCompatibleOnly(e.target.checked)}
              className="rounded border-[var(--text-dim)] bg-[var(--bg-tertiary)] text-[var(--accent-primary)] focus:ring-[var(--accent-primary)]"
            />
            <Filter size={14} />
            Show compatible only
          </label>
        )}
      </div>

      {/* Recipe List */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {Object.entries(groupedRecipes).map(([category, categoryRecipes]) => (
          <div key={category}>
            <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] mb-3">
              {CATEGORY_ICONS[category]}
              {CATEGORY_LABELS[category] || category}
              <span className="text-xs text-[var(--text-dim)]">({categoryRecipes.length})</span>
            </h3>
            <div className="space-y-2">
              {categoryRecipes.map(recipe => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  isCompatible={
                    recipe.compatibleStacks.includes('*') ||
                    (currentStackId ? recipe.compatibleStacks.includes(currentStackId) : true)
                  }
                  onClick={() => onSelectRecipe(recipe)}
                />
              ))}
            </div>
          </div>
        ))}

        {filteredRecipes.length === 0 && (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <Book size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No recipes found</p>
            {searchQuery && (
              <p className="text-xs mt-1">Try adjusting your search or filters</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface RecipeCardProps {
  recipe: Recipe;
  isCompatible: boolean;
  onClick: () => void;
}

function RecipeCard({ recipe, isCompatible, onClick }: RecipeCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={!isCompatible}
      className={`w-full text-left p-4 rounded-lg border transition-all ${
        isCompatible
          ? 'border-[var(--border-primary)] hover:border-[var(--accent-primary)]/50 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
          : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] opacity-50 cursor-not-allowed'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[var(--text-primary)] font-medium">{recipe.name}</span>
            {recipe.author === 'Singularity' && (
              <Star size={12} className="text-[var(--warning)]" />
            )}
          </div>
          <p className="text-sm text-[var(--text-muted)] mb-2">{recipe.description}</p>
          <div className="flex flex-wrap gap-1">
            {recipe.tags.slice(0, 4).map(tag => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded"
              >
                {tag}
              </span>
            ))}
            {recipe.tags.length > 4 && (
              <span className="text-[10px] text-[var(--text-dim)]">
                +{recipe.tags.length - 4} more
              </span>
            )}
          </div>
        </div>
        {isCompatible && (
          <ChevronRight size={20} className="text-[var(--text-dim)] flex-shrink-0 ml-2" />
        )}
      </div>
      {!isCompatible && (
        <p className="text-xs text-[var(--warning)] mt-2">
          Not compatible with current stack
        </p>
      )}
    </button>
  );
}
