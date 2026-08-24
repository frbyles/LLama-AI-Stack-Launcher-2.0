# 🚀 Project Launcher

A web-based launcher for managing your local AI development stack. Control Pithagoras, Understory, AgentBox, and llama.cpp from one dashboard with custom model selection and flag configuration.

## 🌍 Multi-Computer Deployment

This launcher is designed to work on **any machine** without editing code. It supports:

- **Portable installation** — Install the launcher anywhere on any computer
- **Configurable paths** — Set up project directories and models folder via the web UI or `.env` file
- **Environment variable overrides** — Fine-tune settings without touching config files
- **Auto-detection** — Picks the best terminal emulator for your system

### Quick Start on a New Computer

```bash
# 1. Copy the launcher folder to your desired location
cp -r /path/to/launcher ~/launcher

# 2. Run the setup script (Linux/macOS)
cd ~/launcher
./setup.sh

# 3. Start the launcher
npm start

# 4. Open http://localhost:5000 in your browser
```

The web UI will guide you through setting up your models folder and project directories.

## Features

- 🎛️ **Start/Stop Projects** - Manage all 4 projects from one UI
- 📦 **Model Selection** - Choose from models in your configured models folder
- ⚙️ **Custom Flags** - Add llama.cpp flags like `-ngl 99 -c 65536`
- 🔗 **Quick Links** - Access running services directly
- ⚡ **Real-time Status** - See which projects are running
- 📁 **Folder Browser** - Set any folder as your models or project directory

## Setup

### Windows 11

**Prerequisites:**
1. [Node.js LTS](https://nodejs.org/) - Download and install

**Steps:**
```bash
# Navigate to launcher directory
cd path\to\launcher

# Install dependencies
npm install

# Start launcher
npm start
```

Open browser to: **http://localhost:5000**

### Linux (Ubuntu/Debian)

**Prerequisites:**
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Or use nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22
```

**Steps:**
```bash
# Navigate to launcher directory
cd path/to/launcher

# Run the setup script (installs dependencies, walks through config)
./setup.sh

# Start launcher
npm start
```

Open browser to: **http://localhost:5000**

## Dependencies

### Required
- **Node.js 18+** - https://nodejs.org/
- **npm** - Comes with Node.js

### Node Packages (auto-installed)
- **Express.js** - Web framework
  - https://www.npmjs.com/package/express
- **Child Process** - For spawning projects
  - Built into Node.js

### Projects (must be installed separately)

1. **Pithagoras** - https://github.com/thecodacus/pithagoras
   - Requires: npm, Node.js 18+

2. **Understory** - https://github.com/thecodacus/understory
   - Requires: pnpm (`npm install -g pnpm`), Node.js 20+

3. **AgentBox** - https://github.com/thecodacus/agentbox
   - Requires: Docker, Node.js 20+
   - Build sandbox images before starting

4. **Llama.cpp** - https://github.com/thecodacus/llama.cpp
   - Built C++ binary (no setup needed if compiled)

## Configuration

### Option 1: Web UI (Recommended)

The web UI provides folder browsers for:
- **Models Directory** — Where to find `.gguf` model files
- **Project Directories** — Where each project (Pithagoras, Understory, AgentBox) lives
- **Add Model Folder** — Add extra folders to scan for models

Settings persist in `launcherConfig.json` and `projectDirs.json`.

### Option 2: `.env` File

Create a `.env` file in the launcher directory:

```env
# Models directory (can also be set via web UI)
MODELS_DIR=/home/user/models

# Project directories (override defaults)
PROJECT_DIR_PITHAGORAS=/home/user/projects/pithagoras
PROJECT_DIR_UNDERSTORY=/home/user/projects/understory
PROJECT_DIR_AGENTBOX=/home/user/projects/agentbox

# Terminal emulator for Pi Coding Agent
# (defaults: ptyxis → gnome-terminal → xdg-open)
LAUNCHER_PI_TERMINAL=gnome-terminal

# Optional: store config files in a different directory
# (useful for portable installs on USB drives)
# LAUNCHER_DIR=/mnt/usb/launcher-config
```

### Option 3: Environment Variables

Set these directly in your shell or system environment:

| Variable | Description | Default |
|----------|-------------|---------|
| `MODELS_DIR` | Default models folder | *(empty — set via UI)* |
| `PROJECT_DIR_PITHAGORAS` | Pithagoras folder | `~/pithagoras` |
| `PROJECT_DIR_UNDERSTORY` | Understory folder | `~/understory` |
| `PROJECT_DIR_AGENTBOX` | AgentBox folder | `~/agentbox/app` |
| `LAUNCHER_PI_TERMINAL` | Terminal for Pi | auto-detect |
| `LAUNCHER_DIR` | Config storage directory | launcher folder |

## Project Directory Resolution

Project directories are resolved in this priority order:

1. **Environment variable** `PROJECT_DIR_<ID>` (highest priority)
2. **Saved override** in `projectDirs.json` (via web UI)
3. **Default relative path** under your home directory
4. **Home directory** itself (for projects without a relative path)

Example: Pithagoras defaults to `~/pithagoras`, but can be overridden to `/opt/pithagoras` via env var or the web UI.

## Usage

1. **Select Model**
   - Choose from dropdown (auto-scans your configured models folder)
   - Supports multi-part GGUF files (shows first part)

2. **Add Flags** (optional)
   - Example: `-ngl 99 --n-cpu-moe 40 -c 65536 -ctk q8_0 -ctv q8_0`
   - Flags auto-pass to llama-server on start

3. **Start Projects**
   - Click "Start" button on any project
   - Status updates in real-time

4. **Access Running Projects**
   - Click "Open" button to access in browser
   - Projects run on default ports (see UI)

## Ports

- **Launcher**: http://localhost:5000
- **Pithagoras**: http://localhost:4100
- **Understory**: http://localhost:3800
- **AgentBox**: http://localhost:3000
- **Llama.cpp Server**: http://localhost:8000

## File Structure

```
launcher/
├── server.js              # Main server (portable — no hardcoded paths)
├── package.json           # Dependencies
├── .env                   # Machine-specific config (gitignored)
├── launcherConfig.json    # General settings (gitignored)
├── projectDirs.json       # Project paths (gitignored)
├── modelFlags.json        # Per-model flags (gitignored)
├── setup.sh               # First-run setup script
└── public/
    └── index.html         # Web UI
```

## Troubleshooting

**"Port already in use"**
- Another project is running on that port
- Kill the process: `lsof -ti:8000 | xargs kill -9` (Linux/Mac)
- Or: `netstat -ano | findstr :8000` (Windows, then Task Manager to kill)

**Models not showing**
- Check your models folder path is correct (set via UI or .env)
- Make sure the folder exists and has read permissions
- Models must be in GGUF format (.gguf files)
- Multi-part models (00001-of-00003) show as single entry

**Launcher won't start**
- Make sure Node.js is installed: `node --version`
- Delete `node_modules` and run `npm install` again

**Projects not found**
- Use the web UI to set each project's directory
- Or set `PROJECT_DIR_<ID>` environment variables
- Or create a `.env` file in the launcher directory

## License

MIT

## Author

Built with Express.js for local AI development stack management.
