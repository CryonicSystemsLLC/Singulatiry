/**
 * Extension Host Runner — Spawned as a child process to run VS Code extensions.
 *
 * Usage: node extension-host.cjs <extensionId> <extensionPath> [projectRoot]
 *
 * Communicates with the Singularity main process via newline-delimited JSON on stdio.
 * stdin: receives messages from main process
 * stdout: sends messages to main process
 * stderr: extension console output (forwarded to main process logs)
 */

'use strict';

const path = require('path');
const Module = require('module');

// ============================================================
// Parse arguments
// ============================================================

const extensionId = process.argv[2];
const extensionPath = process.argv[3];
const projectRoot = process.argv[4] || '';

if (!extensionId || !extensionPath) {
  process.stderr.write('[ExtHost] Missing extensionId or extensionPath\n');
  process.exit(1);
}

process.env.SINGULARITY_PROJECT_ROOT = projectRoot;
process.env.SINGULARITY_EXTENSION_ID = extensionId;

// ============================================================
// Hook require('vscode') to return our shim
// ============================================================

const shimPath = path.join(__dirname, 'vscode-shim.cjs');

// Load the shim FIRST, then set up the hook.
// This ensures the cache entry uses the native path (backslashes on Windows).
const vscode = require(shimPath);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'vscode') {
    return shimPath;  // Must match the cache key from the require() above
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

// ============================================================
// stdio IPC
// ============================================================

// Redirect console.log/info/warn/error to stderr so extensions' console output
// doesn't pollute the stdout JSON protocol channel.
const origConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');
console.info = (...args) => process.stderr.write(args.join(' ') + '\n');
console.warn = (...args) => process.stderr.write(args.join(' ') + '\n');
console.error = (...args) => process.stderr.write(args.join(' ') + '\n');

let inputBuffer = '';

function sendToMain(msg) {
  try {
    process.stdout.write(JSON.stringify(msg) + '\n');
  } catch (e) {
    process.stderr.write(`[ExtHost] Failed to send: ${e.message}\n`);
  }
}

// Initialize vscode shim IPC
vscode._initIPC(sendToMain);

// Read incoming messages from main process (newline-delimited JSON)
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  let newlineIdx;
  while ((newlineIdx = inputBuffer.indexOf('\n')) >= 0) {
    const line = inputBuffer.substring(0, newlineIdx).trim();
    inputBuffer = inputBuffer.substring(newlineIdx + 1);
    if (line) {
      try {
        const msg = JSON.parse(line);
        vscode._handleIncoming(msg);
      } catch (e) {
        process.stderr.write(`[ExtHost] Parse error: ${e.message}\n`);
      }
    }
  }
});

// ============================================================
// Patch child_process to prevent stdio inheritance
// ============================================================
// Extension-spawned subprocesses must NOT inherit our stdio because stdout
// is the JSON protocol channel. Without this patch, child processes write
// to our stdout causing parse errors, and get EPIPE when we don't read their output.

const childProcess = require('child_process');
const _origSpawn = childProcess.spawn;
const _origFork = childProcess.fork;

childProcess.spawn = function patchedSpawn(cmd, args, opts) {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    opts = args;
    args = undefined;
  }
  opts = opts || {};
  if (!opts.stdio) {
    opts.stdio = ['pipe', 'pipe', 'pipe'];
  }
  return args !== undefined
    ? _origSpawn.call(this, cmd, args, opts)
    : _origSpawn.call(this, cmd, opts);
};

childProcess.fork = function patchedFork(modulePath, args, opts) {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    opts = args;
    args = undefined;
  }
  opts = opts || {};
  if (!opts.stdio) {
    opts.stdio = ['pipe', 'pipe', 'pipe', 'ipc'];
  }
  return args !== undefined
    ? _origFork.call(this, modulePath, args, opts)
    : _origFork.call(this, modulePath, opts);
};

// ============================================================
// Load and activate the extension
// ============================================================

async function activate() {
  const pkgPath = path.join(extensionPath, 'extension', 'package.json');
  let pkg;
  try {
    pkg = require(pkgPath);
  } catch (e) {
    process.stderr.write(`[ExtHost] Failed to load package.json: ${e.message}\n`);
    sendToMain({ type: 'host:error', error: `Failed to load package.json: ${e.message}` });
    return;
  }

  const mainEntry = pkg.main || 'extension.js';
  const mainPath = path.resolve(extensionPath, 'extension', mainEntry);

  process.stderr.write(`[ExtHost] Loading extension ${extensionId} from ${mainPath}\n`);

  // Create extension context
  const context = vscode._createExtensionContext(extensionId, path.join(extensionPath, 'extension'));

  let extensionModule;
  try {
    extensionModule = require(mainPath);
  } catch (e) {
    process.stderr.write(`[ExtHost] Failed to require extension: ${e.message}\n`);
    sendToMain({ type: 'host:error', error: `Failed to load extension: ${e.message}` });
    return;
  }

  // Call activate()
  if (typeof extensionModule.activate === 'function') {
    try {
      process.stderr.write(`[ExtHost] Calling activate()...\n`);
      const result = await extensionModule.activate(context);
      process.stderr.write(`[ExtHost] Extension activated successfully\n`);
      sendToMain({ type: 'host:activated', extensionId });
    } catch (e) {
      process.stderr.write(`[ExtHost] activate() failed: ${e.stack || e.message}\n`);
      sendToMain({ type: 'host:error', error: `activate() failed: ${e.message}` });
    }
  } else {
    process.stderr.write(`[ExtHost] No activate() function found\n`);
    sendToMain({ type: 'host:activated', extensionId });
  }
}

// Start
sendToMain({ type: 'host:ready', extensionId });
activate().catch(e => {
  process.stderr.write(`[ExtHost] Fatal: ${e.stack || e.message}\n`);
  sendToMain({ type: 'host:error', error: e.message });
});

// Keep alive
process.on('uncaughtException', (e) => {
  process.stderr.write(`[ExtHost] Uncaught: ${e.stack || e.message}\n`);
});

process.on('unhandledRejection', (e) => {
  process.stderr.write(`[ExtHost] Unhandled rejection: ${e}\n`);
});
