/**
 * Dark Mode Recipe
 *
 * Adds dark mode support with theme switching
 */

import type { Recipe } from '../types';

export const darkModeRecipe: Recipe = {
  id: 'add-dark-mode',
  name: 'Add Dark Mode',
  description: 'Add dark mode support with theme switching using next-themes',
  category: 'ui',
  icon: 'moon',
  tags: ['dark-mode', 'theme', 'ui', 'styling', 'next-themes'],
  compatibleStacks: ['nextjs-prisma'],
  version: '1.0.0',
  author: 'Singularity',

  parameters: [
    {
      name: 'defaultTheme',
      type: 'select',
      label: 'Default Theme',
      description: 'The default theme for new users',
      required: true,
      default: 'system',
      options: [
        { value: 'system', label: 'System preference' },
        { value: 'light', label: 'Light mode' },
        { value: 'dark', label: 'Dark mode' }
      ]
    },
    {
      name: 'includeToggle',
      type: 'boolean',
      label: 'Include Theme Toggle',
      description: 'Add a theme toggle component',
      required: false,
      default: true
    },
    {
      name: 'storageKey',
      type: 'string',
      label: 'Storage Key',
      description: 'localStorage key for persisting theme',
      required: false,
      default: 'theme'
    }
  ],

  steps: [
    // Step 1: Install next-themes
    {
      id: 'install-deps',
      name: 'Install Dependencies',
      description: 'Install next-themes package',
      type: 'command',
      config: {
        command: 'npm install next-themes',
        timeout: 60000
      }
    },

    // Step 2: Create theme provider component
    {
      id: 'create-provider',
      name: 'Create Theme Provider',
      description: 'Create the ThemeProvider component',
      type: 'file_create',
      config: {
        path: 'src/components/ThemeProvider.tsx',
        template: `'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({
  children,
  ...props
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="{{defaultTheme}}"
      enableSystem
      disableTransitionOnChange
      storageKey="{{storageKey}}"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
`
      }
    },

    // Step 3: Create theme toggle component (conditional)
    {
      id: 'create-toggle',
      name: 'Create Theme Toggle',
      description: 'Create the theme toggle component',
      type: 'file_create',
      condition: 'params.includeToggle',
      config: {
        path: 'src/components/ThemeToggle.tsx',
        template: `'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="Toggle theme"
      >
        <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </button>
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      aria-label={\`Switch to \${isDark ? 'light' : 'dark'} mode\`}
      title={\`Switch to \${isDark ? 'light' : 'dark'} mode\`}
    >
      {isDark ? (
        <SunIcon className="w-5 h-5 text-yellow-500" />
      ) : (
        <MoonIcon className="w-5 h-5 text-gray-600" />
      )}
    </button>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
      />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
      />
    </svg>
  );
}

// Dropdown variant for more options
export function ThemeDropdown() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const themes = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' },
    { value: 'system', label: 'System', icon: '💻' }
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
      >
        <span>{themes.find(t => t.value === theme)?.icon || '💻'}</span>
        <span className="text-sm">{themes.find(t => t.value === theme)?.label || 'Theme'}</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-36 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-20">
            <div className="py-1">
              {themes.map(({ value, label, icon }) => (
                <button
                  key={value}
                  onClick={() => {
                    setTheme(value);
                    setOpen(false);
                  }}
                  className={\`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 \${
                    theme === value ? 'bg-gray-100 dark:bg-gray-700' : ''
                  }\`}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                  {theme === value && (
                    <span className="ml-auto text-indigo-600 dark:text-indigo-400">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
`
      }
    },

    // Step 4: Update root layout
    {
      id: 'update-layout',
      name: 'Update Root Layout',
      description: 'Wrap app with ThemeProvider',
      type: 'file_modify',
      config: {
        path: 'src/app/layout.tsx',
        modifications: [
          {
            type: 'insert_after',
            target: "import type { Metadata } from 'next'",
            content: "import { ThemeProvider } from '@/components/ThemeProvider'"
          },
          {
            type: 'replace',
            target: '<body className={inter.className}>',
            content: `<body className={inter.className} suppressHydrationWarning>
        <ThemeProvider>`
          },
          {
            type: 'replace',
            target: '</body>',
            content: `    </ThemeProvider>
      </body>`
          }
        ]
      }
    },

    // Step 5: Update Tailwind config for dark mode
    {
      id: 'update-tailwind',
      name: 'Update Tailwind Config',
      description: 'Enable class-based dark mode in Tailwind',
      type: 'file_modify',
      config: {
        path: 'tailwind.config.ts',
        modifications: [
          {
            type: 'insert_after',
            target: 'const config: Config = {',
            content: "  darkMode: 'class',"
          }
        ]
      }
    },

    // Step 6: Add dark mode CSS variables
    {
      id: 'update-globals-css',
      name: 'Update Global CSS',
      description: 'Add dark mode color variables',
      type: 'file_modify',
      config: {
        path: 'src/app/globals.css',
        modifications: [
          {
            type: 'append',
            content: `
/* Dark mode color scheme */
@layer base {
  :root {
    --background: 255 255 255;
    --foreground: 10 10 10;
    --card: 255 255 255;
    --card-foreground: 10 10 10;
    --popover: 255 255 255;
    --popover-foreground: 10 10 10;
    --primary: 99 102 241;
    --primary-foreground: 255 255 255;
    --secondary: 243 244 246;
    --secondary-foreground: 31 41 55;
    --muted: 243 244 246;
    --muted-foreground: 107 114 128;
    --accent: 243 244 246;
    --accent-foreground: 31 41 55;
    --destructive: 239 68 68;
    --destructive-foreground: 255 255 255;
    --border: 229 231 235;
    --input: 229 231 235;
    --ring: 99 102 241;
  }

  .dark {
    --background: 10 10 10;
    --foreground: 250 250 250;
    --card: 24 24 27;
    --card-foreground: 250 250 250;
    --popover: 24 24 27;
    --popover-foreground: 250 250 250;
    --primary: 129 140 248;
    --primary-foreground: 10 10 10;
    --secondary: 39 39 42;
    --secondary-foreground: 250 250 250;
    --muted: 39 39 42;
    --muted-foreground: 161 161 170;
    --accent: 39 39 42;
    --accent-foreground: 250 250 250;
    --destructive: 239 68 68;
    --destructive-foreground: 255 255 255;
    --border: 39 39 42;
    --input: 39 39 42;
    --ring: 129 140 248;
  }
}

/* Smooth theme transition */
* {
  transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out;
}
`
          }
        ]
      }
    }
  ]
};

export default darkModeRecipe;
