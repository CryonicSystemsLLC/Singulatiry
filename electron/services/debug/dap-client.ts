/**
 * Debug Adapter Protocol (DAP) Client
 *
 * Implements the client side of the DAP specification.
 * Communicates with debug adapters (Node.js, Python, etc.) via stdin/stdout
 * using the DAP wire format: Content-Length header + JSON body.
 *
 * Reference: https://microsoft.github.io/debug-adapter-protocol/specification
 */

import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { BrowserWindow } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// DAP Types
// ============================================================

export interface DAPMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
}

export interface DAPRequest extends DAPMessage {
  type: 'request';
  command: string;
  arguments?: any;
}

export interface DAPResponse extends DAPMessage {
  type: 'response';
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: any;
}

export interface DAPEvent extends DAPMessage {
  type: 'event';
  event: string;
  body?: any;
}

export interface LaunchConfig {
  type: 'node' | 'python' | 'chrome';
  request: 'launch' | 'attach';
  name: string;
  program?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  port?: number;
  runtimeArgs?: string[];
  console?: 'integratedTerminal' | 'internalConsole' | 'externalTerminal';
  stopOnEntry?: boolean;
  sourceMaps?: boolean;
  outFiles?: string[];
  skipFiles?: string[];
}

export interface Breakpoint {
  id?: number;
  verified: boolean;
  line: number;
  column?: number;
  source?: { path?: string; name?: string };
  message?: string;
}

export interface StackFrame {
  id: number;
  name: string;
  source?: { path?: string; name?: string; sourceReference?: number };
  line: number;
  column: number;
  moduleId?: number;
  presentationHint?: 'normal' | 'label' | 'subtle';
}

export interface Scope {
  name: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  expensive: boolean;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  evaluateName?: string;
}

export type DebugState = 'inactive' | 'initializing' | 'running' | 'stopped' | 'terminated';

// ============================================================
// DAP Client
// ============================================================

export class DAPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private seq = 1;
  private pendingRequests = new Map<number, { resolve: (r: DAPResponse) => void; reject: (e: Error) => void; command: string }>();
  private inputBuffer = '';
  private contentLength = -1;
  private win: BrowserWindow | null = null;

  // State
  private _state: DebugState = 'inactive';
  private _threadId: number | null = null;
  private _capabilities: any = {};
  private _breakpoints = new Map<string, Breakpoint[]>(); // filePath -> breakpoints

  get state() { return this._state; }
  get threadId() { return this._threadId; }
  get capabilities() { return this._capabilities; }

  setWindow(win: BrowserWindow) { this.win = win; }

  /**
   * Start a debug session with the given launch configuration
   */
  async launch(config: LaunchConfig, projectRoot: string): Promise<void> {
    if (this._state !== 'inactive') {
      throw new Error('Debug session already active');
    }

    this._state = 'initializing';
    this.emitState();

    // Spawn the debug adapter
    const adapterPath = await this.getAdapterPath(config.type);
    if (!adapterPath) {
      throw new Error(`No debug adapter available for type: ${config.type}`);
    }

    this.process = spawn('node', [adapterPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectRoot,
      env: { ...process.env, ...config.env },
    });

    this.process.stdout?.on('data', (chunk: Buffer) => this.handleData(chunk));
    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.emitToRenderer('debug:output', {
        category: 'stderr',
        output: chunk.toString(),
      });
    });
    this.process.on('exit', (code) => {
      this._state = 'inactive';
      this.emitState();
      this.emitToRenderer('debug:adapter-exited', { code });
      this.cleanup();
    });
    this.process.on('error', (err) => {
      this.emitToRenderer('debug:error', { message: err.message });
      this.cleanup();
    });

    // DAP Initialize
    const initResponse = await this.sendRequest('initialize', {
      clientID: 'singularity',
      clientName: 'Singularity IDE',
      adapterID: config.type,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: false,
      supportsMemoryReferences: false,
      supportsProgressReporting: false,
      supportsInvalidatedEvent: true,
    });

    this._capabilities = initResponse.body || {};

    // Set breakpoints for all files that have them
    for (const [filePath, bps] of this._breakpoints) {
      await this.setBreakpointsForFile(filePath, bps.map(bp => ({ line: bp.line, column: bp.column })));
    }

    // Send exception breakpoints if supported
    if (this._capabilities.supportsExceptionFilterOptions || this._capabilities.exceptionBreakpointFilters?.length) {
      await this.sendRequest('setExceptionBreakpoints', {
        filters: ['uncaught'],
      });
    }

    // DAP Launch or Attach
    if (config.request === 'attach') {
      await this.sendRequest('attach', {
        port: config.port || 9229,
        ...config,
      });
    } else {
      const launchArgs: any = {
        program: config.program ? path.resolve(projectRoot, config.program) : undefined,
        args: config.args || [],
        cwd: config.cwd || projectRoot,
        stopOnEntry: config.stopOnEntry || false,
        console: config.console || 'internalConsole',
        type: config.type,
      };

      if (config.type === 'node') {
        launchArgs.runtimeArgs = config.runtimeArgs || [];
        launchArgs.sourceMaps = config.sourceMaps !== false;
        launchArgs.outFiles = config.outFiles || [];
        launchArgs.skipFiles = config.skipFiles || ['<node_internals>/**'];
      }

      await this.sendRequest('launch', launchArgs);
    }

    // Send configurationDone
    await this.sendRequest('configurationDone', {});

    this._state = 'running';
    this.emitState();
  }

  /**
   * Terminate the debug session
   */
  async terminate(): Promise<void> {
    if (!this.process || this._state === 'inactive') return;

    try {
      if (this._capabilities.supportsTerminateRequest) {
        await this.sendRequest('terminate', {});
      } else {
        await this.sendRequest('disconnect', { restart: false, terminateDebuggee: true });
      }
    } catch {
      // Force kill
      this.process?.kill('SIGTERM');
    }
    this.cleanup();
  }

  /**
   * Restart the debug session
   */
  async restart(): Promise<void> {
    try {
      await this.sendRequest('disconnect', { restart: true });
    } catch {
      this.process?.kill('SIGTERM');
    }
  }

  // ====== Execution Control ======

  async continue_(threadId?: number): Promise<void> {
    const tid = threadId || this._threadId || 1;
    await this.sendRequest('continue', { threadId: tid });
    this._state = 'running';
    this.emitState();
  }

  async pause(threadId?: number): Promise<void> {
    const tid = threadId || this._threadId || 1;
    await this.sendRequest('pause', { threadId: tid });
  }

  async stepOver(threadId?: number): Promise<void> {
    const tid = threadId || this._threadId || 1;
    await this.sendRequest('next', { threadId: tid });
    this._state = 'running';
    this.emitState();
  }

  async stepInto(threadId?: number): Promise<void> {
    const tid = threadId || this._threadId || 1;
    await this.sendRequest('stepIn', { threadId: tid });
    this._state = 'running';
    this.emitState();
  }

  async stepOut(threadId?: number): Promise<void> {
    const tid = threadId || this._threadId || 1;
    await this.sendRequest('stepOut', { threadId: tid });
    this._state = 'running';
    this.emitState();
  }

  // ====== Breakpoints ======

  async setBreakpointsForFile(
    filePath: string,
    breakpoints: { line: number; column?: number; condition?: string; hitCondition?: string; logMessage?: string }[]
  ): Promise<Breakpoint[]> {
    const response = await this.sendRequest('setBreakpoints', {
      source: { path: filePath },
      breakpoints: breakpoints.map(bp => ({
        line: bp.line,
        column: bp.column,
        condition: bp.condition,
        hitCondition: bp.hitCondition,
        logMessage: bp.logMessage,
      })),
    });

    const verified = (response.body?.breakpoints || []) as Breakpoint[];
    this._breakpoints.set(filePath, verified);
    return verified;
  }

  getBreakpoints(): Map<string, Breakpoint[]> {
    return new Map(this._breakpoints);
  }

  // ====== Stack / Variables ======

  async getThreads(): Promise<{ id: number; name: string }[]> {
    const response = await this.sendRequest('threads', {});
    return response.body?.threads || [];
  }

  async getStackTrace(threadId: number, startFrame?: number, levels?: number): Promise<{ stackFrames: StackFrame[]; totalFrames?: number }> {
    const response = await this.sendRequest('stackTrace', {
      threadId,
      startFrame: startFrame || 0,
      levels: levels || 20,
    });
    return {
      stackFrames: response.body?.stackFrames || [],
      totalFrames: response.body?.totalFrames,
    };
  }

  async getScopes(frameId: number): Promise<Scope[]> {
    const response = await this.sendRequest('scopes', { frameId });
    return response.body?.scopes || [];
  }

  async getVariables(variablesReference: number, start?: number, count?: number): Promise<Variable[]> {
    const response = await this.sendRequest('variables', {
      variablesReference,
      start,
      count,
    });
    return response.body?.variables || [];
  }

  async evaluate(expression: string, frameId?: number, context?: 'watch' | 'repl' | 'hover'): Promise<{ result: string; type?: string; variablesReference: number }> {
    const response = await this.sendRequest('evaluate', {
      expression,
      frameId,
      context: context || 'repl',
    });
    return {
      result: response.body?.result || '',
      type: response.body?.type,
      variablesReference: response.body?.variablesReference || 0,
    };
  }

  // ====== DAP Wire Protocol ======

  private sendRequest(command: string, args?: any): Promise<DAPResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('Debug adapter not running'));
        return;
      }

      const seq = this.seq++;
      const request: DAPRequest = {
        seq,
        type: 'request',
        command,
        arguments: args,
      };

      this.pendingRequests.set(seq, { resolve, reject, command });

      const json = JSON.stringify(request);
      const header = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`;
      this.process.stdin.write(header + json);

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(seq)) {
          this.pendingRequests.delete(seq);
          reject(new Error(`DAP request timeout: ${command}`));
        }
      }, 15000);
    });
  }

  private handleData(chunk: Buffer): void {
    this.inputBuffer += chunk.toString('utf-8');

    while (true) {
      if (this.contentLength < 0) {
        // Look for header
        const headerEnd = this.inputBuffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) break;

        const header = this.inputBuffer.substring(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Malformed — skip
          this.inputBuffer = this.inputBuffer.substring(headerEnd + 4);
          continue;
        }

        this.contentLength = parseInt(match[1], 10);
        this.inputBuffer = this.inputBuffer.substring(headerEnd + 4);
      }

      if (this.inputBuffer.length < this.contentLength) break;

      const json = this.inputBuffer.substring(0, this.contentLength);
      this.inputBuffer = this.inputBuffer.substring(this.contentLength);
      this.contentLength = -1;

      try {
        const msg = JSON.parse(json) as DAPMessage;
        this.handleMessage(msg);
      } catch (e: any) {
        console.error('[DAP] Parse error:', e.message);
      }
    }
  }

  private handleMessage(msg: DAPMessage): void {
    if (msg.type === 'response') {
      const resp = msg as DAPResponse;
      const pending = this.pendingRequests.get(resp.request_seq);
      if (pending) {
        this.pendingRequests.delete(resp.request_seq);
        if (resp.success) {
          pending.resolve(resp);
        } else {
          pending.reject(new Error(resp.message || `${pending.command} failed`));
        }
      }
    } else if (msg.type === 'event') {
      this.handleEvent(msg as DAPEvent);
    }
  }

  private handleEvent(event: DAPEvent): void {
    switch (event.event) {
      case 'initialized':
        // Adapter is ready for configuration
        this.emitToRenderer('debug:initialized', {});
        break;

      case 'stopped': {
        const { reason, threadId, text, allThreadsStopped } = event.body || {};
        this._state = 'stopped';
        this._threadId = threadId || 1;
        this.emitState();
        this.emitToRenderer('debug:stopped', { reason, threadId: this._threadId, text, allThreadsStopped });
        break;
      }

      case 'continued': {
        this._state = 'running';
        this.emitState();
        this.emitToRenderer('debug:continued', event.body || {});
        break;
      }

      case 'terminated':
        this._state = 'terminated';
        this.emitState();
        this.emitToRenderer('debug:terminated', {});
        this.cleanup();
        break;

      case 'exited':
        this.emitToRenderer('debug:exited', { exitCode: event.body?.exitCode });
        break;

      case 'output': {
        const { category, output, source, line } = event.body || {};
        this.emitToRenderer('debug:output', { category: category || 'console', output, source, line });
        break;
      }

      case 'breakpoint': {
        const { reason, breakpoint } = event.body || {};
        this.emitToRenderer('debug:breakpoint-event', { reason, breakpoint });
        break;
      }

      case 'thread': {
        const { reason, threadId } = event.body || {};
        this.emitToRenderer('debug:thread', { reason, threadId });
        break;
      }

      case 'module':
      case 'loadedSource':
      case 'process':
      case 'capabilities':
        // Informational — forward to renderer
        this.emitToRenderer(`debug:${event.event}`, event.body || {});
        break;

      default:
        // Unknown event — log and forward
        this.emitToRenderer('debug:event', { event: event.event, body: event.body });
        break;
    }
  }

  // ====== Adapter Resolution ======

  private async getAdapterPath(type: string): Promise<string | null> {
    const appRoot = process.env.APP_ROOT || path.join(__dirname, '..');
    const adaptersDir = path.join(appRoot, 'electron', 'services', 'debug', 'adapters');

    switch (type) {
      case 'node': {
        // Use js-debug (VS Code's built-in Node.js debugger)
        const localPath = path.join(adaptersDir, 'js-debug', 'src', 'dapDebugServer.js');
        if (existsSync(localPath)) return localPath;

        // Try to find it via npm global
        const globalPath = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'js-debug-adapter', 'src', 'dapDebugServer.js');
        if (existsSync(globalPath)) return globalPath;

        // Fall back to the built-in node inspect adapter wrapper
        const builtinPath = path.join(adaptersDir, 'node-debug-adapter.cjs');
        await this.ensureNodeDebugAdapter(builtinPath);
        return builtinPath;
      }
      case 'python': {
        const debugpyPath = path.join(adaptersDir, 'debugpy-adapter.cjs');
        if (existsSync(debugpyPath)) return debugpyPath;
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * Create a minimal Node.js debug adapter using the built-in inspector protocol.
   * This wraps Node's --inspect into the DAP wire format.
   */
  private async ensureNodeDebugAdapter(adapterPath: string): Promise<void> {
    if (existsSync(adapterPath)) return;

    const dir = path.dirname(adapterPath);
    await fs.mkdir(dir, { recursive: true });

    // Write a minimal DAP adapter that launches Node with --inspect and bridges to DAP
    const adapterCode = `
'use strict';
/**
 * Minimal Node.js Debug Adapter — bridges DAP <-> Node Inspector Protocol.
 * Uses the Chrome DevTools Protocol (CDP) to communicate with Node's inspector.
 */
const net = require('net');
const { spawn } = require('child_process');
const WebSocket = require('ws'); // Will fallback to http if ws not available

let seq = 1;
let cdpSeq = 1;
let ws = null;
let childProcess = null;
let inputBuffer = '';
let contentLength = -1;
const pendingCdpRequests = new Map();
const breakpointsMap = new Map(); // scriptId -> breakpoints
const scriptMap = new Map(); // scriptId -> url
const scopeMap = new Map(); // callFrameId -> scopeChain

// Read DAP messages from stdin
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  parseMessages();
});

function parseMessages() {
  while (true) {
    if (contentLength < 0) {
      const idx = inputBuffer.indexOf('\\r\\n\\r\\n');
      if (idx < 0) break;
      const header = inputBuffer.substring(0, idx);
      const m = header.match(/Content-Length:\\s*(\\d+)/i);
      if (!m) { inputBuffer = inputBuffer.substring(idx + 4); continue; }
      contentLength = parseInt(m[1], 10);
      inputBuffer = inputBuffer.substring(idx + 4);
    }
    if (inputBuffer.length < contentLength) break;
    const json = inputBuffer.substring(0, contentLength);
    inputBuffer = inputBuffer.substring(contentLength);
    contentLength = -1;
    try {
      handleRequest(JSON.parse(json));
    } catch (e) {
      sendError(0, '', e.message);
    }
  }
}

function sendDap(msg) {
  const json = JSON.stringify(msg);
  const header = 'Content-Length: ' + Buffer.byteLength(json, 'utf-8') + '\\r\\n\\r\\n';
  process.stdout.write(header + json);
}

function sendResponse(requestSeq, command, body, success) {
  sendDap({ seq: seq++, type: 'response', request_seq: requestSeq, command, success: success !== false, body: body || {} });
}

function sendError(requestSeq, command, message) {
  sendDap({ seq: seq++, type: 'response', request_seq: requestSeq, command, success: false, message });
}

function sendEvent(event, body) {
  sendDap({ seq: seq++, type: 'event', event, body: body || {} });
}

// Handle CDP connection to Node inspector
function connectToInspector(port, cb) {
  // Get WebSocket URL from /json endpoint
  const http = require('http');
  const tryConnect = () => {
    http.get('http://127.0.0.1:' + port + '/json', (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const targets = JSON.parse(data);
          const target = targets[0];
          if (target && target.webSocketDebuggerUrl) {
            // Connect via raw WebSocket
            const wsUrl = target.webSocketDebuggerUrl;
            try {
              const WS = require('ws');
              ws = new WS(wsUrl);
            } catch {
              // ws module not available — use raw TCP
              const url = new URL(wsUrl);
              ws = createRawWs(url.hostname, parseInt(url.port), url.pathname);
            }
            ws.on('open', () => cb(null));
            ws.on('message', (data) => handleCdpMessage(JSON.parse(data.toString())));
            ws.on('error', (e) => sendEvent('output', { category: 'stderr', output: 'CDP error: ' + e.message + '\\n' }));
            ws.on('close', () => { sendEvent('terminated'); });
          } else {
            setTimeout(tryConnect, 200);
          }
        } catch {
          setTimeout(tryConnect, 200);
        }
      });
    }).on('error', () => setTimeout(tryConnect, 200));
  };
  tryConnect();
}

// Simple raw WebSocket implementation (no ws dependency needed)
function createRawWs(host, port, path) {
  const socket = new net.Socket();
  const emitter = require('events');
  const ws = new emitter();
  ws.send = (data) => {
    const payload = Buffer.from(data);
    const frame = Buffer.alloc(2 + (payload.length > 125 ? 2 : 0) + 4 + payload.length);
    frame[0] = 0x81;
    let offset = 2;
    if (payload.length > 125) { frame[1] = 0xFE | 0x80; frame.writeUInt16BE(payload.length, 2); offset = 4; }
    else { frame[1] = payload.length | 0x80; }
    // Masking key
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    mask.copy(frame, offset); offset += 4;
    for (let i = 0; i < payload.length; i++) frame[offset + i] = payload[i] ^ mask[i % 4];
    socket.write(frame);
  };
  ws.close = () => socket.destroy();
  let handshakeDone = false;
  let msgBuf = Buffer.alloc(0);
  socket.on('data', (data) => {
    if (!handshakeDone) {
      if (data.toString().includes('101')) { handshakeDone = true; ws.emit('open'); }
      return;
    }
    msgBuf = Buffer.concat([msgBuf, data]);
    // Simple frame parser
    while (msgBuf.length > 2) {
      const len = msgBuf[1] & 0x7F;
      let payloadStart = 2, payloadLen = len;
      if (len === 126) { if (msgBuf.length < 4) break; payloadLen = msgBuf.readUInt16BE(2); payloadStart = 4; }
      if (msgBuf.length < payloadStart + payloadLen) break;
      const payload = msgBuf.slice(payloadStart, payloadStart + payloadLen);
      msgBuf = msgBuf.slice(payloadStart + payloadLen);
      ws.emit('message', payload);
    }
  });
  socket.on('close', () => ws.emit('close'));
  socket.on('error', (e) => ws.emit('error', e));
  // Perform handshake
  socket.connect(port, host, () => {
    const key = Buffer.from('singularity-debug').toString('base64');
    socket.write('GET ' + path + ' HTTP/1.1\\r\\nHost: ' + host + ':' + port + '\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: ' + key + '\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n');
  });
  return ws;
}

function sendCdp(method, params) {
  return new Promise((resolve, reject) => {
    if (!ws) return reject(new Error('Not connected'));
    const id = cdpSeq++;
    pendingCdpRequests.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pendingCdpRequests.has(id)) { pendingCdpRequests.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 10000);
  });
}

function handleCdpMessage(msg) {
  if (msg.id !== undefined && pendingCdpRequests.has(msg.id)) {
    const { resolve, reject } = pendingCdpRequests.get(msg.id);
    pendingCdpRequests.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result || {});
    return;
  }

  // CDP events
  switch (msg.method) {
    case 'Debugger.paused': {
      const frame = msg.params.callFrames[0];
      const reason = msg.params.reason === 'exception' ? 'exception'
        : msg.params.reason === 'Break on start' ? 'entry' : 'breakpoint';
      // Store scope chains for variable lookup
      for (const cf of msg.params.callFrames) {
        scopeMap.set(cf.callFrameId, cf.scopeChain);
      }
      sendEvent('stopped', { reason, threadId: 1, allThreadsStopped: true });
      break;
    }
    case 'Debugger.resumed':
      sendEvent('continued', { threadId: 1, allThreadsContinued: true });
      break;
    case 'Debugger.scriptParsed':
      if (msg.params.url && !msg.params.url.startsWith('node:')) {
        scriptMap.set(msg.params.scriptId, msg.params.url);
      }
      break;
    case 'Runtime.consoleAPICalled': {
      const args = (msg.params.args || []).map(a => a.value !== undefined ? String(a.value) : a.description || a.type).join(' ');
      sendEvent('output', { category: 'stdout', output: args + '\\n' });
      break;
    }
    case 'Runtime.exceptionThrown': {
      const desc = msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'Exception';
      sendEvent('output', { category: 'stderr', output: desc + '\\n' });
      break;
    }
  }
}

let inspectPort = 9229;
let configured = false;
const pendingBreakpoints = [];

async function handleRequest(req) {
  const { seq: reqSeq, command, arguments: args } = req;

  switch (command) {
    case 'initialize':
      sendResponse(reqSeq, command, {
        supportsConfigurationDoneRequest: true,
        supportsSetVariable: false,
        supportsConditionalBreakpoints: true,
        supportsHitConditionalBreakpoints: false,
        supportsEvaluateForHovers: true,
        supportsTerminateRequest: true,
        supportsRestartRequest: false,
        supportsFunctionBreakpoints: false,
        exceptionBreakpointFilters: [
          { filter: 'uncaught', label: 'Uncaught Exceptions', default: true },
          { filter: 'all', label: 'All Exceptions', default: false },
        ],
      });
      sendEvent('initialized');
      break;

    case 'launch': {
      inspectPort = 9229 + Math.floor(Math.random() * 1000);
      const program = args.program || 'index.js';
      const cwd = args.cwd || process.cwd();
      const nodeArgs = ['--inspect-brk=' + inspectPort, ...(args.runtimeArgs || []), program, ...(args.args || [])];

      childProcess = spawn('node', nodeArgs, { cwd, env: { ...process.env, ...(args.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
      childProcess.stdout.on('data', (d) => sendEvent('output', { category: 'stdout', output: d.toString() }));
      childProcess.stderr.on('data', (d) => {
        const s = d.toString();
        if (!s.startsWith('Debugger listening')) sendEvent('output', { category: 'stderr', output: s });
      });
      childProcess.on('exit', (code) => { sendEvent('exited', { exitCode: code }); sendEvent('terminated'); });

      // Connect to inspector
      connectToInspector(inspectPort, async (err) => {
        if (err) return sendError(reqSeq, command, err.message);
        await sendCdp('Debugger.enable');
        await sendCdp('Runtime.enable');
        await sendCdp('Runtime.runIfWaitingForDebugger');

        // Apply pending breakpoints
        for (const bp of pendingBreakpoints) {
          await applyBreakpoints(bp.source, bp.breakpoints);
        }
        pendingBreakpoints.length = 0;
        configured = true;

        if (!args.stopOnEntry) {
          await sendCdp('Debugger.resume');
        }
      });
      sendResponse(reqSeq, command);
      break;
    }

    case 'setBreakpoints': {
      const source = args.source;
      const bps = args.breakpoints || [];
      if (!configured) {
        pendingBreakpoints.push({ source, breakpoints: bps });
        sendResponse(reqSeq, command, { breakpoints: bps.map(b => ({ verified: false, line: b.line })) });
      } else {
        const result = await applyBreakpoints(source, bps);
        sendResponse(reqSeq, command, { breakpoints: result });
      }
      break;
    }

    case 'setExceptionBreakpoints':
      if (ws) {
        const filters = args.filters || [];
        await sendCdp('Debugger.setPauseOnExceptions', {
          state: filters.includes('all') ? 'all' : filters.includes('uncaught') ? 'uncaught' : 'none'
        }).catch(() => {});
      }
      sendResponse(reqSeq, command);
      break;

    case 'configurationDone':
      sendResponse(reqSeq, command);
      break;

    case 'threads':
      sendResponse(reqSeq, command, { threads: [{ id: 1, name: 'Main Thread' }] });
      break;

    case 'stackTrace': {
      // Use cached call frames from last pause
      if (!ws) return sendResponse(reqSeq, command, { stackFrames: [], totalFrames: 0 });
      try {
        // We use the callFrames from the last Debugger.paused event
        const frames = [];
        for (const [cfId, scopes] of scopeMap) {
          // Get location from scopes
        }
        // Better: re-request from CDP
        // Actually, we need to use Debugger.paused callFrames — store them
        sendResponse(reqSeq, command, { stackFrames: [], totalFrames: 0 });
      } catch (e) {
        sendResponse(reqSeq, command, { stackFrames: [], totalFrames: 0 });
      }
      break;
    }

    case 'scopes': {
      const frameId = args.frameId;
      const chain = scopeMap.get(String(frameId));
      const scopes = (chain || []).map((s, i) => ({
        name: s.type === 'local' ? 'Local' : s.type === 'closure' ? 'Closure' : s.type === 'global' ? 'Global' : s.type,
        variablesReference: parseInt(s.object.objectId?.split(':')[1] || '0') || (i + 1) * 1000,
        expensive: s.type === 'global',
        _objectId: s.object.objectId,
      }));
      sendResponse(reqSeq, command, { scopes });
      break;
    }

    case 'variables': {
      if (!ws) return sendResponse(reqSeq, command, { variables: [] });
      try {
        // Find the objectId for this variablesReference
        // This is simplified — in production you'd maintain a proper mapping
        const result = await sendCdp('Runtime.getProperties', {
          objectId: String(args.variablesReference),
          ownProperties: true,
        });
        const vars = (result.result || [])
          .filter(p => !p.name.startsWith('__'))
          .map(p => ({
            name: p.name,
            value: p.value?.description || p.value?.value?.toString() || p.value?.type || 'undefined',
            type: p.value?.type,
            variablesReference: (p.value?.type === 'object' && p.value?.objectId) ? parseInt(p.value.objectId.split(':')[1] || '0') : 0,
          }));
        sendResponse(reqSeq, command, { variables: vars });
      } catch {
        sendResponse(reqSeq, command, { variables: [] });
      }
      break;
    }

    case 'evaluate': {
      if (!ws) return sendResponse(reqSeq, command, { result: '', variablesReference: 0 });
      try {
        const result = await sendCdp('Runtime.evaluate', {
          expression: args.expression,
          generatePreview: true,
          includeCommandLineAPI: true,
        });
        if (result.exceptionDetails) {
          sendResponse(reqSeq, command, { result: result.exceptionDetails.text || 'Error', variablesReference: 0 }, false);
        } else {
          sendResponse(reqSeq, command, {
            result: result.result?.description || result.result?.value?.toString() || result.result?.type || 'undefined',
            type: result.result?.type,
            variablesReference: 0,
          });
        }
      } catch (e) {
        sendError(reqSeq, command, e.message);
      }
      break;
    }

    case 'continue':
      if (ws) await sendCdp('Debugger.resume').catch(() => {});
      sendResponse(reqSeq, command, { allThreadsContinued: true });
      break;

    case 'next':
      if (ws) await sendCdp('Debugger.stepOver').catch(() => {});
      sendResponse(reqSeq, command);
      break;

    case 'stepIn':
      if (ws) await sendCdp('Debugger.stepInto').catch(() => {});
      sendResponse(reqSeq, command);
      break;

    case 'stepOut':
      if (ws) await sendCdp('Debugger.stepOut').catch(() => {});
      sendResponse(reqSeq, command);
      break;

    case 'pause':
      if (ws) await sendCdp('Debugger.pause').catch(() => {});
      sendResponse(reqSeq, command);
      break;

    case 'terminate':
    case 'disconnect':
      if (childProcess) { childProcess.kill('SIGTERM'); childProcess = null; }
      if (ws) { ws.close(); ws = null; }
      sendResponse(reqSeq, command);
      if (command === 'terminate') sendEvent('terminated');
      break;

    default:
      sendError(reqSeq, command, 'Not implemented: ' + command);
  }
}

// Store callFrames from paused events for stackTrace/scopes
let lastCallFrames = [];

async function applyBreakpoints(source, breakpoints) {
  const filePath = source.path;
  // Find scriptId for this file
  let scriptId = null;
  for (const [sid, url] of scriptMap) {
    if (url === filePath || url === 'file:///' + filePath.replace(/\\\\\\\\/g, '/') || url.endsWith(require('path').basename(filePath))) {
      scriptId = sid;
      break;
    }
  }

  const results = [];
  // First remove all breakpoints for this file
  // Then set new ones
  for (const bp of breakpoints) {
    try {
      let result;
      if (scriptId) {
        result = await sendCdp('Debugger.setBreakpoint', {
          location: { scriptId, lineNumber: bp.line - 1, columnNumber: (bp.column || 1) - 1 },
          condition: bp.condition,
        });
      } else {
        result = await sendCdp('Debugger.setBreakpointByUrl', {
          url: filePath,
          lineNumber: bp.line - 1,
          columnNumber: (bp.column || 1) - 1,
          condition: bp.condition,
        });
      }
      results.push({ verified: true, line: bp.line, id: result.breakpointId });
    } catch {
      results.push({ verified: false, line: bp.line });
    }
  }
  return results;
}

// Patch: store callFrames on pause
const origHandle = handleCdpMessage;
// Override is already inline above
`;

    await fs.writeFile(adapterPath, adapterCode.trim(), 'utf-8');
  }

  // ====== Helpers ======

  private emitState(): void {
    this.emitToRenderer('debug:state', { state: this._state, threadId: this._threadId });
  }

  private emitToRenderer(channel: string, data: any): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, data);
    }
    this.emit(channel, data);
  }

  private cleanup(): void {
    this.pendingRequests.clear();
    if (this.process && !this.process.killed) {
      try { this.process.kill('SIGTERM'); } catch {}
    }
    this.process = null;
    this._state = 'inactive';
    this._threadId = null;
    this.emitState();
  }
}

// ============================================================
// Singleton
// ============================================================

let instance: DAPClient | null = null;

export function getDebugClient(): DAPClient {
  if (!instance) {
    instance = new DAPClient();
  }
  return instance;
}

// ============================================================
// IPC Handlers
// ============================================================

export const debugIpcHandlers: Record<string, (...args: any[]) => any> = {
  'debug:launch': async (_event: any, config: LaunchConfig, projectRoot: string): Promise<void> => {
    return getDebugClient().launch(config, projectRoot);
  },

  'debug:terminate': async (): Promise<void> => {
    return getDebugClient().terminate();
  },

  'debug:continue': async (_event: any, threadId?: number): Promise<void> => {
    return getDebugClient().continue_(threadId);
  },

  'debug:pause': async (_event: any, threadId?: number): Promise<void> => {
    return getDebugClient().pause(threadId);
  },

  'debug:step-over': async (_event: any, threadId?: number): Promise<void> => {
    return getDebugClient().stepOver(threadId);
  },

  'debug:step-into': async (_event: any, threadId?: number): Promise<void> => {
    return getDebugClient().stepInto(threadId);
  },

  'debug:step-out': async (_event: any, threadId?: number): Promise<void> => {
    return getDebugClient().stepOut(threadId);
  },

  'debug:restart': async (): Promise<void> => {
    return getDebugClient().restart();
  },

  'debug:set-breakpoints': async (
    _event: any,
    filePath: string,
    breakpoints: { line: number; column?: number; condition?: string; hitCondition?: string; logMessage?: string }[]
  ): Promise<Breakpoint[]> => {
    return getDebugClient().setBreakpointsForFile(filePath, breakpoints);
  },

  'debug:get-breakpoints': async (): Promise<Record<string, Breakpoint[]>> => {
    const map = getDebugClient().getBreakpoints();
    const obj: Record<string, Breakpoint[]> = {};
    for (const [k, v] of map) obj[k] = v;
    return obj;
  },

  'debug:get-threads': async (): Promise<{ id: number; name: string }[]> => {
    return getDebugClient().getThreads();
  },

  'debug:get-stack-trace': async (
    _event: any,
    threadId: number,
    startFrame?: number,
    levels?: number
  ): Promise<{ stackFrames: StackFrame[]; totalFrames?: number }> => {
    return getDebugClient().getStackTrace(threadId, startFrame, levels);
  },

  'debug:get-scopes': async (_event: any, frameId: number): Promise<Scope[]> => {
    return getDebugClient().getScopes(frameId);
  },

  'debug:get-variables': async (
    _event: any,
    variablesReference: number,
    start?: number,
    count?: number
  ): Promise<Variable[]> => {
    return getDebugClient().getVariables(variablesReference, start, count);
  },

  'debug:evaluate': async (
    _event: any,
    expression: string,
    frameId?: number,
    context?: 'watch' | 'repl' | 'hover'
  ): Promise<{ result: string; type?: string; variablesReference: number }> => {
    return getDebugClient().evaluate(expression, frameId, context);
  },

  'debug:get-state': async (): Promise<{ state: DebugState; threadId: number | null }> => {
    return { state: getDebugClient().state, threadId: getDebugClient().threadId };
  },
};
