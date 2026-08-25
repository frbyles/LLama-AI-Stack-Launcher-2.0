#!/usr/bin/env bash
# =============================================================================
# Project Launcher — portable bootstrap (Linux)
#
# Lives outside the repo (copied next to the .desktop shortcut) so it works
# before the repo's location is known. Responsibilities:
#   1. Remember which folder holds the launcher repo (config file).
#   2. On first run, or if that folder no longer looks right, ask via a
#      native folder picker.
#   3. Run setup.sh if the repo hasn't been set up yet (no node_modules).
#   4. cd into the repo and `npm start`.
#
# Reconfigure: run with --reconfigure to pick a different folder.
# =============================================================================
set -euo pipefail

CONFIG_DIR="$HOME/.config/project-launcher"
CONFIG_FILE="$CONFIG_DIR/config"

is_valid_repo() {
  [ -n "${1:-}" ] && [ -f "$1/server.js" ] && [ -f "$1/package.json" ]
}

pick_folder() {
  local start_dir="${1:-$HOME}"
  local picked=""
  if command -v zenity &>/dev/null; then
    picked=$(zenity --file-selection --directory \
      --title="Select the Project Launcher folder" \
      --filename="$start_dir/" 2>/dev/null) || true
  elif command -v kdialog &>/dev/null; then
    picked=$(kdialog --getexistingdirectory "$start_dir" \
      --title "Select the Project Launcher folder" 2>/dev/null) || true
  fi

  if [ -z "$picked" ]; then
    # Fallback: terminal prompt (no GUI picker available, or it was cancelled)
    read -rp "Enter the path to the Project Launcher folder: " picked
    picked="${picked/#\~/$HOME}"
  fi
  echo "$picked"
}

load_launcher_dir() {
  [ -f "$CONFIG_FILE" ] || return 1
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  [ -n "${LAUNCHER_DIR:-}" ] && echo "$LAUNCHER_DIR"
}

save_launcher_dir() {
  mkdir -p "$CONFIG_DIR"
  printf 'LAUNCHER_DIR=%q\n' "$1" > "$CONFIG_FILE"
}

if [ "${1:-}" = "--reconfigure" ]; then
  rm -f "$CONFIG_FILE"
fi

LAUNCHER_DIR="$(load_launcher_dir || true)"

while ! is_valid_repo "$LAUNCHER_DIR"; do
  if [ -n "$LAUNCHER_DIR" ]; then
    echo "⚠️  '$LAUNCHER_DIR' doesn't look like the launcher repo (missing server.js/package.json)."
  fi
  echo "📂  Please select the Project Launcher folder..."
  LAUNCHER_DIR="$(pick_folder "${LAUNCHER_DIR:-$HOME}")"
done

save_launcher_dir "$LAUNCHER_DIR"
cd "$LAUNCHER_DIR"

if [ ! -d "node_modules" ]; then
  echo "🔧  First run in this folder — running setup..."
  if [ -x "./setup.sh" ]; then
    ./setup.sh
  else
    npm install --production
  fi
fi

echo "🚀  Starting Project Launcher from $LAUNCHER_DIR"
npm start
