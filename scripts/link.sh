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
mkdir -p "$PLUGIN_DIR"

# Ensure a build exists to link to.
[ -f "$REPO_ROOT/main.js" ] || ( cd "$REPO_ROOT" && npm run build )

for f in main.js manifest.json styles.css; do
  ln -sf "$REPO_ROOT/$f" "$PLUGIN_DIR/$f"
done
touch "$PLUGIN_DIR/.hotreload"

echo "✓ Linked $PLUGIN_ID into $VAULT_PATH. Run 'npm run dev' for live rebuilds."
