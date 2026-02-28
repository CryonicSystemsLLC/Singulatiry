/**
 * File Icon Mapping
 *
 * Maps file extensions and special filenames to Lucide icons and colors.
 * Extracted from FileExplorer for reuse in TabBar, QuickOpen, etc.
 */

import {
    File, FileCode, FileJson, FileText, FileImage, FileTerminal,
    FileType, FileCog, FileSpreadsheet, FileArchive,
    Database, GitBranch, Braces, Hash, Globe, Settings
} from 'lucide-react';

export const fileIconMap: Record<string, { icon: React.ElementType; color: string }> = {
    // TypeScript
    ts:   { icon: FileCode, color: '#3178c6' },
    tsx:  { icon: FileCode, color: '#3178c6' },
    // JavaScript
    js:   { icon: Braces,   color: '#f0db4f' },
    jsx:  { icon: Braces,   color: '#f0db4f' },
    mjs:  { icon: Braces,   color: '#f0db4f' },
    cjs:  { icon: Braces,   color: '#f0db4f' },
    // Web
    html: { icon: Globe,     color: '#e44d26' },
    htm:  { icon: Globe,     color: '#e44d26' },
    css:  { icon: Hash,      color: '#42a5f5' },
    scss: { icon: Hash,      color: '#cd6799' },
    less: { icon: Hash,      color: '#1d365d' },
    svg:  { icon: FileImage, color: '#ffb13b' },
    // Data
    json: { icon: FileJson,  color: '#fbc02d' },
    xml:  { icon: FileCode,  color: '#e44d26' },
    yaml: { icon: FileCog,   color: '#cb171e' },
    yml:  { icon: FileCog,   color: '#cb171e' },
    toml: { icon: Settings,  color: '#9e9e9e' },
    ini:  { icon: Settings,  color: '#9e9e9e' },
    csv:  { icon: FileSpreadsheet, color: '#4caf50' },
    // Languages
    py:   { icon: FileCode,  color: '#4584b6' },
    rs:   { icon: FileCode,  color: '#dea584' },
    go:   { icon: FileCode,  color: '#00acd7' },
    java: { icon: FileCode,  color: '#e76f00' },
    cs:   { icon: FileCode,  color: '#68217a' },
    cpp:  { icon: FileCode,  color: '#649ad2' },
    c:    { icon: FileCode,  color: '#649ad2' },
    h:    { icon: FileCode,  color: '#649ad2' },
    hpp:  { icon: FileCode,  color: '#649ad2' },
    rb:   { icon: FileCode,  color: '#cc342d' },
    php:  { icon: FileCode,  color: '#8892bf' },
    swift:{ icon: FileCode,  color: '#f05138' },
    kt:   { icon: FileCode,  color: '#7f52ff' },
    dart: { icon: FileCode,  color: '#02569b' },
    lua:  { icon: FileCode,  color: '#000080' },
    zig:  { icon: FileCode,  color: '#f7a41d' },
    vue:  { icon: FileCode,  color: '#42b883' },
    svelte:{ icon: FileCode, color: '#ff3e00' },
    // Shell / Config
    sh:   { icon: FileTerminal, color: '#4caf50' },
    bash: { icon: FileTerminal, color: '#4caf50' },
    zsh:  { icon: FileTerminal, color: '#4caf50' },
    ps1:  { icon: FileTerminal, color: '#2196f3' },
    bat:  { icon: FileTerminal, color: '#4caf50' },
    cmd:  { icon: FileTerminal, color: '#4caf50' },
    // Markup / Docs
    md:   { icon: FileText,  color: '#42a5f5' },
    mdx:  { icon: FileText,  color: '#42a5f5' },
    txt:  { icon: FileText,  color: '#9e9e9e' },
    // Database
    sql:  { icon: Database,  color: '#e38c00' },
    // Images
    png:  { icon: FileImage, color: '#66bb6a' },
    jpg:  { icon: FileImage, color: '#66bb6a' },
    jpeg: { icon: FileImage, color: '#66bb6a' },
    gif:  { icon: FileImage, color: '#66bb6a' },
    webp: { icon: FileImage, color: '#66bb6a' },
    ico:  { icon: FileImage, color: '#66bb6a' },
    // Fonts
    woff: { icon: FileType,  color: '#ec407a' },
    woff2:{ icon: FileType,  color: '#ec407a' },
    ttf:  { icon: FileType,  color: '#ec407a' },
    otf:  { icon: FileType,  color: '#ec407a' },
    // Archives
    zip:  { icon: FileArchive, color: '#f57c00' },
    tar:  { icon: FileArchive, color: '#f57c00' },
    gz:   { icon: FileArchive, color: '#f57c00' },
    // GraphQL
    graphql: { icon: Braces,  color: '#e535ab' },
    gql:     { icon: Braces,  color: '#e535ab' },
};

export const specialFileMap: Record<string, { icon: React.ElementType; color: string }> = {
    '.gitignore':    { icon: GitBranch, color: '#f05033' },
    '.gitmodules':   { icon: GitBranch, color: '#f05033' },
    '.gitattributes':{ icon: GitBranch, color: '#f05033' },
    '.env':          { icon: Settings,  color: '#fbc02d' },
    '.env.local':    { icon: Settings,  color: '#fbc02d' },
    '.env.example':  { icon: Settings,  color: '#fbc02d' },
    'dockerfile':    { icon: FileCode,  color: '#2196f3' },
    'docker-compose.yml': { icon: FileCode, color: '#2196f3' },
    'makefile':      { icon: FileTerminal, color: '#6d8086' },
    'cargo.toml':    { icon: Settings,  color: '#dea584' },
    'package.json':  { icon: FileJson,  color: '#4caf50' },
    'tsconfig.json': { icon: FileJson,  color: '#3178c6' },
    'vite.config.ts':{ icon: FileCog,   color: '#646cff' },
    'tailwind.config.js': { icon: FileCog, color: '#38bdf8' },
    'tailwind.config.ts': { icon: FileCog, color: '#38bdf8' },
};

export function getFileIcon(name: string): { Icon: React.ElementType; color: string } {
    const lower = name.toLowerCase();
    // Check special filenames first
    const special = specialFileMap[lower];
    if (special) return { Icon: special.icon, color: special.color };
    // Check extension
    const ext = lower.split('.').pop() || '';
    const mapped = fileIconMap[ext];
    if (mapped) return { Icon: mapped.icon, color: mapped.color };
    // Default
    return { Icon: File, color: 'var(--text-muted)' };
}
