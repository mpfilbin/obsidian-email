#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_ID="$(node -p "require('$REPO_ROOT/manifest.json').id")"
VAULT_PATH="${1:-$REPO_ROOT/dev-vault}"

if [ ! -d "$VAULT_PATH" ]; then
  echo "Error: Vault path does not exist: $VAULT_PATH"
  exit 1
fi

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"

echo "→ Building plugin..."
( cd "$REPO_ROOT" && npm run build )

echo "→ Installing to $PLUGIN_DIR..."
mkdir -p "$PLUGIN_DIR"
cp "$REPO_ROOT/main.js" "$REPO_ROOT/manifest.json" "$REPO_ROOT/styles.css" "$PLUGIN_DIR/"

echo "✓ Done. In Obsidian: reload and enable 'Email'."
