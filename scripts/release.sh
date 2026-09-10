#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:-}"
if [[ "$BUMP" != "major" && "$BUMP" != "minor" && "$BUMP" != "patch" ]]; then
  echo "Usage: $0 <major|minor|patch>"
  exit 1
fi

npm version "$BUMP" --no-git-tag-version
node version-bump.mjs
npm install

NEW_VERSION=$(node -p "require('./package.json').version")
git add package.json package-lock.json manifest.json versions.json
git commit -m "chore: update version to $NEW_VERSION"
echo "Version bumped to $NEW_VERSION"
