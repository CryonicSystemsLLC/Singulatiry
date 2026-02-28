import { create } from 'zustand';

export type Theme = 'dark' | 'light' | 'midnight' | 'nord' | 'solarized-dark' | 'solarized-light' | 'monokai' | 'dracula' | 'catppuccin' | 'high-contrast';

interface SettingsState {
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;

  setTheme: (theme: Theme) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  setTabSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setMinimap: (enabled: boolean) => void;
  setLineNumbers: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: (localStorage.getItem('singularity_theme') as Theme) || 'dark',
  fontSize: parseInt(localStorage.getItem('singularity_font_size') || '14'),
  fontFamily: localStorage.getItem('singularity_font_family') || "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  tabSize: parseInt(localStorage.getItem('singularity_tab_size') || '2'),
  wordWrap: localStorage.getItem('singularity_word_wrap') === 'true',
  minimap: localStorage.getItem('singularity_minimap') !== 'false',
  lineNumbers: localStorage.getItem('singularity_line_numbers') !== 'false',

  setTheme: (theme) => {
    localStorage.setItem('singularity_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  setFontSize: (fontSize) => { localStorage.setItem('singularity_font_size', String(fontSize)); set({ fontSize }); },
  setFontFamily: (fontFamily) => { localStorage.setItem('singularity_font_family', fontFamily); set({ fontFamily }); },
  setTabSize: (tabSize) => { localStorage.setItem('singularity_tab_size', String(tabSize)); set({ tabSize }); },
  setWordWrap: (wordWrap) => { localStorage.setItem('singularity_word_wrap', String(wordWrap)); set({ wordWrap }); },
  setMinimap: (minimap) => { localStorage.setItem('singularity_minimap', String(minimap)); set({ minimap }); },
  setLineNumbers: (lineNumbers) => { localStorage.setItem('singularity_line_numbers', String(lineNumbers)); set({ lineNumbers }); }
}));
