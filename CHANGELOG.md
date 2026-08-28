# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Vision model support (mmproj)** — auto-detects a `mmproj-*.gguf` file next to the selected model and passes it via `--mmproj`; optional `--image-min-tokens` override. Gated by an enable checkbox so a saved path can persist without being active.
- **Speculative decoding** — MTP (self-speculative, `--spec-type draft-mtp`) and classic draft-model speculation (`-md`), each with their own auto-detected sidecar (`mtp-*.gguf` / `draft-*.gguf`). Only one mode can be active at a time; MTP takes priority if both are checked. Shared `--spec-draft-n-max` control.
- **Chat template override** — point at a `.jinja` file to replace a GGUF's embedded chat template (for models with known-buggy embedded templates).
- **`presence-penalty` sampling control**, alongside the existing repeat/min-p penalties.
- **`GET /api/model-companions`** — scans a model's folder for mmproj/mtp/draft companion GGUFs and a `.jinja` template so the UI can auto-populate the new fields on model selection.
- **Blender MCP and Unity MCP** entries in the MCP server list (`blender-mcp`, `unity-mcp` via `uvx`). Both require their companion in-app bridge (Blender addon / Unity package) running separately — the launcher can't start that side.
- **Web Search MCP** (`open-websearch`) as a launchable project on port 3900, since nothing was previously running to back that MCP entry.

### Fixed
- Windows startup failure: `llamacpp.cmd` used a Unix-style path (`./build/bin/llama-server`) with `shell: true` forced for all projects, so `cmd.exe` couldn't parse it. Corrected to `.\build\bin\Release\llama-server.exe` (also fixed the missing `Release\` and `.exe`).
- VRAM stat display and general UI cleanup (see `edccb58`).

### Known issues
- `launcherConfig.json`'s `host` field can revert to a stale value because the browser tab's host input re-saves on its ~2s autosave tick, overwriting direct file edits until the page is hard-refreshed.
