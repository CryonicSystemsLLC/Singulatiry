<p align="center">
  <h1 align="center">Singularity</h1>
  <p align="center">An AI-native code editor with multi-provider LLM support, agentic task execution, SSH remote development, and 10 built-in themes.</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.4.0-blue" alt="Version" />
  <img src="https://img.shields.io/badge/electron-30-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-18-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/typescript-5.2-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platforms" />
</p>

---

## What is Singularity?

Singularity is a cross-platform desktop IDE built from the ground up with AI at its core. It ships with a Monaco-based editor, integrated terminal, file explorer, Git integration, and a chat interface that connects to 7 AI providers — all in a single Electron app.

Unlike plugins bolted onto existing editors, Singularity's AI has deep access to your project: it can read and write files, run commands, execute database queries, manage Git, and plan multi-step tasks using an agentic execution engine. You bring your own API keys, stored encrypted on your device.

---

## Features

### AI Chat & Code Generation
- **7 providers** — OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Moonshot Kimi, Alibaba Qwen
- **Streaming responses** with real-time token display and stop capability
- **Tool use** — the AI can read/write files, run terminal commands, query databases, and manage Git
- **Model selector** — switch between models on the fly (GPT-4o, Claude Opus 4.6, Gemini 2.5 Pro, etc.)
- **Context-aware** — sends your active file, project structure, and selection to the model
- **Diff viewer** — review AI-suggested changes side-by-side before applying
- **Token counting** and per-model cost tracking with budget alerts

### Agentic Task Execution
- **Task planner** — describe a goal and the AI generates a dependency graph (DAG) of tasks
- **Autonomous executor** — runs tasks in order, using 50+ built-in tools
- **Tools include:** file operations, Git commands, npm/yarn, database queries, web search
- **Rollback** — undo to any previous task if something goes wrong
- **Cost estimation** — get a cost estimate before execution begins

### Code Editor
- **Monaco Editor** — the same engine that powers VS Code
- **25+ languages** with syntax highlighting, bracket matching, and validation
- **Multi-tab editing** with dirty state tracking
- **IntelliSense** and autocomplete
- **AI autocomplete** — context-aware code suggestions from your configured provider
- **Configurable** — font family, font size, tab size, word wrap, minimap, line numbers

### Integrated Terminal
- **xterm.js** terminal emulator with full ANSI color support
- **Platform-native shells** — cmd.exe (Windows), zsh (macOS), bash (Linux)
- **SSH terminal** — run shell sessions on remote servers
- **Input sanitization** for security

### SSH Remote Development
- **Connect to remote servers** via password, private key, or SSH agent
- **Full filesystem access** — browse, open, edit, and save remote files
- **Remote terminal** — interactive shell sessions over SSH
- **Git over SSH** — status, staging, commits, diffs on remote repos
- **Remote file watching** — detect changes on the server
- **Saved connections** — store and manage multiple SSH configs

### Git Integration
- **Git status panel** — see changed, staged, and untracked files
- **Stage/unstage** individual files with one click
- **AI-generated commit messages** — let the AI write your commit message from the diff
- **Diff viewer** — see what changed before committing
- **Auto-refresh** every 5 seconds

### 10 Built-in Themes

| Theme | Style | Accent |
|-------|-------|--------|
| Dark | Default zinc dark | Purple |
| Light | Clean white | Purple |
| Midnight | Deep navy | Blue |
| Nord | Arctic blue-grey | Frost blue |
| Solarized Dark | Warm charcoal | Yellow |
| Solarized Light | Cream/tan | Yellow |
| Monokai | Classic warm brown | Pink |
| Dracula | Purple-grey | Lavender |
| Catppuccin | Mocha dark | Mauve |
| High Contrast | True black | Cyan |

All themes use CSS custom properties applied instantly — no reload required. Persisted across sessions.

### Recipe System
- **Pre-built scaffolding** for common patterns (authentication, CRUD endpoints, dark mode)
- **Multi-step wizard** walks you through configuration
- **Rollback support** if you change your mind

### Project Wizard
- Create new projects from templates
- Stack-based scaffolding with pre-configured tooling

### Dev Server Management
- Register and manage multiple dev servers
- Auto port discovery
- Start, stop, restart with lifecycle hooks
- Status monitoring in the UI

### Automation & Workflows
- **File change triggers** — run actions when files change
- **Scheduled execution** — time-based triggers
- **Custom events** — trigger workflows programmatically

### Guardrails & Safety
- **Content filtering** — detect sensitive content before sending to AI
- **Code filtering** — flag potential security issues in generated code
- **Cost limits** — set daily, session, or monthly budgets with soft/hard caps
- **Rate limiting** — per-provider token bucket rate limiting
- **Circuit breaker** — automatic fail-fast when a provider is down
- **Process sandboxing** — restrict filesystem and command access

### Kid Mode
- Simplified interface for younger users
- Restricted commands and filesystem access
- Visual project builder with preset templates
- Shorter timeouts and lower resource limits
- Approval required for destructive operations

### Usage Dashboard
- Token usage breakdown by provider and model
- Cost tracking (session, daily, monthly)
- Budget status with alerts
- Request latency and success rates

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Electron 30 |
| **Frontend** | React 18, TypeScript 5.2, Tailwind CSS 3.4 |
| **Editor** | Monaco Editor 0.55 |
| **Terminal** | xterm.js 5.3 |
| **State** | Zustand 5.0 |
| **AI Providers** | Native HTTP (no SDK dependencies) |
| **SSH** | ssh2 1.17 |
| **Animations** | Framer Motion 12 |
| **Icons** | Lucide React |
| **Markdown** | react-markdown + react-syntax-highlighter |
| **Build** | Vite 5, electron-builder 24 |

---

## Getting Started

### Prerequisites
- **Node.js** 18 or later
- **npm** (or yarn/pnpm)
- **Git** (optional, for Git integration features)

### Install

```bash
git clone https://github.com/Dyebit/singularity.git
cd singularity
npm install
```

### Development

```bash
npm run dev
```

This starts the Vite dev server with hot reload and launches Electron.

### Production Build

```bash
# Build for your current platform
npm run build

# Platform-specific
npm run build:win      # Windows (NSIS installer)
npm run build:mac      # macOS (DMG, x64 + arm64)
npm run build:linux    # Linux (AppImage, deb, rpm)
```

Built installers are output to `release/{version}/`.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+,` | Open Settings |
| `Ctrl+P` | Quick Open (Go to File) |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+S` | Save File |
| `Ctrl+N` | New File |
| `Ctrl+O` | Open Folder |
| `Ctrl+W` | Close Tab |
| `Ctrl+B` | Toggle Sidebar |
| `Ctrl+J` | Toggle Terminal |
| `Ctrl+Shift+L` | Toggle AI Chat |
| `` Ctrl+Shift+` `` | New Terminal |
| `F5` | Start Debugging |

---

## API Keys

Singularity requires API keys from the providers you want to use. Keys are encrypted and stored locally on your device — they are never sent anywhere except directly to the provider's API.

To configure keys, click the gear icon in the AI chat panel.

| Provider | Get a key |
|----------|-----------|
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) |
| Google Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| xAI | [console.x.ai](https://console.x.ai/) |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) |
| Moonshot Kimi | [platform.moonshot.cn](https://platform.moonshot.cn/) |
| Alibaba Qwen | [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com/) |

---

## Project Structure

```
singularity/
├── electron/                       # Electron main process
│   ├── main.ts                     # App lifecycle, menus, 80+ IPC handlers
│   ├── preload.ts                  # Context bridge (18 API surfaces)
│   └── services/
│       ├── agent/                  # Agentic planner + executor
│       ├── ai/                     # AI autocomplete
│       ├── automation/             # File watchers + triggers
│       ├── database/               # Schema parsing + migrations
│       ├── devserver/              # Dev server lifecycle
│       ├── guardrails/             # Content filtering + cost limits
│       ├── models/                 # Unified multi-provider AI
│       │   └── providers/          # Anthropic, OpenAI, Gemini
│       ├── persistence/            # Session + chat storage
│       ├── recipes/                # Scaffolding templates
│       ├── remote/                 # SSH filesystem + terminal + git
│       ├── sandbox/                # Process isolation
│       ├── telemetry/              # Metrics + cost tracking
│       └── tools/                  # 50+ tools (file, git, npm, db, web)
├── src/                            # React frontend
│   ├── App.tsx                     # Root layout + keybindings
│   ├── components/                 # 30+ React components
│   │   ├── CodeEditor.tsx          # Monaco editor wrapper
│   │   ├── AIChatPane.tsx          # AI chat with streaming
│   │   ├── TerminalPane.tsx        # xterm.js terminal
│   │   ├── FileExplorer.tsx        # File tree (local + remote)
│   │   ├── SettingsModal.tsx       # Theme + editor settings
│   │   ├── APIKeyModal.tsx         # Provider key management
│   │   ├── ModelSelector.tsx       # Model/provider picker
│   │   ├── ModelConfig.tsx         # Model parameter tuning
│   │   ├── CommandPalette.tsx      # Ctrl+Shift+P command search
│   │   ├── QuickOpen.tsx           # Ctrl+P file search
│   │   ├── DiffViewer.tsx          # Side-by-side diff
│   │   ├── GitPane.tsx             # Git status + staging
│   │   ├── ProjectWizard.tsx       # New project wizard
│   │   ├── RecipeWizard.tsx        # Recipe execution
│   │   ├── UsageDashboard.tsx      # Token/cost dashboard
│   │   └── ...
│   ├── stores/                     # Zustand state
│   │   ├── appStore.ts             # Layout, tabs, project
│   │   ├── chatStore.ts            # Messages, streaming
│   │   ├── settingsStore.ts        # Theme + editor prefs
│   │   └── remoteStore.ts          # SSH connections
│   ├── services/                   # Frontend services
│   ├── themes/
│   │   └── variables.css           # 10 theme definitions
│   └── types/                      # TypeScript definitions
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── electron-builder.json5          # Cross-platform build config
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ AI Models│  │  Agent   │  │  Remote  │  │ Tools  │  │
│  │ (7 provs)│  │ Planner/ │  │  SSH/FS  │  │ 50+ ops│  │
│  │          │  │ Executor │  │  Git/Term│  │        │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       └──────────────┴─────────────┴────────────┘       │
│                         IPC Bridge                       │
├─────────────────────────────────────────────────────────┤
│                   Electron Renderer                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │  Monaco  │  │ AI Chat  │  │ Terminal │  │ File   │  │
│  │  Editor  │  │  Pane    │  │ (xterm)  │  │Explorer│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │   Git    │  │ Settings │  │ Command  │  │ Usage  │  │
│  │  Pane    │  │  Modal   │  │ Palette  │  │Dashboard│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│                    React 18 + Zustand                    │
└─────────────────────────────────────────────────────────┘
```

---

## Configuration

### Settings (`Ctrl+,`)
- **Theme** — 10 themes with visual preview cards
- **Font Family** — JetBrains Mono, Fira Code, Consolas, Source Code Pro, Cascadia Code, IBM Plex Mono
- **Font Size** — 8px to 32px
- **Tab Size** — 2, 4, or 8 spaces
- **Word Wrap** — on/off
- **Minimap** — on/off
- **Line Numbers** — on/off

All settings apply instantly and persist across sessions via localStorage.

### Cost Budgets
Configure daily, session, or monthly spending limits per provider. Soft limits warn you; hard limits block further requests.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the [Business Source License 1.1](LICENSE).

**Free for:** personal use, education, research, non-profits, and internal company dev tooling.

**Commercial use** (selling it, hosting it as a service, bundling it in a paid product) **requires a paid license.** Contact [@Dyebit](https://github.com/Dyebit) for commercial licensing.

After 4 years from each version's release date, that version converts to Apache 2.0 (fully open source).

---

<p align="center">
  Built by <a href="https://github.com/Dyebit">Dyebit</a>
</p>
