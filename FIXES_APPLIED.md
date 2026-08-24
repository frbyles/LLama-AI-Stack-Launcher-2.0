# Fixes Applied to Launcher

## Bug #1: Models Directory Never Saves ✅ FIXED

**Problem:** The "Models Directory" field reset to empty every time the launcher restarted. Users had to re-select it every run.

**Root Cause:** `modelsDir` was stored as a plain in-memory variable (`let modelsDir = ''`) with no persistence mechanism.

**Solution:**
- Added `launcherConfig.json` for general config persistence
- `modelsDir` is now saved immediately when the user clicks "Set"
- On startup, `modelsDir` is restored from the persisted config before scanning for models
- Frontend updated to load `modelsDir` from the main config endpoint

**Result:** After the first run, the models directory is remembered across restarts.

---

## Bug #2: Pi Can't Communicate After Launch ✅ FIXED

**Problem:** After selecting a model, starting llama.cpp, and launching pi, pi couldn't communicate with the model.

**Root Cause:** The general `config` object (including `selectedModel`, `localModelEndpoint`, `apiKey`, and all flag values) was only stored in memory. On restart, these values reset to defaults, so:
- No model was pre-selected (`selectedModel: null`)
- llama.cpp started without a model to load
- Pi launched but had nothing to communicate with

**Solution:**
- General config is now persisted to `launcherConfig.json` on every change
- `selectedModel` is saved when a model is selected
- All flag values (ngl, nCpuMoe, context, etc.) are saved
- `localModelEndpoint` and `apiKey` are preserved
- On startup, the persisted config is loaded and applied

**Result:** After the first run:
- Selected model is remembered → llama.cpp loads it on start
- All flag values are remembered → correct arguments are passed
- Pi launched after model is loaded can communicate because the model server is actually running

---

## Files Modified

1. **server.js**
   - Added `CONFIG_FILE` constant for `launcherConfig.json`
   - Added `CONFIG_PERSIST_KEYS` whitelist for fields to persist
   - Added `loadLauncherConfig()` and `saveLauncherConfig()` functions
   - Added `ALLOWED_CONFIG_KEYS` for input filtering
   - Updated `set-models-dir` to persist immediately
   - Updated `config` POST to filter and persist
   - Updated `set-model` to persist `selectedModel`
   - Added startup logic to restore `modelsDir` from persisted config

2. **public/index.html**
   - Updated `loadConfig()` to read `modelsDir` from config object
   - Updated "Set" button to post to `/api/config` (which triggers persistence)

3. **BUGFIX_RECORD.md**
   - Documented Bug #3 with full analysis and fix details

---

## Testing

To verify the fixes work:

1. Start the launcher: `cd ~/launcher && npm start`
2. Set a models directory (e.g., `~/models`)
3. Select a model from the dropdown
4. Adjust any flags if needed
5. Save the config
6. Restart the launcher
7. Verify:
   - Models directory is pre-filled
   - Model list loads automatically
   - Previously selected model is still chosen
   - All flag values are preserved

The `launcherConfig.json` file will be created/updated in `~/launcher/` to store the persisted configuration.
