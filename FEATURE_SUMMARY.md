# Project Folder Browse Feature

## Overview
Added browse folder functionality for **Pithagoras**, **Understory**, **AgentBox**, and **Pi Coding Agent** projects. Users can now select project directories via a visual folder browser, and these selections are persisted across restarts.

## Features Implemented

### 1. Backend API Endpoints
- `POST /api/set-project-dir` - Set a project directory (persisted to projectDirs.json)
- `POST /api/reset-project-dir` - Reset a project directory to default
- `GET /api/project-dirs` - Get all persisted project directories
- `GET /api/browse?path=` - List subdirectories (enhanced to support project browsing)

### 2. Persistent Storage
- **File**: `projectDirs.json` in the launcher directory
- **Format**: `{ "projectId": "/path/to/dir", ... }`
- **Behavior**: 
  - First run: Uses default paths from `projectConfigs`
  - After selection: Saves to `projectDirs.json`
  - Subsequent runs: Loads from `projectDirs.json`
  - Reset: Removes entry, returns to default

### 3. Frontend UI
- **Browse Button**: 📂 icon next to each project's directory
- **Folder Browser Modal**: Reusable modal for both model and project folder selection
- **Dynamic Button Text**: Changes based on context:
  - Model folder: "Select This Folder"
  - Project folder: "Set Project Folder"

### 4. Cross-Platform Support
- Uses `os.homedir()` for default browse path
- Works on any Linux/PC with the same codebase
- Server-side path resolution ensures correct absolute paths

## Projects Supported

| Project ID | Default Directory | Command |
|------------|-------------------|---------|
| pithagoras | `~/pithagoras` | `npm run dev:server` |
| understory | `~/understory` | `pnpm dev` |
| agentbox | `~/agentbox/app` | `npm run dev` |
| pi | `~` | `ptyxis --new-window -- bash -lc pi` |

## Usage

### Setting a Project Directory
1. Click the 📂 button next to a project's directory
2. Navigate to the desired folder
3. Click "Set Project Folder"
4. Directory is saved and persists across restarts

### Resetting to Default
1. Call `POST /api/reset-project-dir` with `projectId`
2. Directory reverts to the hardcoded default

### API Example
```bash
# Set directory
curl -X POST http://localhost:5000/api/set-project-dir \
  -H "Content-Type: application/json" \
  -d '{"projectId":"pithagoras","dir":"/opt/pithagoras"}'

# Check saved directories
curl http://localhost:5000/api/project-dirs

# Reset to default
curl -X POST http://localhost:5000/api/reset-project-dir \
  -H "Content-Type: application/json" \
  -d '{"projectId":"pithagoras"}'
```

## Files Modified

### Backend (server.js)
- Added `PROJECT_DIRS_FILE` constant
- Added `loadProjectDirs()` and `saveProjectDirs()` functions
- Added `getProject()` helper to resolve directory from saved state
- Added API endpoints for setting/resetting/getting project directories
- Updated `/api/projects` to include `savedDir` field

### Frontend (public/index.html)
- Added `.btn-browse-dir` CSS styles
- Added browse button to project card HTML
- Added `openProjectFolderBrowser()` function
- Modified folder browser to support both model and project contexts
- Added `currentBrowseTarget` state variable

### New Files
- `projectDirs.json` - Persists user-selected directories (created on first save)

## Testing

The feature has been tested with:
1. ✅ Setting project directories via API
2. ✅ Persisting to projectDirs.json
3. ✅ Loading persisted directories on restart
4. ✅ Resetting directories to defaults
5. ✅ Folder browser modal navigation
6. ✅ Cross-platform path handling (os.homedir)

## Benefits

1. **User-Friendly**: Visual folder browser instead of manual path entry
2. **Persistent**: Settings survive restarts
3. **Flexible**: Users can change directories anytime
4. **Portable**: Works on any Linux/PC without code changes
5. **Safe**: Validates directory existence before saving
