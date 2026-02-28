/**
 * VS Code API Shim — Provides a `vscode` module that extensions can `require('vscode')`.
 * Communicates with the Singularity main process via stdio JSON messages.
 *
 * This implements the subset of the VS Code Extension API that real extensions use.
 */

'use strict';

// ============================================================
// IPC Communication via stdio
// ============================================================

let _messageId = 0;
const _pendingRequests = new Map();
const _eventHandlers = new Map();
const _uriHandlers = new Map();
let _sendMessage;

function _initIPC(sendFn) {
  _sendMessage = sendFn;
}

function _send(type, data) {
  const msg = { type, ...data };
  if (_sendMessage) _sendMessage(msg);
}

function _request(type, data) {
  return new Promise((resolve, reject) => {
    const id = ++_messageId;
    _pendingRequests.set(id, { resolve, reject });
    _send(type, { ...data, _requestId: id });
    // Timeout after 30s
    setTimeout(() => {
      if (_pendingRequests.has(id)) {
        _pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${type}`));
      }
    }, 30000);
  });
}

function _handleIncoming(msg) {
  // Response to a request
  if (msg._requestId && _pendingRequests.has(msg._requestId)) {
    const { resolve, reject } = _pendingRequests.get(msg._requestId);
    _pendingRequests.delete(msg._requestId);
    if (msg.error) reject(new Error(msg.error));
    else resolve(msg.result);
    return;
  }

  // URI handler callback from host
  if (msg.type === 'uri:handle') {
    const handler = _uriHandlers.get(msg.data.extensionId);
    if (handler) {
      try { handler.handleUri(Uri.parse(msg.data.uri)); } catch (e) { console.error('[vscode-shim] URI handler error:', e); }
    }
    return;
  }

  // Event from host
  if (msg.type && _eventHandlers.has(msg.type)) {
    for (const handler of _eventHandlers.get(msg.type)) {
      try { handler(msg.data); } catch (e) { console.error('[vscode-shim] Event handler error:', e); }
    }
  }
}

function _on(type, handler) {
  if (!_eventHandlers.has(type)) _eventHandlers.set(type, []);
  _eventHandlers.get(type).push(handler);
}

// ============================================================
// Core Types
// ============================================================

class Disposable {
  constructor(callOnDispose) { this._callOnDispose = callOnDispose; }
  dispose() { if (this._callOnDispose) { this._callOnDispose(); this._callOnDispose = null; } }
  static from(...disposables) {
    return new Disposable(() => disposables.forEach(d => d && d.dispose()));
  }
}

class EventEmitter {
  constructor() { this._listeners = []; }
  get event() {
    return (listener, thisArgs, disposables) => {
      const bound = thisArgs ? listener.bind(thisArgs) : listener;
      this._listeners.push(bound);
      const disposable = new Disposable(() => {
        const idx = this._listeners.indexOf(bound);
        if (idx >= 0) this._listeners.splice(idx, 1);
      });
      if (disposables) disposables.push(disposable);
      return disposable;
    };
  }
  fire(data) { this._listeners.forEach(l => { try { l(data); } catch (e) { console.error(e); } }); }
  dispose() { this._listeners = []; }
}

class CancellationTokenSource {
  constructor() {
    this._emitter = new EventEmitter();
    this.token = { isCancellationRequested: false, onCancellationRequested: this._emitter.event };
  }
  cancel() { this.token.isCancellationRequested = true; this._emitter.fire(); }
  dispose() { this._emitter.dispose(); }
}

// ============================================================
// Uri
// ============================================================

class Uri {
  constructor(scheme, authority, path, query, fragment) {
    this.scheme = scheme || 'file';
    this.authority = authority || '';
    this.path = path || '';
    this.query = query || '';
    this.fragment = fragment || '';
  }
  get fsPath() {
    let p = this.path;
    if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
    return p.replace(/\//g, require('path').sep);
  }
  toString() {
    return `${this.scheme}://${this.authority}${this.path}${this.query ? '?' + this.query : ''}${this.fragment ? '#' + this.fragment : ''}`;
  }
  with(change) {
    return new Uri(
      change.scheme !== undefined ? change.scheme : this.scheme,
      change.authority !== undefined ? change.authority : this.authority,
      change.path !== undefined ? change.path : this.path,
      change.query !== undefined ? change.query : this.query,
      change.fragment !== undefined ? change.fragment : this.fragment,
    );
  }
  static file(path) {
    const normalized = path.replace(/\\/g, '/');
    return new Uri('file', '', normalized.startsWith('/') ? normalized : '/' + normalized, '', '');
  }
  static parse(value) {
    try {
      const url = new URL(value);
      return new Uri(url.protocol.replace(':', ''), url.host, url.pathname, url.search.slice(1), url.hash.slice(1));
    } catch {
      return Uri.file(value);
    }
  }
  static joinPath(base, ...pathSegments) {
    const joined = require('path').posix.join(base.path, ...pathSegments);
    return base.with({ path: joined });
  }
}

// ============================================================
// Webview
// ============================================================

class Webview {
  constructor(panelId) {
    this._panelId = panelId;
    this._onDidReceiveMessage = new EventEmitter();
    this.onDidReceiveMessage = this._onDidReceiveMessage.event;
    this._options = {};
    this._html = '';

    // Listen for messages from the webview
    _on('webview:message', (data) => {
      if (data.panelId === this._panelId) {
        this._onDidReceiveMessage.fire(data.message);
      }
    });
  }

  get options() { return this._options; }
  set options(v) { this._options = v; }

  get html() { return this._html; }
  set html(v) {
    this._html = v;
    _send('webview:setHtml', { panelId: this._panelId, html: v });
  }

  get cspSource() { return 'singularity-ext:'; }

  postMessage(message) {
    _send('webview:postMessage', { panelId: this._panelId, message });
    return Promise.resolve(true);
  }

  asWebviewUri(localResource) {
    // Convert file URI to singularity-ext:// protocol URI
    const extId = _extensionId;
    const extPath = (localResource.fsPath || localResource.path || '').replace(/\\/g, '/');
    // Find the "/extension/" boundary and extract relative path
    const marker = '/extension/';
    const idx = extPath.indexOf(marker);
    if (idx >= 0) {
      const relative = extPath.substring(idx + marker.length);
      return Uri.parse(`singularity-ext://${extId}/${relative}`);
    }
    // Fallback: try to make it relative to the extension path
    const normExtPath = _extensionPath.replace(/\\/g, '/');
    if (extPath.startsWith(normExtPath)) {
      const relative = extPath.substring(normExtPath.length).replace(/^\//, '');
      return Uri.parse(`singularity-ext://${extId}/${relative}`);
    }
    return localResource;
  }
}

class WebviewPanel {
  constructor(viewType, title, column, options) {
    this._viewType = viewType;
    this._title = title;
    this._panelId = `${_extensionId}:${viewType}`;
    this.webview = new Webview(this._panelId);
    this._visible = true;
    this._active = true;
    this._onDidDispose = new EventEmitter();
    this.onDidDispose = this._onDidDispose.event;
    this._onDidChangeViewState = new EventEmitter();
    this.onDidChangeViewState = this._onDidChangeViewState.event;

    if (options?.enableScripts !== undefined) {
      this.webview.options = { enableScripts: options.enableScripts };
    }
  }

  get viewType() { return this._viewType; }
  get title() { return this._title; }
  set title(v) { this._title = v; _send('webview:setTitle', { panelId: this._panelId, title: v }); }
  get visible() { return this._visible; }
  get active() { return this._active; }
  get viewColumn() { return 1; }

  reveal(viewColumn, preserveFocus) {
    _send('webview:reveal', { panelId: this._panelId });
  }

  dispose() {
    this._onDidDispose.fire();
    _send('webview:dispose', { panelId: this._panelId });
  }
}

// WebviewViewProvider support (sidebar webviews)
const _webviewViewProviders = new Map();

class WebviewView {
  constructor(viewType) {
    this._viewType = viewType;
    this._panelId = `${_extensionId}:${viewType}`;
    this.webview = new Webview(this._panelId);
    this._visible = true;
    this._onDidDispose = new EventEmitter();
    this.onDidDispose = this._onDidDispose.event;
    this._onDidChangeVisibility = new EventEmitter();
    this.onDidChangeVisibility = this._onDidChangeVisibility.event;
  }
  get viewType() { return this._viewType; }
  get visible() { return this._visible; }
  show(preserveFocus) { _send('webview:reveal', { panelId: this._panelId }); }
}

// ============================================================
// Commands
// ============================================================

const _commands = new Map();
const _contextKeys = new Map();
const _configDefaults = new Map(); // section.key -> default value (from extension package.json)
const _configOverrides = {};       // user/workspace overrides

const commands = {
  registerCommand(id, handler, thisArg) {
    const bound = thisArg ? handler.bind(thisArg) : handler;
    _commands.set(id, bound);
    _send('commands:register', { id });
    return new Disposable(() => { _commands.delete(id); });
  },

  async executeCommand(id, ...args) {
    // Handle setContext — store context key locally
    if (id === 'setContext' && args.length >= 2) {
      _contextKeys.set(args[0], args[1]);
      return;
    }
    // Handle vscode.open — forward to host
    if (id === 'vscode.open') {
      _send('commands:execute', { id, args: args.map(a => a?.toString?.() || a) });
      return;
    }
    // Try local first
    if (_commands.has(id)) {
      return _commands.get(id)(...args);
    }
    // Ask the host to execute
    return _request('commands:execute', { id, args });
  },

  getCommands(filterInternal) {
    return Promise.resolve([..._commands.keys()]);
  },

  registerTextEditorCommand(id, handler, thisArg) {
    _commands.set(id, () => {});
    _send('commands:register', { id });
    return new Disposable(() => { _commands.delete(id); });
  },
};

// ============================================================
// Window
// ============================================================

const _statusBarItems = [];
const _outputChannels = new Map();

/**
 * Unified showMessage handler — supports all VS Code showMessage overloads:
 *   showMessage(message)
 *   showMessage(message, ...items)           — items can be strings or { title: string }
 *   showMessage(message, options, ...items)  — options = { modal?, detail? }
 */
function _showMessage(level, message, args) {
  // Strip MessageOptions if present (first arg with 'modal' or 'detail' key, not a 'title' key)
  let options = {};
  if (args.length > 0 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && ('modal' in args[0] || 'detail' in args[0]) && !('title' in args[0])) {
    options = args[0];
    args = args.slice(1);
  }

  // Build display items + keep reference to originals for return value
  const displayItems = [];
  const originalItems = [];
  for (const item of args) {
    if (typeof item === 'string') {
      displayItems.push(item);
      originalItems.push(item);
    } else if (item && typeof item === 'object' && item.title) {
      displayItems.push(item.title);
      originalItems.push(item);
    }
  }

  const detail = options.detail || undefined;

  if (displayItems.length === 0) {
    _send('window:showMessage', { level, message, items: [], detail });
    return Promise.resolve(undefined);
  }

  return _request('window:showMessage', { level, message, items: displayItems, detail })
    .then(selected => {
      if (selected === undefined || selected === null) return undefined;
      // Map selected display string back to original item (string or MessageItem)
      const idx = displayItems.indexOf(selected);
      return idx >= 0 ? originalItems[idx] : undefined;
    });
}

const window = {
  createWebviewPanel(viewType, title, showOptions, options) {
    const panel = new WebviewPanel(viewType, title, 1, options);
    _send('webview:createPanel', {
      panelId: panel._panelId,
      viewType,
      title,
      options: { enableScripts: options?.enableScripts },
    });
    return panel;
  },

  registerWebviewViewProvider(viewId, provider, options) {
    _webviewViewProviders.set(viewId, provider);
    // Create the WebviewView and resolve the provider
    const view = new WebviewView(viewId);
    _send('webview:registerViewProvider', { viewId, panelId: view._panelId });
    // Call the provider's resolveWebviewView — properly await async implementations
    Promise.resolve()
      .then(() => provider.resolveWebviewView(view, {}, new CancellationTokenSource().token))
      .then(() => {
        _send('webview:viewResolved', { viewId, panelId: view._panelId });
      })
      .catch((e) => {
        console.error('[vscode-shim] Error resolving webview view provider:', e);
      });
    return new Disposable(() => { _webviewViewProviders.delete(viewId); });
  },

  showInformationMessage(message, ...items) {
    return _showMessage('info', message, items);
  },

  showWarningMessage(message, ...items) {
    return _showMessage('warning', message, items);
  },

  showErrorMessage(message, ...items) {
    return _showMessage('error', message, items);
  },

  showQuickPick(items, options) {
    return _request('window:showQuickPick', { items, options });
  },

  showInputBox(options) {
    return _request('window:showInputBox', { options });
  },

  withProgress(options, task) {
    const progress = {
      report(value) { _send('window:progress', { ...options, ...value }); }
    };
    const token = new CancellationTokenSource().token;
    return task(progress, token);
  },

  createTerminal(nameOrOptions) {
    const name = typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions?.name || 'Extension Terminal';
    _send('window:createTerminal', { name });
    return {
      name,
      processId: Promise.resolve(0),
      show(preserveFocus) { _send('window:showTerminal', { name }); },
      sendText(text, addNewLine) { _send('window:terminalSendText', { name, text, addNewLine }); },
      dispose() { _send('window:disposeTerminal', { name }); },
    };
  },

  createOutputChannel(name, options) {
    const isLog = (typeof options === 'object' && options !== null && options.log === true);
    const channel = {
      name,
      _lines: [],
      append(value) { this._lines.push(value); },
      appendLine(value) { this._lines.push(value + '\n'); _send('window:outputChannel', { name, text: value }); },
      clear() { this._lines = []; },
      show(preserveFocus) { _send('window:showOutputChannel', { name }); },
      hide() {},
      dispose() { _outputChannels.delete(name); },
      replace(value) { this._lines = [value]; },
    };
    // LogOutputChannel (returned when options.log === true)
    if (isLog) {
      channel.logLevel = 2; // Info
      channel.onDidChangeLogLevel = new EventEmitter().event;
      channel.trace = function(msg, ...args) { _send('window:outputChannel', { name, text: `[trace] ${msg}` }); };
      channel.debug = function(msg, ...args) { _send('window:outputChannel', { name, text: `[debug] ${msg}` }); };
      channel.info = function(msg, ...args) { _send('window:outputChannel', { name, text: `[info] ${msg}` }); };
      channel.warn = function(msg, ...args) { _send('window:outputChannel', { name, text: `[warn] ${msg}` }); };
      channel.error = function(msg, ...args) { _send('window:outputChannel', { name, text: `[error] ${msg}` }); };
    }
    _outputChannels.set(name, channel);
    return channel;
  },

  createStatusBarItem(alignmentOrId, priority) {
    const item = {
      alignment: typeof alignmentOrId === 'number' ? alignmentOrId : 1,
      priority: priority || 0,
      text: '', tooltip: '', command: undefined, color: undefined, backgroundColor: undefined,
      show() { _send('window:statusBarItem', { text: this.text, tooltip: this.tooltip, command: this.command }); },
      hide() {},
      dispose() {},
    };
    _statusBarItems.push(item);
    return item;
  },

  get activeTextEditor() { return undefined; },
  get visibleTextEditors() { return []; },
  get activeTerminal() { return undefined; },
  get terminals() { return []; },

  onDidChangeActiveTextEditor: new EventEmitter().event,
  onDidChangeVisibleTextEditors: new EventEmitter().event,
  onDidChangeTextEditorSelection: new EventEmitter().event,
  onDidChangeActiveColorTheme: new EventEmitter().event,
  onDidOpenTerminal: new EventEmitter().event,
  onDidCloseTerminal: new EventEmitter().event,
  onDidChangeActiveTerminal: new EventEmitter().event,
  onDidChangeTerminalState: new EventEmitter().event,
  onDidChangeTerminalShellIntegration: new EventEmitter().event,
  onDidStartTerminalShellExecution: new EventEmitter().event,
  onDidEndTerminalShellExecution: new EventEmitter().event,
  onDidChangeWindowState: new EventEmitter().event,
  get state() { return { focused: true, active: true }; },

  registerTreeDataProvider(viewId, provider) { return new Disposable(() => {}); },
  createTreeView(viewId, options) {
    return {
      onDidExpandElement: new EventEmitter().event,
      onDidCollapseElement: new EventEmitter().event,
      onDidChangeSelection: new EventEmitter().event,
      onDidChangeVisibility: new EventEmitter().event,
      selection: [], visible: true,
      reveal() { return Promise.resolve(); },
      dispose() {},
    };
  },
  registerUriHandler(handler) {
    _uriHandlers.set(_extensionId, handler);
    _send('window:registerUriHandler', { extensionId: _extensionId });
    return new Disposable(() => { _uriHandlers.delete(_extensionId); });
  },
  registerCustomEditorProvider(viewType, provider) { return new Disposable(() => {}); },
  registerWebviewPanelSerializer(viewType, serializer) { return new Disposable(() => {}); },
  showTextDocument(doc, columnOrOptions) { return Promise.resolve(undefined); },
  showNotebookDocument(doc, options) { return Promise.resolve(undefined); },
  registerFileDecorationProvider(provider) { return new Disposable(() => {}); },

  createTextEditorDecorationType(options) {
    const key = `decoration-${++_messageId}`;
    return { key, dispose() {} };
  },

  showSaveDialog(options) { return Promise.resolve(undefined); },
  showOpenDialog(options) { return Promise.resolve(undefined); },
  showWorkspaceFolderPick(options) { return Promise.resolve(undefined); },

  createWebviewPanel(viewType, title, showOptions, options) {
    return new WebviewPanel(viewType, title, typeof showOptions === 'number' ? showOptions : 1, options);
  },

  // Color theme
  get activeColorTheme() {
    return { kind: 2 }; // 2 = Dark
  },

  // Tabgroups stub
  get tabGroups() {
    return { all: [], activeTabGroup: { tabs: [], isActive: true, viewColumn: 1 }, onDidChangeTabs: new EventEmitter().event, onDidChangeTabGroups: new EventEmitter().event };
  },
};

// ============================================================
// Workspace
// ============================================================

const _configChangeEmitter = new EventEmitter();

const workspace = {
  get workspaceFolders() {
    const root = process.env.SINGULARITY_PROJECT_ROOT;
    if (root) return [{ uri: Uri.file(root), name: require('path').basename(root), index: 0 }];
    return undefined;
  },

  getWorkspaceFolder(uri) {
    const root = process.env.SINGULARITY_PROJECT_ROOT;
    if (!root) return undefined;
    const uriPath = uri?.fsPath || uri?.path || '';
    // Check if the URI is within the workspace root
    if (uriPath.startsWith(root) || uriPath.startsWith(root.replace(/\\/g, '/'))) {
      return { uri: Uri.file(root), name: require('path').basename(root), index: 0 };
    }
    return undefined;
  },

  getConfiguration(section, scope) {
    // Resolve a full key and look up override → extension default → caller default
    const _resolve = (key, defaultValue) => {
      const fullKey = section ? `${section}.${key}` : key;
      // 1. User/workspace override
      if (fullKey in _configOverrides) return _configOverrides[fullKey];
      // 2. Extension-declared default from package.json
      if (_configDefaults.has(fullKey)) return _configDefaults.get(fullKey);
      // 3. Caller-provided default
      return defaultValue;
    };
    return {
      get(key, defaultValue) { return _resolve(key, defaultValue); },
      has(key) {
        const fullKey = section ? `${section}.${key}` : key;
        return fullKey in _configOverrides || _configDefaults.has(fullKey);
      },
      inspect(key) {
        const fullKey = section ? `${section}.${key}` : key;
        return {
          key: fullKey,
          defaultValue: _configDefaults.get(fullKey),
          globalValue: _configOverrides[fullKey],
          workspaceValue: undefined,
        };
      },
      update(key, value, configTarget, overrideInLanguage) {
        const fullKey = section ? `${section}.${key}` : key;
        _configOverrides[fullKey] = value;
        return Promise.resolve();
      },
    };
  },

  onDidChangeConfiguration: _configChangeEmitter.event,

  async openTextDocument(uriOrOptions) {
    if (typeof uriOrOptions === 'string' || uriOrOptions instanceof Uri) {
      const path = typeof uriOrOptions === 'string' ? uriOrOptions : uriOrOptions.fsPath;
      const content = await _request('workspace:readFile', { path });
      return {
        uri: typeof uriOrOptions === 'string' ? Uri.file(uriOrOptions) : uriOrOptions,
        fileName: path,
        languageId: 'plaintext',
        version: 1,
        isDirty: false,
        isUntitled: false,
        isClosed: false,
        lineCount: (content || '').split('\n').length,
        getText() { return content || ''; },
        lineAt(line) { return { text: (content || '').split('\n')[line] || '', lineNumber: line }; },
        positionAt(offset) { return { line: 0, character: offset }; },
        offsetAt(position) { return 0; },
        save() { return Promise.resolve(true); },
      };
    }
    return { uri: Uri.file('untitled'), getText() { return ''; }, languageId: 'plaintext', version: 1, isDirty: false, isUntitled: true, isClosed: false, lineCount: 0, lineAt() { return { text: '' }; } };
  },

  createFileSystemWatcher(glob) {
    return {
      onDidCreate: new EventEmitter().event,
      onDidChange: new EventEmitter().event,
      onDidDelete: new EventEmitter().event,
      dispose() {},
    };
  },

  get fs() {
    return {
      readFile(uri) {
        return _request('workspace:readFileBuffer', { path: uri.fsPath }).then(base64 => {
          // VS Code workspace.fs.readFile returns Uint8Array
          const buf = Buffer.from(base64, 'base64');
          return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        });
      },
      writeFile(uri, content) { return _request('workspace:writeFile', { path: uri.fsPath, content: Buffer.from(content).toString('base64') }); },
      stat(uri) { return _request('workspace:stat', { path: uri.fsPath }); },
      delete(uri, options) { return _request('workspace:delete', { path: uri.fsPath, recursive: options?.recursive ?? false }); },
      rename(source, target, options) { return _request('workspace:rename', { source: source.fsPath, target: target.fsPath, overwrite: options?.overwrite ?? false }); },
      copy(source, target, options) { return _request('workspace:copy', { source: source.fsPath, target: target.fsPath, overwrite: options?.overwrite ?? false }); },
      createDirectory(uri) { return _request('workspace:createDirectory', { path: uri.fsPath }); },
      readDirectory(uri) { return _request('workspace:readDirectory', { path: uri.fsPath }); },
      isWritableFileSystem(scheme) { return true; },
    };
  },

  onDidOpenTextDocument: new EventEmitter().event,
  onDidCloseTextDocument: new EventEmitter().event,
  onDidChangeTextDocument: new EventEmitter().event,
  onDidSaveTextDocument: new EventEmitter().event,
  onDidCreateFiles: new EventEmitter().event,
  onDidRenameFiles: new EventEmitter().event,
  onDidDeleteFiles: new EventEmitter().event,
  onDidChangeWorkspaceFolders: new EventEmitter().event,
  onDidGrantWorkspaceTrust: new EventEmitter().event,
  get isTrusted() { return true; },
  get workspaceFile() { return undefined; },
  get name() { return process.env.SINGULARITY_PROJECT_ROOT ? require('path').basename(process.env.SINGULARITY_PROJECT_ROOT) : undefined; },
  get notebookDocuments() { return []; },
  onDidOpenNotebookDocument: new EventEmitter().event,
  onDidCloseNotebookDocument: new EventEmitter().event,
  onDidChangeNotebookDocument: new EventEmitter().event,
  onDidSaveNotebookDocument: new EventEmitter().event,

  registerTextDocumentContentProvider(scheme, provider) {
    return new Disposable(() => {});
  },

  applyEdit(edit) { return Promise.resolve(true); },
  updateWorkspaceFolders() { return false; },
  findFiles(include, exclude, maxResults) { return Promise.resolve([]); },
  saveAll(includeUntitled) { return Promise.resolve(true); },
  registerFileSystemProvider(scheme, provider, options) { return new Disposable(() => {}); },
  registerTaskProvider(type, provider) { return new Disposable(() => {}); },
  asRelativePath(pathOrUri) {
    const p = typeof pathOrUri === 'string' ? pathOrUri : (pathOrUri?.fsPath || pathOrUri?.path || '');
    const root = process.env.SINGULARITY_PROJECT_ROOT;
    if (root) {
      const normP = p.replace(/\\/g, '/');
      const normRoot = root.replace(/\\/g, '/') + '/';
      if (normP.startsWith(normRoot)) return normP.substring(normRoot.length);
    }
    return p;
  },
};

// ============================================================
// env
// ============================================================

const env = {
  appName: 'Singularity',
  appRoot: process.env.SINGULARITY_APP_ROOT || '',
  appHost: 'desktop',
  uiKind: 1, // UIKind.Desktop
  language: 'en',
  machineId: 'singularity-' + require('os').hostname(),
  sessionId: Date.now().toString(36),
  uriScheme: 'singularity',
  clipboard: {
    readText() { return _request('env:clipboardRead', {}); },
    writeText(text) { _send('env:clipboardWrite', { text }); return Promise.resolve(); },
  },
  openExternal(uri) {
    _send('env:openExternal', { uri: uri.toString() });
    return Promise.resolve(true);
  },
  asExternalUri(uri) {
    // Convert vscode:// URI to singularity:// for our app's protocol handler
    const uriStr = uri.toString().replace(/^vscode:\/\//, 'singularity://');
    return Promise.resolve(Uri.parse(uriStr));
  },
  get shell() { return process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'; },
  get remoteName() { return undefined; },
  get isNewAppInstall() { return false; },
  get isTelemetryEnabled() { return false; },
  onDidChangeTelemetryEnabled: new EventEmitter().event,
  createTelemetryLogger(sender) {
    return { logUsage() {}, logError() {}, dispose() {}, onDidChangeEnableStates: new EventEmitter().event, isUsageEnabled: false, isErrorsEnabled: false };
  },
  get logLevel() { return 2; }, // Info
  onDidChangeLogLevel: new EventEmitter().event,
};

// ============================================================
// languages
// ============================================================

const languages = {
  registerCodeActionsProvider() { return new Disposable(() => {}); },
  registerCompletionItemProvider() { return new Disposable(() => {}); },
  registerHoverProvider() { return new Disposable(() => {}); },
  registerDefinitionProvider() { return new Disposable(() => {}); },
  registerDocumentFormattingEditProvider() { return new Disposable(() => {}); },
  registerCodeLensProvider() { return new Disposable(() => {}); },
  registerDocumentLinkProvider() { return new Disposable(() => {}); },
  registerReferenceProvider() { return new Disposable(() => {}); },
  registerRenameProvider() { return new Disposable(() => {}); },
  registerSignatureHelpProvider() { return new Disposable(() => {}); },
  registerTypeDefinitionProvider() { return new Disposable(() => {}); },
  registerImplementationProvider() { return new Disposable(() => {}); },
  registerDocumentSymbolProvider() { return new Disposable(() => {}); },
  registerWorkspaceSymbolProvider() { return new Disposable(() => {}); },
  registerDocumentRangeFormattingEditProvider() { return new Disposable(() => {}); },
  registerOnTypeFormattingEditProvider() { return new Disposable(() => {}); },
  registerColorProvider() { return new Disposable(() => {}); },
  registerFoldingRangeProvider() { return new Disposable(() => {}); },
  registerDeclarationProvider() { return new Disposable(() => {}); },
  registerSelectionRangeProvider() { return new Disposable(() => {}); },
  registerDocumentSemanticTokensProvider() { return new Disposable(() => {}); },
  registerDocumentRangeSemanticTokensProvider() { return new Disposable(() => {}); },
  registerInlayHintsProvider() { return new Disposable(() => {}); },
  registerLinkedEditingRangeProvider() { return new Disposable(() => {}); },
  registerEvaluatableExpressionProvider() { return new Disposable(() => {}); },
  registerInlineValuesProvider() { return new Disposable(() => {}); },
  registerCallHierarchyProvider() { return new Disposable(() => {}); },
  registerTypeHierarchyProvider() { return new Disposable(() => {}); },
  registerInlineCompletionItemProvider() { return new Disposable(() => {}); },
  setLanguageConfiguration() { return new Disposable(() => {}); },
  setTextDocumentLanguage(doc, lang) { return Promise.resolve(doc); },
  match(selector, document) { return 10; },
  getDiagnostics(uri) { if (uri) return []; return []; },
  onDidChangeDiagnostics: new EventEmitter().event,
  createDiagnosticCollection(name) {
    return { name, set() {}, delete() {}, clear() {}, dispose() {}, forEach() {}, get() { return []; }, has() { return false; } };
  },
};

// ============================================================
// Enums & Constants
// ============================================================

const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 };
const StatusBarAlignment = { Left: 1, Right: 2 };
const ExtensionMode = { Production: 1, Development: 2, Test: 3 };
const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 };
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const ProgressLocation = { Notification: 15, SourceControl: 1, Window: 10 };
const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 };
const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
const EndOfLine = { LF: 1, CRLF: 2 };
const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };
const TextDocumentSaveReason = { Manual: 1, AfterDelay: 2, FocusOut: 3 };
const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
const FilePermission = { Readonly: 1 };
const IndentAction = { None: 0, Indent: 1, IndentOutdent: 2, Outdent: 3 };
const CompletionItemKind = { Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13, Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20, Struct: 21, Event: 22, Operator: 23, TypeParameter: 24 };
const CompletionTriggerKind = { Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2 };
const SymbolKind = { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21, Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 };
const CodeActionKind = {
  Empty: { value: '' }, QuickFix: { value: 'quickfix' }, Refactor: { value: 'refactor' },
  RefactorExtract: { value: 'refactor.extract' }, RefactorInline: { value: 'refactor.inline' },
  RefactorMove: { value: 'refactor.move' }, RefactorRewrite: { value: 'refactor.rewrite' },
  Source: { value: 'source' }, SourceOrganizeImports: { value: 'source.organizeImports' },
  SourceFixAll: { value: 'source.fixAll' }, Notebook: { value: 'notebook' },
  append(id) { return { value: this.value + '.' + id, append(i) { return { value: this.value + '.' + i }; }, contains(other) { return true; } }; },
  contains(other) { return true; },
};
const InlineCompletionTriggerKind = { Invoke: 0, Automatic: 1 };
const DocumentHighlightKind = { Text: 0, Read: 1, Write: 2 };
const SignatureHelpTriggerKind = { Invoke: 1, TriggerCharacter: 2, ContentChange: 3 };
const SemanticTokensLegend = class { constructor(tokenTypes, tokenModifiers) { this.tokenTypes = tokenTypes || []; this.tokenModifiers = tokenModifiers || []; } };
const SemanticTokensBuilder = class { constructor(legend) { this._legend = legend; this._data = []; } push(line, char, length, tokenType, tokenModifiers) { this._data.push(line, char, length, tokenType, tokenModifiers || 0); } build() { return { data: new Uint32Array(this._data) }; } };

class FileSystemError extends Error {
  constructor(messageOrUri) { super(typeof messageOrUri === 'string' ? messageOrUri : 'FileSystemError'); this.code = 'Unknown'; }
  static FileNotFound(uri) { const e = new FileSystemError(uri); e.code = 'FileNotFound'; return e; }
  static FileExists(uri) { const e = new FileSystemError(uri); e.code = 'FileExists'; return e; }
  static FileNotADirectory(uri) { const e = new FileSystemError(uri); e.code = 'FileNotADirectory'; return e; }
  static FileIsADirectory(uri) { const e = new FileSystemError(uri); e.code = 'FileIsADirectory'; return e; }
  static NoPermissions(uri) { const e = new FileSystemError(uri); e.code = 'NoPermissions'; return e; }
  static Unavailable(uri) { const e = new FileSystemError(uri); e.code = 'Unavailable'; return e; }
}

class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind; }
}

class CompletionList {
  constructor(items, isIncomplete) { this.items = items || []; this.isIncomplete = isIncomplete || false; }
}

class CodeAction {
  constructor(title, kind) { this.title = title; this.kind = kind; }
}

class CodeLens {
  constructor(range, command) { this.range = range; this.command = command; this.isResolved = !!command; }
}

class DocumentLink {
  constructor(range, target) { this.range = range; this.target = target; }
}

class Location {
  constructor(uri, rangeOrPosition) { this.uri = uri; this.range = rangeOrPosition; }
}

class Diagnostic {
  constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity !== undefined ? severity : 0; }
}

class Hover {
  constructor(contents, range) { this.contents = contents; this.range = range; }
}

class SnippetString {
  constructor(value) { this.value = value || ''; }
  appendText(s) { this.value += s.replace(/[$}\\]/g, '\\$&'); return this; }
  appendTabstop(n) { this.value += '$' + (n || 0); return this; }
  appendPlaceholder(value, n) { if (typeof value === 'function') { const nested = new SnippetString(); value(nested); this.value += '${' + (n || 0) + ':' + nested.value + '}'; } else { this.value += '${' + (n || 0) + ':' + value + '}'; } return this; }
  appendChoice(values, n) { this.value += '${' + (n || 0) + '|' + values.join(',') + '|}'; return this; }
  appendVariable(name, defaultValue) { if (typeof defaultValue === 'function') { const nested = new SnippetString(); defaultValue(nested); this.value += '${' + name + ':' + nested.value + '}'; } else if (typeof defaultValue === 'string') { this.value += '${' + name + ':' + defaultValue + '}'; } else { this.value += '$' + name; } return this; }
}

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isEqual(other) { return this.line === other.line && this.character === other.character; }
  isBefore(other) { return this.line < other.line || (this.line === other.line && this.character < other.character); }
  isAfter(other) { return !this.isEqual(other) && !this.isBefore(other); }
  translate(lineOrChange, character) {
    if (typeof lineOrChange === 'object') return new Position(this.line + (lineOrChange.lineDelta || 0), this.character + (lineOrChange.characterDelta || 0));
    return new Position(this.line + (lineOrChange || 0), this.character + (character || 0));
  }
  with(lineOrChange, character) {
    if (typeof lineOrChange === 'object') return new Position(lineOrChange.line !== undefined ? lineOrChange.line : this.line, lineOrChange.character !== undefined ? lineOrChange.character : this.character);
    return new Position(lineOrChange !== undefined ? lineOrChange : this.line, character !== undefined ? character : this.character);
  }
  compareTo(other) { return this.line === other.line ? this.character - other.character : this.line - other.line; }
}

class Range {
  constructor(startLineOrStart, startCharOrEnd, endLine, endChar) {
    if (startLineOrStart instanceof Position) {
      this.start = startLineOrStart;
      this.end = startCharOrEnd instanceof Position ? startCharOrEnd : startLineOrStart;
    } else {
      this.start = new Position(startLineOrStart, startCharOrEnd);
      this.end = new Position(endLine || 0, endChar || 0);
    }
  }
  get isEmpty() { return this.start.isEqual(this.end); }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(posOrRange) { return true; }
  isEqual(other) { return this.start.isEqual(other.start) && this.end.isEqual(other.end); }
  intersection(range) { return this; }
  union(other) { return this; }
  with(startOrChange, end) { return this; }
}

class Selection extends Range {
  constructor(anchorLine, anchorChar, activeLine, activeChar) {
    if (anchorLine instanceof Position) {
      super(anchorLine, anchorChar);
      this.anchor = anchorLine;
      this.active = anchorChar instanceof Position ? anchorChar : anchorLine;
    } else {
      super(anchorLine, anchorChar, activeLine, activeChar);
      this.anchor = new Position(anchorLine, anchorChar);
      this.active = new Position(activeLine || 0, activeChar || 0);
    }
  }
  get isReversed() { return this.active.isBefore(this.anchor); }
}

class TextEdit {
  constructor(range, newText) { this.range = range; this.newText = newText; }
  static replace(range, newText) { return new TextEdit(range, newText); }
  static insert(position, newText) { return new TextEdit(new Range(position, position), newText); }
  static delete(range) { return new TextEdit(range, ''); }
}

class WorkspaceEdit {
  constructor() { this._edits = []; }
  replace(uri, range, newText) { this._edits.push({ uri, range, newText }); }
  insert(uri, position, newText) { this._edits.push({ uri, range: new Range(position, position), newText }); }
  delete(uri, range) { this._edits.push({ uri, range, newText: '' }); }
  has(uri) { return this._edits.some(e => e.uri.toString() === uri.toString()); }
  get size() { return this._edits.length; }
}

class ThemeColor {
  constructor(id) { this.id = id; }
}

class ThemeIcon {
  constructor(id, color) { this.id = id; this.color = color; }
  static get File() { return new ThemeIcon('file'); }
  static get Folder() { return new ThemeIcon('folder'); }
}

class MarkdownString {
  constructor(value, supportThemeIcons) {
    this.value = value || '';
    this.isTrusted = false;
    this.supportThemeIcons = supportThemeIcons || false;
    this.supportHtml = false;
  }
  appendText(value) { this.value += value; return this; }
  appendMarkdown(value) { this.value += value; return this; }
  appendCodeblock(code, language) { this.value += '\n```' + (language || '') + '\n' + code + '\n```\n'; return this; }
}

class NotebookCellOutputItem {
  constructor(data, mime) {
    this.data = data instanceof Uint8Array ? data : Buffer.from(data || '');
    this.mime = mime || 'text/plain';
  }
  static text(value, mime) { return new NotebookCellOutputItem(Buffer.from(value || ''), mime || 'text/plain'); }
  static json(value, mime) { return new NotebookCellOutputItem(Buffer.from(JSON.stringify(value)), mime || 'text/x-json'); }
  static stdout(value) { return new NotebookCellOutputItem(Buffer.from(value || ''), 'application/vnd.code.notebook.stdout'); }
  static stderr(value) { return new NotebookCellOutputItem(Buffer.from(value || ''), 'application/vnd.code.notebook.stderr'); }
  static error(err) {
    const obj = { name: err?.name || 'Error', message: err?.message || '', stack: err?.stack || '' };
    return new NotebookCellOutputItem(Buffer.from(JSON.stringify(obj)), 'application/vnd.code.notebook.error');
  }
}

class NotebookCellOutput {
  constructor(items, metadata) {
    this.items = items || [];
    this.metadata = metadata;
  }
}

class NotebookRange {
  constructor(start, end) { this.start = start; this.end = end; }
  get isEmpty() { return this.start === this.end; }
  with(change) { return new NotebookRange(change?.start ?? this.start, change?.end ?? this.end); }
}

class NotebookEdit {
  constructor(range, newCells) { this.range = range; this.newCells = newCells || []; }
  static replaceCells(range, newCells) { return new NotebookEdit(range, newCells); }
  static insertCells(index, newCells) { return new NotebookEdit(new NotebookRange(index, index), newCells); }
  static deleteCells(range) { return new NotebookEdit(range, []); }
  static updateCellMetadata(index, metadata) { const e = new NotebookEdit(new NotebookRange(index, index + 1), []); e.newCellMetadata = metadata; return e; }
}

class TreeItem {
  constructor(labelOrUri, collapsibleState) {
    if (typeof labelOrUri === 'string') this.label = labelOrUri;
    else this.resourceUri = labelOrUri;
    this.collapsibleState = collapsibleState || 0;
  }
}

const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
const QuickPickItemKind = { Default: 0, Separator: -1 };

// ============================================================
// Additional Classes & Enums (VS Code API completeness)
// ============================================================

class InlineCompletionItem {
  constructor(insertText, range, command) {
    this.insertText = insertText;
    this.range = range;
    this.command = command;
    this.filterText = undefined;
  }
}

class InlineCompletionList {
  constructor(items) {
    this.items = items || [];
  }
}

const LogLevel = { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 };

class TabInputText {
  constructor(uri) { this.uri = uri; }
}

class TabInputTextDiff {
  constructor(original, modified) { this.original = original; this.modified = modified; }
}

class TabInputCustom {
  constructor(uri, viewType) { this.uri = uri; this.viewType = viewType; }
}

class TabInputNotebook {
  constructor(uri, notebookType) { this.uri = uri; this.notebookType = notebookType; }
}

class TabInputNotebookDiff {
  constructor(original, modified, notebookType) { this.original = original; this.modified = modified; this.notebookType = notebookType; }
}

class TabInputWebview {
  constructor(viewType) { this.viewType = viewType; }
}

class TabInputTerminal {
  constructor() {}
}

const TestRunProfileKind = { Run: 1, Debug: 2, Coverage: 3 };

class TestMessage {
  constructor(message) {
    this.message = message;
    this.expectedOutput = undefined;
    this.actualOutput = undefined;
    this.location = undefined;
  }
  static diff(message, expected, actual) {
    const m = new TestMessage(message);
    m.expectedOutput = expected;
    m.actualOutput = actual;
    return m;
  }
}

class TestRunRequest {
  constructor(include, exclude, profile, continuous) {
    this.include = include;
    this.exclude = exclude;
    this.profile = profile;
    this.continuous = continuous || false;
  }
}

class TestTag {
  constructor(id) { this.id = id; }
}

class RelativePattern {
  constructor(base, pattern) {
    this.baseUri = typeof base === 'string' ? Uri.file(base) : (base.uri || base);
    this.base = typeof base === 'string' ? base : (base.uri?.fsPath || base.fsPath || base.path || '');
    this.pattern = pattern;
  }
}

const TextDocumentChangeReason = { Undo: 1, Redo: 2 };

class FileDecoration {
  constructor(badge, tooltip, color) {
    this.badge = badge;
    this.tooltip = tooltip;
    this.color = color;
    this.propagate = false;
  }
}

const QuickInputButtons = {
  Back: { iconPath: new ThemeIcon('arrow-left') },
};

const UIKind = { Desktop: 1, Web: 2 };
const ExtensionKind = { UI: 1, Workspace: 2 };

class LanguageModelChatMessage {
  constructor(role, content, name) {
    this.role = role;
    this.content = typeof content === 'string' ? [{ type: 'text', value: content }] : content;
    this.name = name;
  }
  static User(content, name) { return new LanguageModelChatMessage(1, content, name); }
  static Assistant(content, name) { return new LanguageModelChatMessage(2, content, name); }
}

const LanguageModelChatMessageRole = { User: 1, Assistant: 2 };

class LanguageModelTextPart {
  constructor(value) { this.value = value; this.type = 'text'; }
}

class LanguageModelToolResultPart {
  constructor(toolCallId, content) { this.toolCallId = toolCallId; this.content = content; this.type = 'toolResult'; }
}

class LanguageModelToolCallPart {
  constructor(name, toolCallId, input) { this.name = name; this.callId = toolCallId; this.input = input; this.type = 'toolCall'; }
}

class LanguageModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LanguageModelError';
  }
  static NotFound(message) { return new LanguageModelError(message || 'Not found'); }
  static NoPermissions(message) { return new LanguageModelError(message || 'No permissions'); }
  static Blocked(message) { return new LanguageModelError(message || 'Blocked'); }
}

class ChatResponseMarkdownPart {
  constructor(value) { this.value = value instanceof MarkdownString ? value : new MarkdownString(value); }
}

class ChatResponseAnchorPart {
  constructor(value, title) { this.value = value; this.title = title; }
}

class ChatResponseProgressPart {
  constructor(value) { this.value = value; }
}

class ChatResponseFileTreePart {
  constructor(value, baseUri) { this.value = value; this.baseUri = baseUri; }
}

class ChatResponseCommandButtonPart {
  constructor(command) { this.command = command; }
}

class ChatResponseReferencePart {
  constructor(value, iconPath) { this.value = value; this.iconPath = iconPath; }
}

class ChatRequestTurn {
  constructor(prompt, command, references, participant) {
    this.prompt = prompt; this.command = command; this.references = references; this.participant = participant;
  }
}

class ChatResponseTurn {
  constructor(response, result, participant, command) {
    this.response = response; this.result = result; this.participant = participant; this.command = command;
  }
}

class FunctionBreakpoint {
  constructor(functionName, enabled, condition, hitCondition, logMessage) {
    this.functionName = functionName;
    this.enabled = enabled !== undefined ? enabled : true;
    this.condition = condition;
    this.hitCondition = hitCondition;
    this.logMessage = logMessage;
  }
}

class SourceBreakpoint {
  constructor(location, enabled, condition, hitCondition, logMessage) {
    this.location = location;
    this.enabled = enabled !== undefined ? enabled : true;
    this.condition = condition;
    this.hitCondition = hitCondition;
    this.logMessage = logMessage;
  }
}

class DebugAdapterExecutable {
  constructor(command, args, options) { this.command = command; this.args = args || []; this.options = options; }
}

class DebugAdapterServer {
  constructor(port, host) { this.port = port; this.host = host; }
}

class DebugAdapterInlineImplementation {
  constructor(implementation) { this.implementation = implementation; }
}

class DebugAdapterNamedPipeServer {
  constructor(path) { this.path = path; }
}

const DebugConfigurationProviderTriggerKind = { Initial: 1, Dynamic: 2 };
const DebugConsoleMode = { Separate: 0, MergeWithParent: 1 };

class Task {
  constructor(definition, scope, name, source, execution, problemMatchers) {
    this.definition = definition;
    this.scope = scope;
    this.name = name;
    this.source = source;
    this.execution = execution;
    this.problemMatchers = problemMatchers || [];
    this.isBackground = false;
    this.presentationOptions = {};
    this.group = undefined;
    this.detail = undefined;
  }
}

class TaskGroup {
  constructor(id, label) { this.id = id; this.label = label; }
}
TaskGroup.Build = new TaskGroup('build', 'Build');
TaskGroup.Rebuild = new TaskGroup('rebuild', 'Rebuild');
TaskGroup.Clean = new TaskGroup('clean', 'Clean');
TaskGroup.Test = new TaskGroup('test', 'Test');

class ShellExecution {
  constructor(commandLine, optionsOrArgs, options) {
    if (typeof commandLine === 'string' && !Array.isArray(optionsOrArgs)) {
      this.commandLine = commandLine;
      this.options = optionsOrArgs;
    } else {
      this.command = commandLine;
      this.args = optionsOrArgs || [];
      this.options = options;
    }
  }
}

class ProcessExecution {
  constructor(process, argsOrOptions, options) {
    this.process = process;
    if (Array.isArray(argsOrOptions)) {
      this.args = argsOrOptions;
      this.options = options;
    } else {
      this.args = [];
      this.options = argsOrOptions;
    }
  }
}

class CustomExecution {
  constructor(callback) { this._callback = callback; }
}

const TaskScope = { Global: 1, Workspace: 2 };
const TaskRevealKind = { Always: 1, Silent: 2, Never: 3 };
const TaskPanelKind = { Shared: 1, Dedicated: 2, New: 3 };

const ShellQuoting = { Escape: 1, Strong: 2, Weak: 3 };
class ShellQuotedString {
  constructor(value, quoting) { this.value = value; this.quoting = quoting; }
}

// VS Code text editing types
class TextEditorEdit {
  constructor() { this._edits = []; }
  replace(location, value) { this._edits.push({ type: 'replace', location, value }); }
  insert(location, value) { this._edits.push({ type: 'insert', location, value }); }
  delete(location) { this._edits.push({ type: 'delete', location }); }
  setEndOfLine(endOfLine) {}
}

const DecorationRangeBehavior = { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 };
const TextEditorCursorStyle = { Line: 1, Block: 2, Underline: 3, LineThin: 4, BlockOutline: 5, UnderlineThin: 6 };
const TextEditorLineNumbersType = { Off: 0, On: 1, Relative: 2 };
const TextEditorSelectionChangeKind = { Keyboard: 1, Mouse: 2, Command: 3 };

class CallHierarchyItem {
  constructor(kind, name, detail, uri, range, selectionRange) {
    this.kind = kind; this.name = name; this.detail = detail;
    this.uri = uri; this.range = range; this.selectionRange = selectionRange;
  }
}

class TypeHierarchyItem {
  constructor(kind, name, detail, uri, range, selectionRange) {
    this.kind = kind; this.name = name; this.detail = detail;
    this.uri = uri; this.range = range; this.selectionRange = selectionRange;
  }
}

class InlayHint {
  constructor(position, label, kind) { this.position = position; this.label = label; this.kind = kind; }
}
const InlayHintKind = { Type: 1, Parameter: 2 };

class FoldingRange {
  constructor(start, end, kind) { this.start = start; this.end = end; this.kind = kind; }
}
const FoldingRangeKind = { Comment: 1, Imports: 2, Region: 3 };

class SelectionRange {
  constructor(range, parent) { this.range = range; this.parent = parent; }
}

class LinkedEditingRanges {
  constructor(ranges, wordPattern) { this.ranges = ranges; this.wordPattern = wordPattern; }
}

class DocumentDropEdit {
  constructor(insertText) { this.insertText = insertText; }
}

class DocumentPasteEdit {
  constructor(insertText, id, label) { this.insertText = insertText; this.id = id; this.label = label; }
}

const CommentThreadCollapsibleState = { Collapsed: 0, Expanded: 1 };
const CommentMode = { Editing: 0, Preview: 1 };
const CommentThreadState = { Unresolved: 0, Resolved: 1 };

class EvaluatableExpression {
  constructor(range, expression) { this.range = range; this.expression = expression; }
}

class InlineValueText {
  constructor(range, text) { this.range = range; this.text = text; }
}
class InlineValueVariableLookup {
  constructor(range, variableName, caseSensitiveLookup) { this.range = range; this.variableName = variableName; this.caseSensitiveLookup = caseSensitiveLookup; }
}
class InlineValueEvaluatableExpression {
  constructor(range, expression) { this.range = range; this.expression = expression; }
}
class InlineValueContext {
  constructor(frameId, stoppedLocation) { this.frameId = frameId; this.stoppedLocation = stoppedLocation; }
}

class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    this.name = name; this.detail = detail; this.kind = kind;
    this.range = range; this.selectionRange = selectionRange;
    this.children = [];
  }
}

class SymbolInformation {
  constructor(name, kind, containerName, location) {
    this.name = name; this.kind = kind; this.containerName = containerName || '';
    this.location = location;
  }
}

class SignatureHelp {
  constructor() { this.signatures = []; this.activeSignature = 0; this.activeParameter = 0; }
}

class SignatureInformation {
  constructor(label, documentation) { this.label = label; this.documentation = documentation; this.parameters = []; this.activeParameter = undefined; }
}

class ParameterInformation {
  constructor(label, documentation) { this.label = label; this.documentation = documentation; }
}

class ColorInformation {
  constructor(range, color) { this.range = range; this.color = color; }
}

class ColorPresentation {
  constructor(label) { this.label = label; }
}

class Color {
  constructor(red, green, blue, alpha) { this.red = red; this.green = green; this.blue = blue; this.alpha = alpha; }
}

class NotebookCellData {
  constructor(kind, value, languageId) { this.kind = kind; this.value = value; this.languageId = languageId; }
}

class NotebookData {
  constructor(cells) { this.cells = cells || []; }
}

const NotebookCellKind = { Markup: 1, Code: 2 };
const NotebookEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 };
const NotebookControllerAffinity = { Default: 1, Preferred: 2 };

// ============================================================
// Extension Context (created per extension)
// ============================================================

let _extensionId = '';
let _extensionPath = '';

function _createExtensionContext(id, extPath) {
  _extensionId = id;
  _extensionPath = extPath;

  const fs = require('fs');
  const pathMod = require('path');

  // Load extension's package.json — used for configuration defaults and context.extension.packageJSON
  let pkg = {};
  try {
    const pkgPath = pathMod.join(extPath, 'package.json');
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const configs = pkg?.contributes?.configuration;
    const configArray = Array.isArray(configs) ? configs : configs ? [configs] : [];
    for (const config of configArray) {
      const props = config?.properties || {};
      for (const [fullKey, def] of Object.entries(props)) {
        if (def && 'default' in def) {
          _configDefaults.set(fullKey, def.default);
        }
      }
    }
  } catch (e) {
    // No package.json or parse error — continue without defaults
  }

  // Ensure storage directories exist — extensions expect these paths to be writable
  const storagePath = pathMod.join(extPath, '.storage');
  const globalStoragePath = pathMod.join(extPath, '.global-storage');
  const logPath = pathMod.join(extPath, '.logs');
  try { fs.mkdirSync(storagePath, { recursive: true }); } catch {}
  try { fs.mkdirSync(globalStoragePath, { recursive: true }); } catch {}
  try { fs.mkdirSync(logPath, { recursive: true }); } catch {}

  const globalStateData = {};
  const workspaceStateData = {};

  const globalState = {
    keys() { return Object.keys(globalStateData); },
    get(key, defaultValue) { return key in globalStateData ? globalStateData[key] : defaultValue; },
    update(key, value) { globalStateData[key] = value; return Promise.resolve(); },
    setKeysForSync(keys) {},
  };

  const workspaceState = {
    keys() { return Object.keys(workspaceStateData); },
    get(key, defaultValue) { return key in workspaceStateData ? workspaceStateData[key] : defaultValue; },
    update(key, value) { workspaceStateData[key] = value; return Promise.resolve(); },
  };

  const secrets = {
    get(key) { return _request('secrets:get', { key }); },
    store(key, value) { return _request('secrets:store', { key, value }).then(() => {}); },
    delete(key) { return _request('secrets:delete', { key }).then(() => {}); },
    onDidChange: new EventEmitter().event,
  };

  return {
    subscriptions: [],
    workspaceState,
    globalState,
    secrets,
    extensionUri: Uri.file(extPath),
    extensionPath: extPath,
    environmentVariableCollection: { persistent: false, description: '', replace() {}, append() {}, prepend() {}, get() {}, forEach() {}, delete() {}, clear() {}, getScoped() { return this; } },
    storageUri: Uri.file(storagePath),
    globalStorageUri: Uri.file(globalStoragePath),
    logUri: Uri.file(logPath),
    extensionMode: ExtensionMode.Production,
    extension: { id, extensionUri: Uri.file(extPath), extensionPath: extPath, isActive: true, packageJSON: pkg, exports: undefined, extensionKind: 1 },
    logPath,
    storagePath,
    globalStoragePath,
    asAbsolutePath(relativePath) { return pathMod.join(extPath, relativePath); },
    languageModelAccessInformation: { onDidChange: new EventEmitter().event, canSendRequest() { return true; } },
  };
}

// ============================================================
// Module Export (the vscode namespace)
// ============================================================

const vscodeModule = {
  // Version — mimic a recent VS Code version to satisfy engines.vscode checks.
  // Must be >= 1.96.2 for OpenAI Codex extension.
  version: '1.100.0',

  // Core types
  Disposable,
  EventEmitter,
  CancellationTokenSource,
  Uri,
  Position,
  Range,
  Selection,
  TextEdit,
  WorkspaceEdit,
  ThemeColor,
  ThemeIcon,
  MarkdownString,
  TreeItem,
  TreeItemCollapsibleState,
  NotebookCellOutputItem,
  NotebookCellOutput,
  NotebookRange,
  NotebookEdit,
  FileSystemError,
  CompletionItem,
  CompletionList,
  CodeAction,
  CodeLens,
  DocumentLink,
  Location,
  Diagnostic,
  Hover,
  SnippetString,
  SemanticTokensLegend,
  SemanticTokensBuilder,

  // Enums
  ViewColumn,
  StatusBarAlignment,
  ExtensionMode,
  ColorThemeKind,
  ConfigurationTarget,
  ProgressLocation,
  TextEditorRevealType,
  DiagnosticSeverity,
  EndOfLine,
  OverviewRulerLane,
  TextDocumentSaveReason,
  FileType,
  FilePermission,
  IndentAction,
  CompletionItemKind,
  CompletionTriggerKind,
  SymbolKind,
  CodeActionKind,
  InlineCompletionTriggerKind,
  DocumentHighlightKind,
  SignatureHelpTriggerKind,

  // Namespaces
  commands,
  window,
  workspace,
  env,
  languages,

  // ====== authentication namespace (IPC-backed) ======
  authentication: (() => {
    const _authProviders = new Map();
    const _sessionChangeEmitter = new EventEmitter();
    return {
      getSession(providerId, scopes, options) {
        // Try registered provider first
        const provider = _authProviders.get(providerId);
        if (provider) {
          return provider.getSessions(scopes).then(sessions => {
            if (sessions.length > 0) return sessions[0];
            if (options?.createIfNone) {
              return provider.createSession(scopes);
            }
            return undefined;
          });
        }
        // Fall back to IPC for host-managed sessions
        return _request('auth:getSession', { providerId, scopes, options }).catch(() => undefined);
      },
      registerAuthenticationProvider(id, label, provider, options) {
        _authProviders.set(id, provider);
        return new Disposable(() => { _authProviders.delete(id); });
      },
      get onDidChangeSessions() { return _sessionChangeEmitter.event; },
    };
  })(),

  // ====== extensions namespace (IPC-backed) ======
  extensions: (() => {
    const _changeEmitter = new EventEmitter();
    let _cachedAll = [];
    // Async-refresh the cache in the background
    const _refreshCache = () => {
      _request('extensions:getAll', {}).then(exts => {
        if (Array.isArray(exts)) {
          _cachedAll = exts.map(e => ({
            id: e.id,
            extensionUri: Uri.file(e.extensionPath || ''),
            extensionPath: e.extensionPath || '',
            isActive: e.isActive ?? true,
            packageJSON: {},
            extensionKind: ExtensionKind.Workspace,
            exports: undefined,
            activate() { return Promise.resolve(undefined); },
          }));
        }
      }).catch(() => {});
    };
    // Kick off initial cache population
    setTimeout(_refreshCache, 100);
    return {
      getExtension(id) {
        // Check cache first
        const cached = _cachedAll.find(e => e.id === id || e.id.toLowerCase() === id.toLowerCase());
        if (cached) return cached;
        // Trigger async refresh for next call
        _refreshCache();
        // Return a stub so callers don't crash
        return {
          id,
          extensionUri: Uri.file(''),
          extensionPath: '',
          isActive: false,
          packageJSON: {},
          extensionKind: ExtensionKind.Workspace,
          exports: undefined,
          activate() { return Promise.resolve(undefined); },
        };
      },
      get all() {
        // Trigger a background refresh so next access is up-to-date
        _refreshCache();
        return _cachedAll;
      },
      get onDidChange() { return _changeEmitter.event; },
    };
  })(),

  // ====== l10n namespace ======
  l10n: {
    t(messageOrOptions, ...args) {
      // If first arg is an object with message property
      let message = typeof messageOrOptions === 'string' ? messageOrOptions : messageOrOptions?.message || '';
      if (typeof messageOrOptions === 'object' && messageOrOptions.args) {
        args = Array.isArray(messageOrOptions.args) ? messageOrOptions.args : Object.values(messageOrOptions.args);
      }
      // Replace {0}, {1}, ... or {name} placeholders
      if (args.length > 0) {
        for (let i = 0; i < args.length; i++) {
          message = message.replace(new RegExp('\\{' + i + '\\}', 'g'), String(args[i]));
        }
      }
      return message;
    },
    get bundle() { return undefined; },
    get uri() { return undefined; },
  },

  // ====== debug namespace ======
  debug: (() => {
    const _configProviders = new Map();
    const _adapterFactories = new Map();
    const _startEmitter = new EventEmitter();
    const _terminateEmitter = new EventEmitter();
    const _changeActiveEmitter = new EventEmitter();
    const _breakpointChangeEmitter = new EventEmitter();
    let _activeSession = undefined;
    return {
      registerDebugConfigurationProvider(debugType, provider, triggerKind) {
        _configProviders.set(debugType, provider);
        return new Disposable(() => { _configProviders.delete(debugType); });
      },
      registerDebugAdapterDescriptorFactory(debugType, factory) {
        _adapterFactories.set(debugType, factory);
        return new Disposable(() => { _adapterFactories.delete(debugType); });
      },
      registerDebugAdapterTrackerFactory(debugType, factory) {
        return new Disposable(() => {});
      },
      startDebugging(folder, nameOrConfig, parentSessionOrOptions) {
        return Promise.resolve(false);
      },
      stopDebugging(session) {
        return Promise.resolve();
      },
      addBreakpoints(breakpoints) {},
      removeBreakpoints(breakpoints) {},
      asDebugSourceUri(source, session) {
        return Uri.file(source.path || '');
      },
      get activeDebugSession() { return _activeSession; },
      get activeStackItem() { return undefined; },
      get breakpoints() { return []; },
      get onDidStartDebugSession() { return _startEmitter.event; },
      get onDidTerminateDebugSession() { return _terminateEmitter.event; },
      get onDidChangeActiveDebugSession() { return _changeActiveEmitter.event; },
      get onDidChangeBreakpoints() { return _breakpointChangeEmitter.event; },
      get onDidReceiveDebugSessionCustomEvent() { return new EventEmitter().event; },
      get onDidChangeActiveStackItem() { return new EventEmitter().event; },
    };
  })(),

  // ====== tasks namespace ======
  tasks: (() => {
    const _taskProviders = new Map();
    const _startEmitter = new EventEmitter();
    const _endEmitter = new EventEmitter();
    const _processStartEmitter = new EventEmitter();
    const _processEndEmitter = new EventEmitter();
    return {
      registerTaskProvider(type, provider) {
        _taskProviders.set(type, provider);
        return new Disposable(() => { _taskProviders.delete(type); });
      },
      fetchTasks(filter) {
        const results = [];
        for (const [type, provider] of _taskProviders) {
          if (!filter || filter.type === type) {
            // provideTasks may return a thenable
            try {
              const tasks = provider.provideTasks ? provider.provideTasks(new CancellationTokenSource().token) : [];
              if (tasks && typeof tasks.then === 'function') {
                return tasks.then(t => results.concat(t || []));
              }
              results.push(...(tasks || []));
            } catch (e) {
              console.error('[vscode-shim] Error fetching tasks:', e);
            }
          }
        }
        return Promise.resolve(results);
      },
      executeTask(task) {
        const execution = { task, terminate() {} };
        _startEmitter.fire({ execution });
        return Promise.resolve(execution);
      },
      get taskExecutions() { return []; },
      get onDidStartTask() { return _startEmitter.event; },
      get onDidEndTask() { return _endEmitter.event; },
      get onDidStartTaskProcess() { return _processStartEmitter.event; },
      get onDidEndTaskProcess() { return _processEndEmitter.event; },
    };
  })(),

  // ====== scm namespace ======
  scm: {
    createSourceControl(id, label, rootUri) {
      const _resourceGroups = [];
      const inputBox = {
        value: '', placeholder: '', enabled: true, visible: true,
        _onDidChange: new EventEmitter(),
        get onDidChange() { return this._onDidChange.event; },
      };
      return {
        id, label, rootUri, inputBox,
        count: 0,
        quickDiffProvider: undefined,
        commitTemplate: '',
        acceptInputCommand: undefined,
        statusBarCommands: undefined,
        createResourceGroup(id, label) {
          const group = {
            id, label, resourceStates: [], hideWhenEmpty: false,
            dispose() {
              const idx = _resourceGroups.indexOf(group);
              if (idx >= 0) _resourceGroups.splice(idx, 1);
            },
          };
          _resourceGroups.push(group);
          return group;
        },
        dispose() {},
      };
    },
  },

  // ====== comments namespace ======
  comments: {
    createCommentController(id, label) {
      const _threads = [];
      return {
        id, label,
        commentingRangeProvider: undefined,
        createCommentThread(uri, range, comments) {
          const thread = {
            uri, range, comments: comments || [],
            collapsibleState: CommentThreadCollapsibleState.Expanded,
            canReply: true, contextValue: '', label: '',
            state: CommentThreadState.Unresolved,
            dispose() {
              const idx = _threads.indexOf(thread);
              if (idx >= 0) _threads.splice(idx, 1);
            },
          };
          _threads.push(thread);
          return thread;
        },
        dispose() {},
      };
    },
  },

  // ====== tests namespace ======
  tests: {
    createTestController(id, label) {
      const _items = new Map();
      const _profiles = [];
      return {
        id, label,
        items: {
          get size() { return _items.size; },
          get(id) { return _items.get(id); },
          add(item) { _items.set(item.id, item); },
          delete(id) { _items.delete(id); },
          replace(items) { _items.clear(); items.forEach(i => _items.set(i.id, i)); },
          forEach(callback) { _items.forEach(callback); },
          [Symbol.iterator]() { return _items.entries(); },
        },
        createRunProfile(label, kind, handler, isDefault, tag) {
          const profile = { label, kind, isDefault: isDefault || false, tag, runHandler: handler, dispose() {} };
          _profiles.push(profile);
          return profile;
        },
        createTestItem(id, label, uri) {
          const children = new Map();
          return {
            id, label, uri,
            children: {
              get size() { return children.size; },
              get(id) { return children.get(id); },
              add(item) { children.set(item.id, item); },
              delete(id) { children.delete(id); },
              replace(items) { children.clear(); items.forEach(i => children.set(i.id, i)); },
              forEach(callback) { children.forEach(callback); },
              [Symbol.iterator]() { return children.entries(); },
            },
            range: undefined, error: undefined, busy: false,
            canResolveChildren: false, tags: [], sortText: undefined,
          };
        },
        createTestRun(request, name, persist) {
          return {
            name, token: new CancellationTokenSource().token, isPersisted: persist !== false,
            enqueued(test) {}, started(test) {}, skipped(test) {},
            failed(test, message, duration) {}, errored(test, message, duration) {},
            passed(test, duration) {},
            appendOutput(output, location, test) {},
            end() {},
          };
        },
        invalidateTestResults(items) {},
        refreshHandler: undefined,
        resolveHandler: undefined,
        dispose() {},
      };
    },
  },

  // ====== notebooks namespace ======
  notebooks: {
    createRendererMessaging(rendererId) {
      return {
        onDidReceiveMessage: new EventEmitter().event,
        postMessage(message, editor) { return Promise.resolve(true); },
      };
    },
    registerNotebookCellStatusBarItemProvider(notebookType, provider) {
      return new Disposable(() => {});
    },
    createNotebookController(id, notebookType, label, handler) {
      const _onDidChangeSelectedNotebooks = new EventEmitter();
      return {
        id, notebookType, label, handler,
        supportedLanguages: undefined,
        supportsExecutionOrder: false,
        description: undefined,
        detail: undefined,
        createNotebookCellExecution(cell) {
          let _order = 0;
          return {
            cell, token: new CancellationTokenSource().token,
            get executionOrder() { return _order; },
            set executionOrder(v) { _order = v; },
            start(startTime) {},
            end(success, endTime) {},
            clearOutput(cell) { return Promise.resolve(); },
            replaceOutput(output, cell) { return Promise.resolve(); },
            appendOutput(output, cell) { return Promise.resolve(); },
            replaceOutputItems(items, output) { return Promise.resolve(); },
            appendOutputItems(items, output) { return Promise.resolve(); },
          };
        },
        get onDidChangeSelectedNotebooks() { return _onDidChangeSelectedNotebooks.event; },
        updateNotebookAffinity(notebook, affinity) {},
        interruptHandler: undefined,
        dispose() {},
      };
    },
    registerNotebookSerializer(notebookType, serializer, options) {
      return new Disposable(() => {});
    },
  },

  // ====== chat namespace (VS Code Copilot/Chat API) ======
  chat: (() => {
    const _participants = new Map();
    const _sessionProviders = new Map();
    return {
      createChatParticipant(id, handler) {
        const _onDidReceiveFeedback = new EventEmitter();
        const participant = {
          id, handler,
          iconPath: undefined,
          requestHandler: handler,
          get onDidReceiveFeedback() { return _onDidReceiveFeedback.event; },
          dispose() { _participants.delete(id); },
        };
        _participants.set(id, participant);
        return participant;
      },
      registerChatSessionItemProvider(id, provider) {
        _sessionProviders.set(id, provider);
        return new Disposable(() => { _sessionProviders.delete(id); });
      },
    };
  })(),

  // ====== lm namespace (Language Model) ======
  lm: (() => {
    const _changeEmitter = new EventEmitter();
    const _tools = new Map();
    return {
      selectChatModels(selector) { return Promise.resolve([]); },
      get onDidChangeChatModels() { return _changeEmitter.event; },
      registerTool(name, tool) {
        _tools.set(name, tool);
        return new Disposable(() => { _tools.delete(name); });
      },
      get tools() { return [..._tools.values()]; },
      invokeTool(name, options, token) {
        const tool = _tools.get(name);
        if (tool) return tool.invoke(options, token);
        return Promise.reject(new Error(`Tool not found: ${name}`));
      },
    };
  })(),

  // Telemetry
  TelemetryTrustedValue: class { constructor(v) { this.value = v; } },

  // Additional classes
  InlineCompletionItem,
  InlineCompletionList,
  LogLevel,
  TabInputText,
  TabInputTextDiff,
  TabInputCustom,
  TabInputNotebook,
  TabInputNotebookDiff,
  TabInputWebview,
  TabInputTerminal,
  TestRunProfileKind,
  TestMessage,
  TestRunRequest,
  TestTag,
  RelativePattern,
  TextDocumentChangeReason,
  FileDecoration,
  QuickInputButtons,
  UIKind,
  ExtensionKind,
  LanguageModelChatMessage,
  LanguageModelChatMessageRole,
  LanguageModelTextPart,
  LanguageModelToolResultPart,
  LanguageModelToolCallPart,
  LanguageModelError,
  ChatResponseMarkdownPart,
  ChatResponseAnchorPart,
  ChatResponseProgressPart,
  ChatResponseFileTreePart,
  ChatResponseCommandButtonPart,
  ChatResponseReferencePart,
  ChatRequestTurn,
  ChatResponseTurn,
  FunctionBreakpoint,
  SourceBreakpoint,
  DebugAdapterExecutable,
  DebugAdapterServer,
  DebugAdapterInlineImplementation,
  DebugAdapterNamedPipeServer,
  DebugConfigurationProviderTriggerKind,
  DebugConsoleMode,
  Task,
  TaskGroup,
  ShellExecution,
  ProcessExecution,
  CustomExecution,
  TaskScope,
  TaskRevealKind,
  TaskPanelKind,
  ShellQuoting,
  ShellQuotedString,
  DecorationRangeBehavior,
  TextEditorCursorStyle,
  TextEditorLineNumbersType,
  TextEditorSelectionChangeKind,
  CallHierarchyItem,
  TypeHierarchyItem,
  InlayHint,
  InlayHintKind,
  FoldingRange,
  FoldingRangeKind,
  SelectionRange,
  LinkedEditingRanges,
  DocumentDropEdit,
  DocumentPasteEdit,
  CommentThreadCollapsibleState,
  CommentMode,
  CommentThreadState,
  EvaluatableExpression,
  InlineValueText,
  InlineValueVariableLookup,
  InlineValueEvaluatableExpression,
  InlineValueContext,
  DocumentSymbol,
  SymbolInformation,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  ColorInformation,
  ColorPresentation,
  Color,
  NotebookCellData,
  NotebookData,
  NotebookCellKind,
  NotebookEditorRevealType,
  NotebookControllerAffinity,
  TextEditorEdit,
  QuickPickItemKind,

  // Internal
  _initIPC,
  _handleIncoming,
  _createExtensionContext,
};

module.exports = vscodeModule;
