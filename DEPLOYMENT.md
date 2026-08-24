# Deployment Guide

This launcher is designed to work on **any computer** without editing code. It supports different usernames, folder locations, and terminal emulators.

## Quick Setup

### Linux/macOS
```bash
cd /path/to/launcher
./setup.sh
npm start
```

### Windows
```powershell
cd path\to\launcher
.\setup.ps1
npm start
```

Then open **http://localhost:5000** in your browser.

## Configuration Methods

### 1. Web UI (Recommended)
- Set models directory via folder browser
- Set project directories for each app
- Add extra model folders
- Settings persist in `launcherConfig.json` and `projectDirs.json`

### 2. Environment Variables
Set these before starting the launcher:

```bash
# Models directory
MODELS_DIR=/home/user/models

# Project directories (override defaults)
PROJECT_DIR_PITHAGORAS=/path/to/pithagoras
PROJECT_DIR_UNDERSTORY=/path/to/understory
PROJECT_DIR_AGENTBOX=/path/to/agentbox

# Terminal for Pi (Linux/macOS only)
LAUNCHER_PI_TERMINAL=gnome-terminal

# Store config files elsewhere (portable installs)
LAUNCHER_DIR=/path/to/config/dir
```

### 3. .env File
Create a `.env` file in the launcher directory:

```env
MODELS_DIR=/home/user/models
PROJECT_DIR_PITHAGORAS=/path/to/pithagoras
PROJECT_DIR_UNDERSTORY=/path/to/understory
LAUNCHER_PI_TERMINAL=ptyxis
LAUNCHER_DIR=/path/to/config
```

## Project Directory Resolution

Directories are resolved in this priority order:

1. **Environment variable** `PROJECT_DIR_<ID>` (highest priority)
2. **Saved override** in `projectDirs.json` (via web UI)
3. **Default relative path** under home directory (`~/pithagoras`, etc.)
4. **Home directory** itself

## File Structure

```
launcher/
├── server.js              # Main server (no hardcoded paths)
├── package.json           # Dependencies
├── .env                   # Machine-specific config (gitignored)
├── launcherConfig.json    # General settings (gitignored)
├── projectDirs.json       # Project paths (gitignored)
├── modelFlags.json        # Per-model flags (gitignored)
├── setup.sh               # Linux/macOS setup script
├── setup.ps1              # Windows setup script
└── public/
    └── index.html         # Web UI
```

## Key Features

- ✅ **No hardcoded paths** — uses `os.homedir()` and relative paths
- ✅ **Portable** — works from USB drives or any location
- ✅ **Configurable** — set paths via UI, env vars, or .env file
- ✅ **Terminal detection** — auto-detects best terminal for Pi
- ✅ **Permission checks** — validates config directory is writable
- ✅ **Clean configs** — starts with empty defaults for fresh setup

## Troubleshooting

**"Config directory is not writable"**
```bash
chmod u+w /path/to/launcher
# Or set LAUNCHER_DIR to a writable directory
```

**"Port already in use"**
```bash
# Kill the process on port 5000
lsof -ti:5000 | xargs kill -9  # Linux/macOS
netstat -ano | findstr :5000   # Windows, then kill PID
```

**Projects not found**
- Use web UI to set project directories
- Or set `PROJECT_DIR_<ID>` environment variables
- Or create a `.env` file

**Models not showing**
- Set models directory via web UI or `MODELS_DIR` env var
- Ensure folder exists and has read permissions
- Models must be `.gguf` format

## Migration from Another Computer

1. Copy the entire `launcher` folder to the new computer
2. Run `setup.sh` or `setup.ps1` (creates .env with default paths)
3. Use the web UI to set correct paths for the new machine
4. Or edit `.env` with your new paths

The launcher will work immediately with empty configs — just set paths via the UI.

## Support

- README.md — Full documentation
- Web UI — Set paths and configure projects
- .env file — Machine-specific overrides
