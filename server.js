import express from 'express';
import { spawn, execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { readdirSync } from 'fs';
import TOML from '@iarna/toml';
import {
  parse as jsoncParse,
  modify as jsoncModify,
  applyEdits as jsoncApplyEdits,
} from 'jsonc-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Simple .env loader (no external dependency) ──────────────────────────────
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// Load .env from launcher directory (respects LAUNCHER_DIR if set in system env)
const launcherDir = process.env.LAUNCHER_DIR || __dirname;
const envFile = path.join(launcherDir, '.env');
const userEnv = loadEnvFile(envFile);

// If .env also sets LAUNCHER_DIR, use it (allows .env to override the default)
const effectiveLauncherDir = userEnv.LAUNCHER_DIR || launcherDir;

// Apply .env values to process.env (only if not already set)
for (const [key, value] of Object.entries(userEnv)) {
  if (!(key in process.env)) {
    process.env[key] = value;
  }
}

const app = express();
const port = 5000;
const FLAG_STORE_FILE = path.join(effectiveLauncherDir, 'modelFlags.json');
const PROJECT_DIRS_FILE = path.join(effectiveLauncherDir, 'projectDirs.json');
const CONFIG_FILE = path.join(effectiveLauncherDir, 'launcherConfig.json');
const EXTRA_MODEL_DIRS_FILE = path.join(effectiveLauncherDir, 'extraModelDirs.json');

// Extra folders added at runtime via the "Browse for Models Folder" button (persisted)
function loadExtraModelDirs() {
  try {
    if (fs.existsSync(EXTRA_MODEL_DIRS_FILE)) {
      const data = JSON.parse(fs.readFileSync(EXTRA_MODEL_DIRS_FILE, 'utf8'));
      console.log(`📁 Loaded ${data.length} extra model dir(s)`);
      return data;
    }
  } catch (e) {
    console.error('Failed to load extraModelDirs.json:', e.message);
  }
  return [];
}

function saveExtraModelDirs(dirs) {
  try {
    fs.writeFileSync(EXTRA_MODEL_DIRS_FILE, JSON.stringify(dirs, null, 2), 'utf8');
    console.log(`💾 Saved ${dirs.length} extra model dir(s)`);
  } catch (e) {
    console.error('Failed to save extraModelDirs.json:', e.message);
  }
}

const extraModelDirs = loadExtraModelDirs();

// Persisted project directory overrides (saved to projectDirs.json)
// Each entry: { "pithagoras": "/home/user/pithagoras", ... }
function loadProjectDirs() {
  try {
    if (fs.existsSync(PROJECT_DIRS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROJECT_DIRS_FILE, 'utf8'));
      console.log(`📂 Loaded ${Object.keys(data).length} project dir(s)`);
      return data;
    }
  } catch (e) {
    console.error('Failed to load projectDirs.json:', e.message);
  }
  return {};
}

function saveProjectDirs(dirs) {
  try {
    fs.writeFileSync(PROJECT_DIRS_FILE, JSON.stringify(dirs, null, 2), 'utf8');
    console.log(`💾 Saved ${Object.keys(dirs).length} project dir(s)`);
  } catch (e) {
    console.error('Failed to save projectDirs.json:', e.message);
  }
}

const projectDirs = loadProjectDirs();

// Home directory for default browse path
const homeDir = os.homedir();

// CPU core count — detected once at startup (cheap, but no reason to re-run it per request).
// This is logical/SMT core count, same number llama.cpp itself falls back to when --threads
// is omitted. It's shown to the user as a hint only; it never overrides an explicit value.
const detectedCpuCores = os.cpus().length;

// Per-model flag persistence
function loadModelFlags() {
  try {
    if (fs.existsSync(FLAG_STORE_FILE)) {
      const data = JSON.parse(fs.readFileSync(FLAG_STORE_FILE, 'utf8'));
      console.log(`📦 Loaded ${Object.keys(data).length} model flag set(s)`);
      return data;
    }
  } catch (e) {
    console.error('Failed to load modelFlags.json:', e.message);
  }
  return {};
}

function saveModelFlags(flags) {
  try {
    fs.writeFileSync(FLAG_STORE_FILE, JSON.stringify(flags, null, 2), 'utf8');
    console.log(`💾 Saved ${Object.keys(flags).length} model flag set(s)`);
  } catch (e) {
    console.error('Failed to save modelFlags.json:', e.message);
  }
}

const modelFlags = loadModelFlags();

// Keys that are tracked per-model (everything except provider/api/endpoint config)
const FLAG_KEYS = [
  'ngl', 'nCpuMoe', 'fa', 'jinja', 'cnv',
  'contextAmount', 'ctk', 'ctv',
  'reasoningFormat', 'reasoningBudget', 'reasoningEffort', 'reasoningPreserve',
  'host', 'port', 'noMmap', 'mlock', 'noRepack', 'rpcEnabled', 'rpcAddress', 'tensorSplit',
  'rpcWorkerMode', 'rpcWorkerHost', 'rpcWorkerPort',
  'mmproj', 'mmprojEnabled', 'imageMinTokens', 'mtpModel', 'mtpEnabled', 'draftModel', 'draftEnabled',
  'specDraftNMax', 'chatTemplateFile', 'customFlags'
];

// Persisted general config (saved to launcherConfig.json)
const CONFIG_PERSIST_KEYS = [
  'modelProvider', 'modelName', 'apiKey', 'localModelEndpoint',
  'selectedModel', 'customFlags', 'modelsDir',
  'ngl', 'nCpuMoe', 'fa', 'jinja', 'cnv',
  'contextAmount', 'ctk', 'ctv',
  'reasoningFormat', 'reasoningBudget', 'reasoningEffort', 'reasoningPreserve', 'nPredict',
  'temp', 'topP', 'topK', 'repeatPenalty', 'repeatLastN', 'minP', 'presencePenalty',
  'threads', 'threadsBatch', 'batchSize', 'noMmap', 'mlock', 'noRepack',
  'host', 'port', 'rpcEnabled', 'rpcAddress', 'tensorSplit',
  'rpcWorkerMode', 'rpcWorkerHost', 'rpcWorkerPort',
  'mmproj', 'mmprojEnabled', 'imageMinTokens', 'mtpModel', 'mtpEnabled', 'draftModel', 'draftEnabled',
  'specDraftNMax', 'chatTemplateFile'
];

function loadLauncherConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      console.log(`⚙️ Loaded launcher config`);
      return data;
    }
  } catch (e) {
    console.error('Failed to load launcherConfig.json:', e.message);
  }
  return {};
}

function saveLauncherConfig(cfg) {
  try {
    const filtered = {};
    for (const key of CONFIG_PERSIST_KEYS) {
      if (cfg[key] !== undefined) filtered[key] = cfg[key];
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(filtered, null, 2), 'utf8');
    console.log(`💾 Saved launcher config`);
  } catch (e) {
    console.error('Failed to save launcherConfig.json:', e.message);
  }
}

// Keys allowed through POST /api/config
const ALLOWED_CONFIG_KEYS = [
  'modelProvider', 'modelName', 'apiKey', 'localModelEndpoint',
  'selectedModel', 'customFlags', 'modelsDir',
  'ngl', 'nCpuMoe', 'fa', 'jinja', 'cnv',
  'contextAmount', 'ctk', 'ctv',
  'reasoningFormat', 'reasoningBudget', 'reasoningEffort', 'reasoningPreserve', 'nPredict',
  'temp', 'topP', 'topK', 'repeatPenalty', 'repeatLastN', 'minP', 'presencePenalty',
  'threads', 'threadsBatch', 'batchSize', 'noMmap', 'mlock', 'noRepack',
  'host', 'port', 'rpcEnabled', 'rpcAddress', 'tensorSplit',
  'rpcWorkerMode', 'rpcWorkerHost', 'rpcWorkerPort',
  'mmproj', 'mmprojEnabled', 'imageMinTokens', 'mtpModel', 'mtpEnabled', 'draftModel', 'draftEnabled',
  'specDraftNMax', 'chatTemplateFile'
];

function captureFlagsFromForm() {
  return FLAG_KEYS.reduce((obj, key) => {
    const el = document.getElementById(key === 'nCpuMoe' ? 'n-cpu-moe' : key);
    if (el) obj[key] = el.value;
    return obj;
  }, {});
}

function applyFlagsToForm(flags) {
  FLAG_KEYS.forEach(key => {
    const el = document.getElementById(key === 'nCpuMoe' ? 'n-cpu-moe' : key);
    if (el && flags[key] !== undefined) el.value = flags[key];
  });
  buildPreview();
}

function scanDir(currentPath, parentName, models) {
  try {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    const ggufFiles = entries.filter(e => e.isFile() && e.name.endsWith('.gguf'));

    if (ggufFiles.length > 0) {
      // This directory has GGUF files - find primary file for multi-part models
      const sortedFiles = ggufFiles.map(f => f.name).sort();
      const primaryFile = sortedFiles.find(f => f.includes('-00001-of-')) || sortedFiles[0];

      if (primaryFile) {
        const displayName = parentName || currentPath.split('/').pop();
        models.push({
          name: displayName,
          path: currentPath,
          files: [{
            name: primaryFile,
            fullPath: path.join(currentPath, primaryFile)
          }]
        });
      }
    } else {
      // Recurse into subdirectories
      const subdirs = entries.filter(e => e.isDirectory());
      subdirs.forEach(subdir => {
        const subPath = path.join(currentPath, subdir.name);
        const newParent = parentName ? `${parentName}/${subdir.name}` : subdir.name;
        scanDir(subPath, newParent, models);
      });
    }
  } catch (e) {
    // Skip on error
  }
}

function getAvailableModels() {
  const models = [];

  // Scan primary models directory if set
  if (modelsDir) {
    try {
      if (!fs.existsSync(modelsDir)) {
        console.warn(`⚠️  Models directory does not exist: ${modelsDir}`);
      } else {
        const topDirs = readdirSync(modelsDir, { withFileTypes: true })
          .filter(d => d.isDirectory());

        topDirs.forEach(d => {
          scanDir(path.join(modelsDir, d.name), d.name, models);
        });
      }
    } catch (e) {
      console.warn(`⚠️  Error scanning models directory: ${e.message}`);
    }
  }

  extraModelDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      scanDir(dir, path.basename(dir), models);
    }
  });

  // Drop duplicates (same model file found via more than one folder)
  const seen = new Set();
  return models.filter(m => {
    const key = m.files[0].fullPath;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Models directory - configurable via UI, persisted across restarts
let modelsDir = '';

// Default config object (initialized first, then loaded from disk)
const config = {
  modelProvider: 'local',
  modelName: 'fable5',
  apiKey: '',
  localModelEndpoint: 'http://localhost:8080/v1',
  selectedModel: null,
  mmproj: '',
  mmprojEnabled: '0',
  imageMinTokens: '',
  mtpModel: '',
  mtpEnabled: '0',
  draftModel: '',
  draftEnabled: '0',
  specDraftNMax: '',
  chatTemplateFile: '',
  customFlags: '',
  contextAmount: '',
  ngl: '99',
  nCpuMoe: '40',
  fa: '1',
  jinja: '1',
  cnv: '1',
  ctk: 'q8_0',
  ctv: 'q8_0',
  reasoningFormat: 'deepseek',
  reasoningBudget: '0',
  reasoningEffort: '',
  reasoningPreserve: '0',
  noMmap: '0',
  mlock: '0',
  noRepack: '0',
  rpcEnabled: '0',
  // "10.0.x.x" is a fill-in-the-blank template, not a real address — most home
  // LANs are 10.0.0.0/24 or similar, so only the last two octets usually need
  // editing. Run `ipconfig` (Windows) on the worker machine to find its real
  // IPv4 address (look for "IPv4 Address" under the active adapter).
  rpcAddress: '10.0.x.x:50052',
  // "1,1" splits evenly between two devices (e.g. local GPU + one RPC worker) —
  // a reasonable starting point; edit the ratio once you know each device's
  // free memory (see --list-devices output for exact figures).
  tensorSplit: '1,1',
  rpcWorkerMode: '0',
  rpcWorkerHost: '0.0.0.0',
  rpcWorkerPort: '50052',
  nPredict: '',
  temp: '0.8',
  topP: '0.95',
  topK: '40',
  repeatPenalty: '1.1',
  repeatLastN: '64',
  minP: '0.05',
  presencePenalty: '0',
  threads: '0',
  threadsBatch: '0',
  batchSize: '512',
  host: '',
  port: ''
};

// Load persisted general config and apply to in-memory config
const persistedConfig = loadLauncherConfig();
if (persistedConfig.modelsDir) {
  modelsDir = persistedConfig.modelsDir;
}
// Restore all persisted config values from disk
for (const key of CONFIG_PERSIST_KEYS) {
  if (persistedConfig[key] !== undefined) {
    config[key] = persistedConfig[key];
  }
}

// ── Detect the best terminal emulator for opening Pi ─────────────────────────
// Tries: env var LAUNCHER_PI_TERMINAL → ptyxis → gnome-terminal → xdg-open
function commandExists(cmd) {
  // Check each directory in PATH for the command
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    const fullPath = path.join(dir, cmd);
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return true;
    } catch { /* not found in this dir */ }
  }
  return false;
}

function detectPiTerminal() {
  if (process.env.LAUNCHER_PI_TERMINAL) {
    return process.env.LAUNCHER_PI_TERMINAL;
  }
  // Prefer ptyxis (Pi's own terminal) if available, otherwise gnome-terminal,
  // otherwise fall back to xdg-open (generic Linux).
  const candidates = ['ptyxis', 'gnome-terminal'];
  for (const term of candidates) {
    if (commandExists(term)) return term;
  }
  return 'xdg-open';
}

// Build the {cmd, args} to spawn a new terminal window running the given CLI
// command (e.g. 'pi'). bash/xdg-open/ptyxis are Linux-only — on Windows there's
// no bash by default, so open a cmd.exe window instead.
function buildTerminalLaunch(agentCmd) {
  if (process.platform === 'win32') {
    return { cmd: 'cmd.exe', args: ['/c', 'start', 'Coding Agent', 'cmd.exe', '/k', agentCmd] };
  }
  const terminal = detectPiTerminal();
  return { cmd: terminal, args: ['--new-window', '--', 'bash', '-lic', `${agentCmd}; exec bash`] };
}

// llama-server's own stdout/stderr get redirected here (instead of inherited into the
// launcher's process) so a separate terminal window can tail them live regardless of
// how the launcher itself was started (desktop icon, headless, etc).
const LLAMACPP_LOG_FILE = path.join(__dirname, 'llamacpp-server.log');

// Log lines to hide from the live-tail terminal — per-request bookkeeping and one-time
// banners that add noise but no signal. `print_timing` (prompt/eval tokens-per-second)
// and any warning/error lines are deliberately NOT filtered out.
const LLAMACPP_LOG_NOISE = /get_availabl|launch_slot_|slot\s+release|CORS is set|security risk|llama\.cpp\/pull|chat template supports|has unused tensor|DEPRECATED:|^\S+\s+W\s+srv\s+llama_server:\s*-+\s*$/;

// Coding agent CLIs launchable from the terminal card. `cmd` is just the shell command
// name — whichever ones aren't installed simply won't run when picked; nothing here
// assumes a specific machine has them all.
const CODING_AGENT_CLIS = [
  { id: 'pi', name: 'Pi CLI', cmd: 'pi', url: 'https://pi.dev' },
  { id: 'claude', name: 'Claude Code CLI', cmd: 'claude', url: 'https://claude.com/claude-code' },
  { id: 'codex', name: 'Codex CLI', cmd: 'codex', url: 'https://github.com/openai/codex' },
  { id: 'gemini', name: 'Gemini CLI', cmd: 'gemini', url: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'aider', name: 'Aider CLI', cmd: 'aider', url: 'https://aider.chat' },
  { id: 'cursor-agent', name: 'Cursor CLI', cmd: 'cursor-agent', url: 'https://cursor.com/cli' },
  { id: 'opencode', name: 'Opencode CLI', cmd: 'opencode', url: 'https://opencode.ai' },
  { id: 'cline', name: 'Cline CLI', cmd: 'cline', url: 'https://cline.bot' },
  { id: 'gh', name: 'GitHub CLI', cmd: 'gh', url: 'https://cli.github.com' }
];

// ── MCP servers this stack exposes, and how to register/unregister them in ──
// each coding-agent CLI's own config file.
//
// Only CLIs whose remote-MCP config format was verified (Aug 2026 docs) are
// listed in MCP_CLIENT_WRITERS below — writing a guessed format risks
// corrupting a tool's config, so unsupported clients (aider, cline, gh) just
// report "not supported" in the API rather than attempting anything.
// `kind: 'remote'` servers are standing services reachable by URL (need to actually
// be running for the client to connect). `kind: 'local'` servers are launched by the
// CLIENT itself as a subprocess (stdio) — nothing for the launcher to keep running,
// but also no "is it up" status to check.
const PROJECT_MCP_SERVERS = [
  { id: 'open-websearch', name: 'Web Search', kind: 'remote', url: 'http://localhost:3900/mcp', transport: 'http' },
  { id: 'chrome-devtools', name: 'Chrome DevTools', kind: 'local', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
  // The official fetch MCP server is a Python package run via uvx — NOT the npm
  // package of the same name, which is an unrelated squatted security placeholder.
  { id: 'webfetch', name: 'WebFetch', kind: 'local', command: 'uvx', args: ['mcp-server-fetch'] },
  { id: 'sequential-thinking', name: 'Sequential Thinking', kind: 'local', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
  // ahujasid/blender-mcp — a published PyPI package (fetched by uvx like webfetch
  // above), not a local checkout. Talks to a companion Blender addon over a socket
  // on port 9876; that addon must be installed and running inside Blender itself,
  // which this launcher has no way to automate.
  { id: 'blender-mcp', name: 'Blender MCP', kind: 'local', command: 'uvx', args: ['blender-mcp'] },
  // CoplayDev/unity-mcp — fetched globally via uvx from PyPI (package "mcpforunityserver"),
  // per its documented manual client config. Needs the companion "MCP for Unity" Unity
  // package installed in the target project (Package Manager -> Add from git URL:
  // https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#main) and the Editor
  // running with that bridge active — same out-of-launcher-scope caveat as Blender MCP.
  { id: 'unity-mcp', name: 'Unity MCP', kind: 'local', command: 'uvx', args: ['--from', 'mcpforunityserver', 'mcp-for-unity', '--transport', 'stdio'] },
];

function readJsonConfigFile(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`Could not parse ${filePath}: ${e.message}`);
  }
  return {};
}

function writeJsonConfigFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readTomlConfigFile(filePath) {
  try {
    if (fs.existsSync(filePath)) return TOML.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`Could not parse ${filePath}: ${e.message}`);
  }
  return {};
}

// Builds the common `{command, args}` stdio shape most clients use for a
// `kind: 'local'` server. A few clients (opencode, codex) need a different
// shape and build their own entry inline instead of using this.
function stdioEntry(server) {
  return { command: server.command, args: server.args };
}

// Whether `writerSupportsHttpOnly` clients (Codex CLI) can take this server:
// local/stdio servers work anywhere: only remote transport is restricted.
function supportsRemoteOrLocal(server, remoteTransports) {
  if (server.kind === 'local') return true;
  return remoteTransports.includes(server.transport);
}

// Each writer:
//  - supports(server): whether this client can use this server (checks kind/transport)
//  - configPath(): absolute path to the client's MCP config file
//  - isRegistered(server): whether `server` is currently present in that config
//  - apply(server, enabled, token): add or remove `server`'s entry (token optional,
//    remote-only)
const MCP_CLIENT_WRITERS = {
  claude: {
    supports: (server) => supportsRemoteOrLocal(server, ['sse', 'http']), // http, sse, and ws are all accepted
    configPath: () => path.join(homeDir, '.claude.json'),
    isRegistered(server) {
      const data = readJsonConfigFile(this.configPath());
      return !!(data.mcpServers && data.mcpServers[server.id]);
    },
    apply(server, enabled, token) {
      const filePath = this.configPath();
      const data = readJsonConfigFile(filePath);
      data.mcpServers = data.mcpServers || {};
      if (enabled) {
        data.mcpServers[server.id] = server.kind === 'local'
          ? stdioEntry(server)
          : {
              type: server.transport === 'sse' ? 'sse' : 'http',
              url: server.url,
              ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
            };
      } else {
        delete data.mcpServers[server.id];
        if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
      }
      writeJsonConfigFile(filePath, data);
    },
  },
  pi: {
    supports: (server) => supportsRemoteOrLocal(server, ['sse', 'http']),
    configPath: () => path.join(homeDir, '.pi', 'agent', 'mcp.json'),
    isRegistered(server) {
      const data = readJsonConfigFile(this.configPath());
      return !!(data.mcpServers && data.mcpServers[server.id]);
    },
    apply(server, enabled, token) {
      const filePath = this.configPath();
      const data = readJsonConfigFile(filePath);
      data.mcpServers = data.mcpServers || {};
      if (enabled) {
        data.mcpServers[server.id] = server.kind === 'local'
          ? stdioEntry(server) // matches this box's real ghidra-mcp entry shape
          : { url: server.url, ...(token ? { auth: 'bearer', bearerToken: token } : {}) };
      } else {
        delete data.mcpServers[server.id];
        if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
      }
      writeJsonConfigFile(filePath, data);
    },
  },
  'cursor-agent': {
    supports: (server) => supportsRemoteOrLocal(server, ['sse', 'http']),
    configPath: () => path.join(homeDir, '.cursor', 'mcp.json'),
    isRegistered(server) {
      const data = readJsonConfigFile(this.configPath());
      return !!(data.mcpServers && data.mcpServers[server.id]);
    },
    apply(server, enabled, token) {
      const filePath = this.configPath();
      const data = readJsonConfigFile(filePath);
      data.mcpServers = data.mcpServers || {};
      if (enabled) {
        data.mcpServers[server.id] = server.kind === 'local'
          ? stdioEntry(server)
          : { url: server.url, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
      } else {
        delete data.mcpServers[server.id];
        if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
      }
      writeJsonConfigFile(filePath, data);
    },
  },
  opencode: {
    supports: (server) => supportsRemoteOrLocal(server, ['sse', 'http']),
    // Real installs use opencode.jsonc (JSON-with-comments); fall back to the
    // plain .json the docs describe if that's what's actually there, and
    // default to creating .jsonc for a fresh install since that's what a real
    // `opencode` install on this machine produced.
    configPath: () => {
      const jsonc = path.join(homeDir, '.config', 'opencode', 'opencode.jsonc');
      const plain = path.join(homeDir, '.config', 'opencode', 'opencode.json');
      if (fs.existsSync(jsonc)) return jsonc;
      if (fs.existsSync(plain)) return plain;
      return jsonc;
    },
    isRegistered(server) {
      const filePath = this.configPath();
      if (!fs.existsSync(filePath)) return false;
      const data = jsoncParse(fs.readFileSync(filePath, 'utf8'));
      // Ground-truth from a real opencode.jsonc: entries live directly under
      // `mcp`, not `mcp.servers` — flatter than opencode's own docs describe.
      return !!(data.mcp && data.mcp[server.id]);
    },
    apply(server, enabled, token) {
      const filePath = this.configPath();
      let text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '{}';
      const formattingOptions = { tabSize: 2, insertSpaces: true, eol: '\n' };

      if (enabled) {
        // Ground-truth (real ghidra-mcp entry): local servers use a single array
        // combining the command and its args, under type "local".
        const entry = server.kind === 'local'
          ? { type: 'local', command: [server.command, ...server.args], enabled: true }
          : {
              type: 'remote',
              url: server.url,
              enabled: true,
              ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
            };
        const edits = jsoncModify(text, ['mcp', server.id], entry, { formattingOptions });
        text = jsoncApplyEdits(text, edits);
      } else {
        text = jsoncApplyEdits(text, jsoncModify(text, ['mcp', server.id], undefined, { formattingOptions }));
        // Tidy up: drop the now-empty `mcp` wrapper entirely rather than leaving `"mcp": {}`.
        const parsed = jsoncParse(text);
        if (parsed.mcp && Object.keys(parsed.mcp).length === 0) {
          text = jsoncApplyEdits(text, jsoncModify(text, ['mcp'], undefined, { formattingOptions }));
        }
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, text, 'utf8');
    },
  },
  gemini: {
    supports: (server) => supportsRemoteOrLocal(server, ['sse', 'http']),
    configPath: () => path.join(homeDir, '.gemini', 'settings.json'),
    isRegistered(server) {
      const data = readJsonConfigFile(this.configPath());
      return !!(data.mcpServers && data.mcpServers[server.id]);
    },
    // Gemini CLI uses a different key per transport: `url` for SSE, `httpUrl`
    // for streamable HTTP. Token/header auth isn't documented for either, so
    // it's intentionally not offered here rather than guessed.
    apply(server, enabled) {
      const filePath = this.configPath();
      const data = readJsonConfigFile(filePath);
      data.mcpServers = data.mcpServers || {};
      if (enabled) {
        data.mcpServers[server.id] = server.kind === 'local'
          ? stdioEntry(server)
          : (server.transport === 'sse' ? { url: server.url } : { httpUrl: server.url });
      } else {
        delete data.mcpServers[server.id];
        if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
      }
      writeJsonConfigFile(filePath, data);
    },
  },
  codex: {
    // Codex CLI's remote transport is streamable-HTTP only, not SSE — any
    // SSE-only server can't be registered there. Local/stdio servers work regardless.
    supports: (server) => supportsRemoteOrLocal(server, ['http']),
    configPath: () => path.join(homeDir, '.codex', 'config.toml'),
    isRegistered(server) {
      const data = readTomlConfigFile(this.configPath());
      return !!(data.mcp_servers && data.mcp_servers[server.id]);
    },
    apply(server, enabled) {
      const filePath = this.configPath();
      const data = readTomlConfigFile(filePath);
      data.mcp_servers = data.mcp_servers || {};
      if (enabled) {
        data.mcp_servers[server.id] = server.kind === 'local'
          ? { command: server.command, args: server.args }
          : { url: server.url };
      } else {
        delete data.mcp_servers[server.id];
        if (Object.keys(data.mcp_servers).length === 0) delete data.mcp_servers;
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, TOML.stringify(data), 'utf8');
    },
  },
  cline: {
    // This targets the standalone Cline CLI (~/.cline/mcp.json), not the VS Code
    // extension — that variant's config lives inside VS Code's per-extension
    // global storage at an OS/version-dependent path, too fragile to safely
    // automate here.
    supports: (server) => supportsRemoteOrLocal(server, ['sse', 'http']),
    configPath: () => path.join(homeDir, '.cline', 'mcp.json'),
    isRegistered(server) {
      const data = readJsonConfigFile(this.configPath());
      return !!(data.mcpServers && data.mcpServers[server.id]);
    },
    apply(server, enabled, token) {
      const filePath = this.configPath();
      const data = readJsonConfigFile(filePath);
      data.mcpServers = data.mcpServers || {};
      if (enabled) {
        // Cline's schema requires `type` explicitly for remote servers — omitting
        // it defaults to legacy SSE, which would silently misconfigure the
        // streamable-HTTP ones (e.g. Web Search).
        data.mcpServers[server.id] = server.kind === 'local'
          ? { ...stdioEntry(server), disabled: false }
          : {
              type: server.transport === 'sse' ? 'sse' : 'streamableHttp',
              url: server.url,
              disabled: false,
              ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
            };
      } else {
        delete data.mcpServers[server.id];
        if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
      }
      writeJsonConfigFile(filePath, data);
    },
  },
};

// Default project configurations (command, args, etc.)
// Paths are resolved dynamically using homeDir + relativePath from projectDirs.json.
// Relative paths resolve to homeDir by default, but can be overridden via:
//   - The web UI ("Set Folder" button)
//   - Environment variables: PROJECT_DIR_<ID>=<absolute-path>
//   - The projectDirs.json file
const projectConfigs = {
  llamacpp: {
    name: 'Llama.cpp Server',
    port: 8080,
    relativePath: 'llama.cpp-fable5',
    // Windows CMake builds using the MSVC "Visual Studio" solution generator put
    // the binary under a Release\ subfolder; Ninja-generator builds (the default
    // when cmake auto-picks Ninja, as opposed to `-G "Visual Studio 17 2022"`)
    // output flat to build\bin regardless of --config. This assumes Ninja.
    cmd: process.platform === 'win32'
      ? '.\\build\\bin\\llama-server.exe'
      : './build/bin/llama-server',
    args: ['--port', '8080', '--host', '127.0.0.1'],
    url: 'http://localhost:8080',
    isEngine: true
  },
  pithagoras: {
    name: 'Pithagoras',
    port: 4100,
    relativePath: 'pithagoras',
    cmd: 'npm',
    args: ['run', 'dev:server'],
    url: 'http://localhost:4100'
  },
  understory: {
    name: 'Understory',
    port: 3800,
    relativePath: 'understory',
    cmd: 'pnpm',
    args: ['dev'],
    url: 'http://localhost:3800'
  },
  agentbox: {
    name: 'AgentBox',
    port: 3000,
    relativePath: 'agentbox/app',
    cmd: 'npm',
    args: ['run', 'dev'],
    url: 'http://localhost:3000'
  },
  pi: {
    name: 'Coding Agent',
    port: null,
    relativePath: '',
    ...buildTerminalLaunch('pi'),
    url: null,
    isTerminal: true
  },
  'open-websearch': {
    // Backs the "Web Search" MCP server below — nothing was actually running this
    // service before, so any client with it ticked failed to connect to :3900.
    // It's an npx-fetched package, not a local checkout, so there's no project
    // folder to point at (isEngine skips the npm-install-in-this-dir step).
    name: 'Web Search (MCP)',
    port: 3900,
    relativePath: '',
    cmd: 'npx',
    args: ['-y', 'open-websearch@latest'],
    url: 'http://localhost:3900/mcp',
    isEngine: true
  }
};

// Get project with resolved directory (env var > persisted override > homeDir + relativePath)
function getProject(id) {
  const base = projectConfigs[id];
  if (!base) return null;
  // Priority: env var override > saved override > relative path under homeDir
  const envKey = `PROJECT_DIR_${id.toUpperCase()}`;
  let dir;
  if (process.env[envKey]) {
    dir = path.resolve(process.env[envKey]);
  } else if (projectDirs[id]) {
    dir = projectDirs[id];
  } else if (base.relativePath) {
    dir = path.join(homeDir, base.relativePath);
  } else {
    dir = homeDir;
  }

  // llamacpp's actual host/port are runtime-configurable (Server section in the UI) and
  // override the static defaults above — reflect that here so the UI card and this object
  // never show a stale port/url that disagrees with what --start actually launches.
  if (id === 'llamacpp') {
    const host = config.host || '127.0.0.1';
    const port = config.port || base.port;
    // Display name is derived from whatever directory this actually points at (e.g. a
    // fork named "llama.cpp-fable5" or a plain "llama.cpp" checkout) rather than hardcoded,
    // so it stays accurate across machines and if the dir override changes.
    const name = `Llama.cpp Server (${path.basename(dir)})`;
    return { ...base, dir, port, url: `http://${host}:${port}`, name };
  }

  return { ...base, dir };
}

const processes = {};

function parseContextAmount(raw) {
  const val = (raw || '').trim().toLowerCase();
  if (!val) return null;
  const match = val.match(/^([\d.]+)(k|m)?$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2];
  if (isNaN(num) || num <= 0) return null;
  let result;
  if (unit === 'k') {
    result = Math.round(num * 1000);
  } else if (unit === 'm') {
    result = Math.round(num * 1000000);
  } else {
    result = Math.round(num);
  }
  return result;
}

app.use(express.json());
app.use(express.static('public'));

app.get('/api/projects', (req, res) => {
  const status = Object.entries(projectConfigs).map(([key, proj]) => ({
    id: key,
    ...getProject(key),
    savedDir: projectDirs[key] || null,
    running: !!processes[key]
  }));
  res.json(status);
});

// GPU VRAM usage (NVIDIA only, via nvidia-smi). Returns null if unavailable
// (no NVIDIA GPU, driver not installed, etc.) so the UI can just hide the stat.
app.get('/api/gpu-stats', (req, res) => {
  execFile('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], (err, stdout) => {
    if (err) return res.json({ available: false });
    // Multi-GPU machines report one line per card — sum them for a single total.
    const totals = stdout.trim().split('\n').reduce((acc, line) => {
      const [used, total] = line.split(',').map(s => parseInt(s.trim(), 10));
      acc.used += used;
      acc.total += total;
      return acc;
    }, { used: 0, total: 0 });
    res.json({ available: true, usedMb: totals.used, totalMb: totals.total });
  });
});

app.get('/api/models', (req, res) => {
  const models = getAvailableModels();
  res.json(models);
});

// List subdirectories of a folder, for the in-page folder browser
app.get('/api/browse', (req, res) => {
  const dirPath = req.query.path || homeDir;
  try {
    const dirs = readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    const ggufCount = readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.gguf')).length;
    res.json({
      path: dirPath,
      parent: path.dirname(dirPath),
      dirs,
      ggufCount
    });
  } catch (e) {
    res.status(400).json({ error: `Cannot read folder: ${e.message}` });
  }
});

// Add a folder to be scanned for models
app.post('/api/add-model-folder', (req, res) => {
  const { folder } = req.body;
  if (!folder) return res.status(400).json({ error: 'Folder path required' });
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(400).json({ error: 'Not a valid folder' });
  }

  const found = [];
  scanDir(folder, path.basename(folder), found);
  if (found.length === 0) {
    return res.status(400).json({ error: 'No .gguf files found in that folder or its subfolders' });
  }

  if (!extraModelDirs.includes(folder)) {
    extraModelDirs.push(folder);
    saveExtraModelDirs(extraModelDirs);
  }
  res.json({ success: true, count: found.length });
});

// Clear the model picker's cache: drops every "Browse for Models Folder" extra
// directory (the actual source of stale results after a model is moved — the
// primary modelsDir is left alone) and prunes modelFlags.json entries whose
// file no longer exists on disk.
app.post('/api/clear-model-cache', (req, res) => {
  const removedDirs = extraModelDirs.length;
  extraModelDirs.length = 0;
  saveExtraModelDirs(extraModelDirs);

  let removedFlags = 0;
  for (const modelPath of Object.keys(modelFlags)) {
    if (!fs.existsSync(modelPath)) {
      delete modelFlags[modelPath];
      removedFlags++;
    }
  }
  if (removedFlags > 0) saveModelFlags(modelFlags);

  // If the currently selected model no longer exists, clear the selection too.
  let clearedSelection = false;
  if (config.selectedModel && !fs.existsSync(config.selectedModel)) {
    config.selectedModel = null;
    saveLauncherConfig(config);
    clearedSelection = true;
  }

  res.json({ success: true, removedDirs, removedFlags, clearedSelection });
});

// Set a project directory (persisted across restarts)
app.post('/api/set-project-dir', (req, res) => {
  const { projectId, dir } = req.body;
  if (!projectId || !dir) {
    return res.status(400).json({ error: 'projectId and dir are required' });
  }
  if (!projectConfigs[projectId]) {
    return res.status(400).json({ error: 'Unknown project' });
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return res.status(400).json({ error: 'Not a valid folder' });
  }
  projectDirs[projectId] = dir;
  saveProjectDirs(projectDirs);
  res.json({ success: true, dir: projectDirs[projectId] });
});

// Reset a project directory back to its default
app.post('/api/reset-project-dir', (req, res) => {
  const { projectId } = req.body;
  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' });
  }
  delete projectDirs[projectId];
  saveProjectDirs(projectDirs);
  const defDir = projectConfigs[projectId].dir;
  res.json({ success: true, dir: defDir });
});

// Get all persisted project directories
app.get('/api/project-dirs', (req, res) => {
  res.json(projectDirs);
});

// Set the models directory
app.post('/api/set-models-dir', (req, res) => {
  const { dir } = req.body;
  if (!dir) return res.status(400).json({ error: 'Directory path required' });
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return res.status(400).json({ error: 'Not a valid folder' });
  }
  modelsDir = dir;
  // Clear extra model dirs since we have a primary one now
  extraModelDirs.length = 0;
  saveExtraModelDirs(extraModelDirs);
  // Persist immediately
  config.modelsDir = dir;
  saveLauncherConfig(config);
  res.json({ success: true, dir: modelsDir });
});

// Get the current models directory
app.get('/api/models-dir', (req, res) => {
  res.json({ dir: modelsDir });
});

// Set the models directory from a persisted config (for startup)
app.post('/api/set-models-dir-from-config', (req, res) => {
  const { dir } = req.body;
  if (dir) {
    modelsDir = dir;
    config.modelsDir = dir;
    saveLauncherConfig(config);
  }
  res.json({ success: true, dir: modelsDir });
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.get('/api/home', (req, res) => {
  res.json({ homeDir: homeDir });
});

app.get('/api/system-info', (req, res) => {
  res.json({ cpuCores: detectedCpuCores });
});

app.get('/api/agent-clis', (req, res) => {
  res.json(CODING_AGENT_CLIS);
});

// List of MCP servers this stack exposes, plus which CLIs each is compatible with.
app.get('/api/mcp-servers', (req, res) => {
  res.json(
    PROJECT_MCP_SERVERS.map((server) => ({
      ...server,
      compatibleClients: Object.keys(MCP_CLIENT_WRITERS).filter((id) =>
        MCP_CLIENT_WRITERS[id].supports(server)
      ),
    }))
  );
});

// Whether each MCP server is currently registered in the given client's own config,
// for populating checkbox state. Read-only — never writes anything.
app.get('/api/mcp-status', (req, res) => {
  const agentId = req.query.agentId;
  const writer = MCP_CLIENT_WRITERS[agentId];

  const results = PROJECT_MCP_SERVERS.map((server) => {
    if (!writer) return { serverId: server.id, supported: false, compatible: false, registered: false };
    const compatible = writer.supports(server);
    let registered = false;
    if (compatible) {
      try {
        registered = writer.isRegistered(server);
      } catch (e) {
        return { serverId: server.id, supported: true, compatible, registered: false, error: e.message };
      }
    }
    return { serverId: server.id, supported: true, compatible, registered };
  });

  res.json({ agentId, servers: results });
});

// Add or remove one MCP server's entry from the given client's config file.
app.post('/api/mcp-toggle', (req, res) => {
  const { agentId, serverId, enabled, token } = req.body;

  const writer = MCP_CLIENT_WRITERS[agentId];
  if (!writer) {
    return res.status(400).json({ error: `MCP registration isn't supported for "${agentId}"` });
  }

  const server = PROJECT_MCP_SERVERS.find((s) => s.id === serverId);
  if (!server) return res.status(404).json({ error: 'Unknown MCP server' });

  if (!writer.supports(server)) {
    const transportLabel = server.transport === 'sse' ? 'SSE' : 'streamable HTTP';
    return res.status(400).json({
      error: `${agentId} doesn't support ${transportLabel} remote servers, so ${server.name} can't be registered here.`,
    });
  }

  try {
    writer.apply(server, !!enabled, token || undefined);
    res.json({ ok: true, configPath: writer.configPath() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config', (req, res) => {
  // Whitelist: only copy explicitly allowed fields from the request
  const filtered = {};
  for (const key of ALLOWED_CONFIG_KEYS) {
    if (key in req.body) filtered[key] = req.body[key];
  }
  Object.assign(config, filtered);

  // Sync modelsDir variable with config.modelsDir
  if (config.modelsDir !== undefined) {
    modelsDir = config.modelsDir;
  }

  // Persist general config to disk so it survives restarts
  saveLauncherConfig(config);

  // If a model is selected and flags are being set, save per-model
  if (req.body.selectedModel && config.selectedModel) {
    const modelPath = config.selectedModel;
    const existing = modelFlags[modelPath] || {};
    // Update only the flag fields from the request
    for (const key of FLAG_KEYS) {
      if (key in req.body) existing[key] = req.body[key];
    }
    modelFlags[modelPath] = existing;
    saveModelFlags(modelFlags);
  }

  res.json({ success: true, config });
});

app.post('/api/set-model', (req, res) => {
  const { modelPath } = req.body;
  if (!modelPath) {
    config.selectedModel = null;
    saveLauncherConfig(config);
    return res.json({ success: true, message: 'Model cleared' });
  }

  config.selectedModel = modelPath;
  saveLauncherConfig(config);

  // Auto-load saved flags for this model
  const savedFlags = modelFlags[modelPath];
  const flagsToApply = savedFlags || {};

  res.json({
    success: true,
    message: savedFlags ? `Model set to ${modelPath} (loaded saved flags)` : `Model set to ${modelPath} (no saved flags)`,
    flags: flagsToApply
  });
});

// Get flags for a specific model
app.get('/api/model-flags/:modelPath', (req, res) => {
  const flags = modelFlags[req.params.modelPath] || {};
  res.json(flags);
});

// Delete saved flags for a model
app.delete('/api/model-flags/:modelPath', (req, res) => {
  delete modelFlags[req.params.modelPath];
  saveModelFlags(modelFlags);
  res.json({ success: true, message: 'Flags deleted for this model' });
});

// List all models with saved flags
app.get('/api/model-flags', (req, res) => {
  res.json(modelFlags);
});

// Look in a model's folder for mmproj-*/mtp-*/draft-* companion GGUF files and
// a *.jinja chat template override, so the UI can auto-populate them when a
// model is selected. Excludes imatrix files and split-shard parts (never companions).
app.get('/api/model-companions', (req, res) => {
  const modelPath = req.query.modelPath;
  if (!modelPath) return res.status(400).json({ error: 'modelPath query param required' });

  try {
    const dir = path.dirname(modelPath);
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile());
    const ggufs = entries.filter(e => e.name.toLowerCase().endsWith('.gguf'));

    const mmproj = ggufs
      .filter(e => /^mmproj-/i.test(e.name))
      .map(e => path.join(dir, e.name));
    const mtp = ggufs
      .filter(e => /^mtp-/i.test(e.name))
      .map(e => path.join(dir, e.name));
    const draft = ggufs
      .filter(e => /^draft-/i.test(e.name))
      .map(e => path.join(dir, e.name));
    const chatTemplate = entries
      .filter(e => e.name.toLowerCase().endsWith('.jinja'))
      .map(e => path.join(dir, e.name));

    res.json({ mmproj, mtp, draft, chatTemplate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/start/:id', async (req, res) => {
  const proj = getProject(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });

  if (processes[req.params.id]) {
    return res.json({ message: 'Already running' });
  }

  const env = {
    ...process.env,
    ANTHROPIC_API_KEY: config.apiKey || process.env.ANTHROPIC_API_KEY
  };

  // open-websearch defaults to port 3000; the MCP entry below expects 3900.
  if (req.params.id === 'open-websearch') {
    env.PORT = String(proj.port);
  }

  let args = [...proj.args];

  // For the terminal agent card, swap in whichever coding agent CLI the user picked
  // from the dropdown — defaults to Pi if nothing was sent.
  if (req.params.id === 'pi') {
    const agent = CODING_AGENT_CLIS.find(a => a.id === req.body.agentId) || CODING_AGENT_CLIS[0];
    const launch = buildTerminalLaunch(agent.cmd);
    proj.cmd = launch.cmd;
    args = launch.args;
  }

  // For llama.cpp, add model path and individual flags
  if (req.params.id === 'llamacpp') {
    // CMake's "Visual Studio" solution generator puts binaries under build\bin\Release\;
    // the Ninja generator (also common — e.g. `cmake -B build` auto-picks Ninja if it's
    // on PATH) puts them flat in build\bin. Same repo, same commit, different machines
    // can end up with either layout depending on how they were configured — detect which
    // one this checkout actually has rather than assuming, so the launcher isn't tied to
    // whichever generator happened to be used on the machine it was last edited on.
    if (process.platform === 'win32' && req.params.id === 'llamacpp') {
      const releaseBin = path.join(proj.dir, 'build', 'bin', 'Release', 'llama-server.exe');
      const flatBin = path.join(proj.dir, 'build', 'bin', 'llama-server.exe');
      if (fs.existsSync(releaseBin)) {
        proj.cmd = '.\\build\\bin\\Release\\llama-server.exe';
      } else if (fs.existsSync(flatBin)) {
        proj.cmd = '.\\build\\bin\\llama-server.exe';
      }
      // else: neither exists yet (not built) — leave proj.cmd at its default and let
      // the spawn fail with a clear ENOENT rather than silently guessing.
    }

    if (config.rpcWorkerMode === '1') {
      // RPC worker mode: this machine contributes raw GPU/CPU compute to a
      // remote llama-server over the network. It loads no model itself —
      // swap the binary to rpc-server (same build/bin folder) and skip every
      // model/sampling flag below, which don't apply to rpc-server at all.
      const rpcServerCmd = process.platform === 'win32'
        ? proj.cmd.replace(/llama-server\.exe$/, 'ggml-rpc-server.exe')
        : proj.cmd.replace(/llama-server$/, 'ggml-rpc-server');
      proj.cmd = rpcServerCmd;
      args = ['-H', (config.rpcWorkerHost || '0.0.0.0').trim(), '-p', (config.rpcWorkerPort || '50052').trim()];
    } else if (config.selectedModel) {
      args = ['-m', config.selectedModel];

      // Vision projector (mmproj) — pushed as its own array element so paths
      // with spaces (e.g. "Mud loggit") survive; never route through customFlags.
      // Gated on mmprojEnabled so the saved path can persist without being active.
      if (config.mmprojEnabled === '1' && config.mmproj && config.mmproj.trim()) {
        args.push('--mmproj', config.mmproj.trim());
        if (config.imageMinTokens && parseInt(config.imageMinTokens) > 0) {
          args.push('--image-min-tokens', config.imageMinTokens);
        }
      }

      // Speculative decoding: MTP (self-speculative, same-model sidecar) and
      // classic draft-model speculation both load via -md, so only one can be
      // active — MTP wins if both are checked. mtpModel may be blank for models
      // that embed MTP layers directly in the main GGUF (e.g. Gemma 4).
      if (config.mtpEnabled === '1') {
        if (config.mtpModel && config.mtpModel.trim()) {
          args.push('-md', config.mtpModel.trim());
        }
        args.push('--spec-type', 'draft-mtp');
      } else if (config.draftEnabled === '1' && config.draftModel && config.draftModel.trim()) {
        args.push('-md', config.draftModel.trim());
      }
      if ((config.mtpEnabled === '1' || config.draftEnabled === '1') &&
          config.specDraftNMax && parseInt(config.specDraftNMax) > 0) {
        args.push('--spec-draft-n-max', config.specDraftNMax);
      }

      // Overrides the GGUF's embedded chat template (used with --chat-template-file
      // fixes for models with known-buggy embedded templates, e.g. Qwen3.6).
      if (config.chatTemplateFile && config.chatTemplateFile.trim()) {
        args.push('--chat-template-file', config.chatTemplateFile.trim());
      }

      // Add context amount as -c flag if provided
      const ctxParsed = parseContextAmount(config.contextAmount);
      if (ctxParsed !== null) {
        args.push('-c', ctxParsed.toString());
      }

      // Individual flags - only add if they differ from defaults
      if (config.ngl && parseInt(config.ngl) !== 99) args.push('-ngl', config.ngl);
      if (config.nCpuMoe && parseInt(config.nCpuMoe) !== 40) args.push('--n-cpu-moe', config.nCpuMoe);
      if (config.fa && config.fa !== '1') args.push('-fa', config.fa);
      if (config.jinja && config.jinja !== '1') args.push('--jinja', config.jinja);
      if (config.cnv && config.cnv !== '1') args.push('-cnv', config.cnv);
      if (config.ctk && config.ctk !== 'q8_0') args.push('-ctk', config.ctk);
      if (config.ctv && config.ctv !== 'q8_0') args.push('-ctv', config.ctv);
      if (config.reasoningFormat && config.reasoningFormat !== 'deepseek') args.push('--reasoning-format', config.reasoningFormat);
      if (config.reasoningBudget && parseInt(config.reasoningBudget) !== 0) args.push('--reasoning-budget', config.reasoningBudget);

      // Reasoning effort (Qwen3.8-27B and similar reasoning-effort-aware chat templates:
      // xhigh/medium/low/none). Threaded into the jinja chat template as a kwarg, not a
      // dedicated CLI sampling flag.
      if (config.reasoningEffort && config.reasoningEffort.trim()) {
        args.push('--chat-template-kwargs', JSON.stringify({ reasoning_effort: config.reasoningEffort.trim() }));
      }

      // Preserve thinking: keeps prior turns' <think> reasoning in context instead of
      // stripping it before the next request. Needed for agentic multi-turn use where the
      // model should see its own past reasoning (client must also resend reasoning_content).
      if (config.reasoningPreserve === '1') {
        args.push('--reasoning-preserve');
      }

      // Max tokens to predict
      if (config.nPredict && parseInt(config.nPredict) > 0) args.push('--n-predict', config.nPredict);

      // Sampling flags
      if (config.temp && parseFloat(config.temp) !== 0.8) args.push('--temp', config.temp);
      if (config.topP && parseFloat(config.topP) !== 0.95) args.push('--top-p', config.topP);
      if (config.topK && parseInt(config.topK) !== 40) args.push('--top-k', config.topK);
      if (config.repeatPenalty && parseFloat(config.repeatPenalty) !== 1.1) args.push('--repeat-penalty', config.repeatPenalty);
      if (config.repeatLastN && parseInt(config.repeatLastN) !== 64) args.push('--repeat-last-n', config.repeatLastN);
      if (config.minP && parseFloat(config.minP) !== 0.05) args.push('--min-p', config.minP);
      if (config.presencePenalty && parseFloat(config.presencePenalty) !== 0) args.push('--presence-penalty', config.presencePenalty);

      // Performance flags
      if (config.threads && parseInt(config.threads) > 0) args.push('--threads', config.threads);
      if (config.threadsBatch && parseInt(config.threadsBatch) > 0) args.push('--threads-batch', config.threadsBatch);
      if (config.batchSize && parseInt(config.batchSize) !== 512) args.push('--batch-size', config.batchSize);
      if (config.noMmap === '1') args.push('--no-mmap');
      if (config.mlock === '1') args.push('--mlock');
      if (config.noRepack === '1') args.push('-nr');

      // Server-only flags (host/port) - use user values or defaults
      if (config.host) {
        args.push('--host', config.host);
      } else {
        args.push('--host', '127.0.0.1');
      }
      if (config.port) {
        args.push('--port', config.port);
      } else {
        args.push('--port', '8080');
      }

      // RPC offload to remote llama.cpp worker(s) — off by default, machine-specific
      if (config.rpcEnabled === '1' && config.rpcAddress && config.rpcAddress.trim()) {
        args.push('--rpc', config.rpcAddress.trim());

        // Tensor split only makes sense once there's more than one device to
        // split across (this local GPU + at least one RPC worker) — gate it on
        // RPC actually being enabled so it doesn't silently affect single-GPU
        // local runs where no split was ever intended.
        if (config.tensorSplit && config.tensorSplit.trim()) {
          args.push('--tensor-split', config.tensorSplit.trim());
        }
      }

      // Legacy extra custom flags (free-text fallback)
      if (config.customFlags && config.customFlags.trim()) {
        const customArgs = config.customFlags.trim().split(/\s+/);
        args = args.concat(customArgs);
      }
    }
  }

  // Check if node_modules exists, install if needed (skip for engines like
  // llama-server — they're compiled binaries, not npm projects)
  const nodeModulesPath = path.join(proj.dir, 'node_modules');
  if (!proj.isEngine && !fs.existsSync(nodeModulesPath)) {
    console.log(`${proj.name}: node_modules not found, running install...`);
    const installCmd = fs.existsSync(path.join(proj.dir, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
    const installArgs = installCmd === 'pnpm' ? ['install'] : ['install'];
    const installProc = spawn(installCmd, installArgs, {
      cwd: proj.dir,
      stdio: 'inherit',
      env,
      shell: true
    });
    
    await new Promise((resolve, reject) => {
      installProc.on('exit', (code) => {
        if (code === 0) {
          console.log(`${proj.name}: Dependencies installed successfully`);
          resolve();
        } else {
          reject(new Error(`Failed to install dependencies (exit code ${code})`));
        }
      });
      installProc.on('error', reject);
    });
  }

  // Add local node_modules/.bin to PATH so npm/pnpm scripts can find local binaries
  const localBinPath = path.join(proj.dir, 'node_modules', '.bin');
  const spawnOpts = {
    cwd: proj.dir,
    stdio: 'inherit',
    env: {
      ...env,
      PATH: `${localBinPath}${path.delimiter}${env.PATH || process.env.PATH}`
    },
    // Only npm/pnpm need a shell on Windows (they're .cmd shims, not real
    // executables). llama-server.exe is a real executable — shell:true would
    // make Windows concatenate args into one unquoted command-line string,
    // silently breaking any path containing a space (e.g. "Mud loggit").
    // llamacpp is a real .exe, and the Windows 'pi' launch already goes through
    // cmd.exe itself (buildTerminalLaunch) — neither needs a second shell layer.
    shell: !(req.params.id === 'llamacpp' || (req.params.id === 'pi' && process.platform === 'win32'))
  };

  // llama-server's output is large and long-running — send it to its own log file
  // instead of inheriting the launcher's stdio, so a viewer terminal can tail it
  // live independent of how the launcher itself was launched.
  if (req.params.id === 'llamacpp') {
    const logFd = fs.openSync(LLAMACPP_LOG_FILE, 'w');
    spawnOpts.stdio = ['ignore', logFd, logFd];
  }

  const proc = spawn(proj.cmd, args, spawnOpts);

  // Open a terminal that tails the filtered log (keeps warnings/errors/token speeds,
  // drops per-request bookkeeping noise).
  if (req.params.id === 'llamacpp') {
    const terminal = detectPiTerminal();
    if (terminal === 'ptyxis') {
      const tailCmd = `tail -n 200 -f '${LLAMACPP_LOG_FILE}' | grep --line-buffered -Ev '${LLAMACPP_LOG_NOISE.source}'`;
      spawn('ptyxis', ['--new-window', '-T', 'Llama.cpp Server', '--', 'bash', '-lic', `${tailCmd}; exec bash`], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      // No ptyxis/gnome-terminal on Windows — open a PowerShell window that tails
      // the log live instead, so startup success/failure is still visible without
      // opening the log file by hand.
      const psFilter = LLAMACPP_LOG_NOISE.source.replace(/'/g, "''");
      const psCmd = `Get-Content -Path '${LLAMACPP_LOG_FILE}' -Wait -Tail 200 | Where-Object { $_ -notmatch '${psFilter}' }`;
      spawn('cmd.exe', ['/c', 'start', 'Llama.cpp Server', 'powershell.exe', '-NoExit', '-Command', psCmd], { detached: true, stdio: 'ignore' }).unref();
    } else {
      console.log(`llamacpp: terminal viewer skipped (no ptyxis) — tail -f ${LLAMACPP_LOG_FILE} manually`);
    }
  }

  if (!proj.isTerminal) {
    processes[req.params.id] = proc;
  }

  let responded = false;

  // For the terminal agent card, refer to the actually-launched CLI in messages, not the
  // static card name.
  const launchedName = req.params.id === 'pi'
    ? (CODING_AGENT_CLIS.find(a => a.id === req.body.agentId) || CODING_AGENT_CLIS[0]).name
    : proj.name;

  proc.on('exit', () => {
    delete processes[req.params.id];
  });

  proc.on('error', (err) => {
    console.error(`Failed to start ${launchedName}:`, err.message);
    delete processes[req.params.id];
    if (!responded) {
      responded = true;
      res.status(500).json({ error: `Failed to start ${launchedName}: ${err.message}` });
    }
  });

  if (!responded) {
    responded = true;
    res.json({ success: true, message: proj.isTerminal ? `${launchedName} opened in a new terminal` : `${proj.name} starting...` });
  }
});

app.post('/api/stop/:id', (req, res) => {
  const proj = getProject(req.params.id);
  const proc = processes[req.params.id];
  if (!proc) return res.status(404).json({ error: 'Not running' });

  proc.kill('SIGTERM');
  res.json({ success: true, message: 'Stopping...' });
});

// ── Startup checks ──────────────────────────────────────────────────────────
try {
  fs.accessSync(effectiveLauncherDir, fs.constants.W_OK);
} catch (e) {
  console.error(`\n❌  Error: Config directory is not writable: ${effectiveLauncherDir}`);
  console.error('   Check permissions or set LAUNCHER_DIR to a writable directory.\n');
  process.exit(1);
}

app.listen(port, () => {
  const info = [
    '',
    '🚀 Launcher running at http://localhost:' + port,
    `   Config dir:  ${effectiveLauncherDir}`,
    `   Models dir:  ${modelsDir || '(not set — use web UI to configure)'}`,
    `   Home dir:    ${homeDir}`,
    '   Press Ctrl+C to stop',
    ''
  ];
  console.log(info.join('\n'));
});
