# Obsidian Email Plugin — Foundation + Reading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Sub-project 1 of the Obsidian email plugin — a desktop-only plugin that authenticates Gmail and Microsoft 365 accounts, syncs mail into a local cache, and renders it in a dedicated mail-client view with server-side search.

**Architecture:** A provider-adapter layer normalizes Gmail REST and Microsoft Graph into common domain models. A sync engine polls providers incrementally and writes normalized records to an IndexedDB cache, emitting change events. A Svelte 5 view reads only from a `view-model` that bridges cache + sync + provider read-through calls. OAuth uses a PKCE loopback flow; refresh tokens live in Obsidian's `app.secretStorage`.

**Tech Stack:** TypeScript (strict), Svelte 5 (runes), esbuild + esbuild-svelte, Obsidian plugin API ≥ 1.11.4, `idb` (IndexedDB), `dompurify`, Vitest + jsdom + `fake-indexeddb`, Node `http`/Web Crypto for OAuth, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-obsidian-email-foundation-design.md`

## Global Constraints

- **Platform:** desktop-only. `manifest.json` `isDesktopOnly: true`. No mobile code paths.
- **Minimum Obsidian version:** `minAppVersion: "1.11.4"` (the release that finalized `app.secretStorage`).
- **Plugin identity:** `manifest.json` `id: "obsidian-email"`, `name: "Email"`, `author: "Michael Filbin"`. Scripts read the id from `manifest.json`; never hardcode it elsewhere.
- **Credentials never touch `data.json`.** Refresh tokens and the Google client secret go through `app.secretStorage` only. `data.json` holds account metadata (`id`, `email`, `provider`, `clientId`, `addedAt`) and prefs.
- **No network in tests.** `requestUrl` and `http` are mocked. No test hits a real provider.
- **No telemetry / no external calls** except the two provider APIs and user-initiated `shell.openExternal` link opens.
- **Delete = move to Trash** semantics only (and no mutations at all in SP1 — read-only). No permanent delete.
- **esbuild externals:** `["obsidian", "electron", "@codemirror/*"]`. Output `main.js` (CJS) at repo root.
- **Commit style:** end commit messages with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Conventional-commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).
- **TDD:** every behavioral unit gets a failing test first. Commit after each green step group.
- **Secrets namespace:** `app.secretStorage` keys are `obsidian-email-<accountId>:refresh` and `obsidian-email-<accountId>:secret`.

---

## File Structure

**Scaffold / config**
- `package.json` — scripts + deps
- `tsconfig.json` — strict TS, Svelte, node types
- `esbuild.config.mjs` — bundler config
- `manifest.json`, `versions.json` — Obsidian plugin metadata
- `vitest.config.ts`, `tests/setup.ts` — test runner + `fake-indexeddb` + jsdom globals
- `.gitignore`, `LICENSE.md`, `README.md`
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- `scripts/release.sh`, `version-bump.mjs`
- `scripts/install.sh`, `scripts/uninstall.sh`, `scripts/link.sh`
- `dev-vault/.obsidian/{community-plugins,core-plugins,app}.json`, `dev-vault/README.md`
- `styles.css`

**`src/util/`** — leaf utilities, no plugin deps
- `result.ts` — `Result<T,E>` type + helpers
- `logger.ts` — leveled logger gated by a debug flag
- `backoff.ts` — retry/backoff for HTTP 429/503

**`src/providers/`** — provider abstraction
- `types.ts` — domain models + `MailProvider` interface + error types
- `fake-provider.ts` — in-memory `MailProvider` for tests
- `provider-contract.ts` — shared contract test suite (exported fn)
- `gmail/gmail-mappers.ts` — Gmail JSON → domain models
- `gmail/gmail-provider.ts` — Gmail `MailProvider` impl
- `ms-graph/graph-mappers.ts` — Graph JSON → domain models
- `ms-graph/graph-provider.ts` — Graph `MailProvider` impl
- `provider-factory.ts` — `(AccountConfig, TokenManager) → MailProvider`

**`src/auth/`**
- `pkce.ts` — code verifier/challenge/state generation
- `provider-oauth-config.ts` — endpoints + scopes per provider
- `oauth-client.ts` — build authorize URL, exchange code, orchestrate flow
- `loopback-server.ts` — one-shot `127.0.0.1`/`localhost` HTTP listener
- `token-manager.ts` — secretStorage + access-token refresh

**`src/cache/`**
- `schema.ts` — store names, types, retention constants, `openMailDb`
- `mail-cache.ts` — typed queries + writes over the db
- `cursor-store.ts` — sync-cursor persistence (wraps `mail-cache` `cursors` store)

**`src/sync/`**
- `emitter.ts` — tiny typed event emitter
- `sync-engine.ts` — per-account backfill/incremental + scheduler

**`src/settings/`**
- `settings-store.ts` — `PluginSettings` shape + load/save + account CRUD
- `settings-tab.ts` — `PluginSettingTab` UI

**`src/render/`**
- `html-sanitizer.ts` — DOMPurify config + remote-content stripping
- `message-renderer.ts` — mount sanitized HTML, image-gate, `cid:` resolution

**`src/view/`**
- `view-model.ts` — stores + actions bridging cache/sync/providers
- `mail-view.ts` — `ItemView` host, mounts Svelte
- `App.svelte` — 4-column layout shell
- `components/AccountSwitcher.svelte`
- `components/MailboxList.svelte`
- `components/MessageList.svelte`
- `components/ThreadRow.svelte`
- `components/ReadingPane.svelte`
- `components/MessageBlock.svelte`
- `components/SearchBar.svelte`

**`src/`**
- `main.ts` — plugin entry: lifecycle, view + command + ribbon registration, scheduler wiring

**`tests/`** mirrors `src/`; fixtures in `tests/fixtures/{gmail,graph}/`.

---

## Task 1: Project scaffold, build, CI & release tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `manifest.json`, `versions.json`, `styles.css`, `.gitignore`, `LICENSE.md`
- Create: `vitest.config.ts`, `tests/setup.ts`
- Create: `src/main.ts` (minimal stub)
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Create: `scripts/release.sh`, `version-bump.mjs`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run build` → `main.js`; `npm test` → vitest; `npm run typecheck`. A default-exported `class EmailPlugin extends Plugin` in `src/main.ts` (later tasks add to it).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "obsidian-email",
  "version": "0.1.0",
  "private": true,
  "description": "A full email client for Gmail and Microsoft 365 inside Obsidian.",
  "license": "MIT",
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run",
    "typecheck": "tsc -noEmit -skipLibCheck",
    "release": "bash scripts/release.sh"
  },
  "devDependencies": {
    "@tsconfig/svelte": "^5.0.4",
    "@types/node": "^20.14.0",
    "esbuild": "^0.21.5",
    "esbuild-svelte": "^0.8.2",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^24.1.0",
    "obsidian": "^1.11.4",
    "svelte": "^5.0.0",
    "tslib": "^2.6.3",
    "typescript": "^5.5.2",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "dompurify": "^3.1.6",
    "idb": "^8.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "strict": true,
    "noImplicitAny": true,
    "skipLibCheck": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"]
}
```

- [ ] **Step 3: Write `esbuild.config.mjs`**

```js
import esbuild from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import process from "process";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  plugins: [esbuildSvelte({ compilerOptions: { css: "injected" } })],
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

- [ ] **Step 4: Write `manifest.json` and `versions.json`**

`manifest.json`:
```json
{
	"id": "obsidian-email",
	"name": "Email",
	"version": "0.1.0",
	"minAppVersion": "1.11.4",
	"description": "A full email client for Gmail and Microsoft 365 inside Obsidian.",
	"author": "Michael Filbin",
	"isDesktopOnly": true
}
```

`versions.json`:
```json
{
	"0.1.0": "1.11.4"
}
```

- [ ] **Step 5: Write `styles.css` (placeholder), `.gitignore`, `LICENSE.md`**

`styles.css`:
```css
/* Obsidian Email plugin styles. Populated by later tasks. */
.obsidian-email-view { height: 100%; }
```

`.gitignore`:
```
/.idea/
node_modules/
main.js
*.js.map
.DS_Store
dev-vault/.obsidian/plugins/
dev-vault/.obsidian/workspace.json
dev-vault/.obsidian/workspace-mobile.json
dev-vault/.obsidian/hotkeys.json
dev-vault/*.md
```

`LICENSE.md`: standard MIT text, copyright `2026 Michael Filbin`.

- [ ] **Step 6: Write `src/main.ts` stub**

```ts
import { Plugin } from "obsidian";

export default class EmailPlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("obsidian-email loaded");
  }

  onunload(): void {
    console.log("obsidian-email unloaded");
  }
}
```

- [ ] **Step 7: Write `vitest.config.ts` and `tests/setup.ts`**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
```

`tests/setup.ts`:
```ts
import "fake-indexeddb/auto";
```

- [ ] **Step 8: Write the smoke test**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("has indexedDB available in the test env", () => {
    expect(typeof indexedDB).toBe("object");
  });
});
```

- [ ] **Step 9: Install deps and run the smoke test**

Run: `npm install && npm test`
Expected: PASS (1 test).

- [ ] **Step 10: Verify the build**

Run: `npm run build`
Expected: `main.js` created at repo root, no type errors.

- [ ] **Step 11: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: ['**']

jobs:
  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run test

  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
```

- [ ] **Step 12: Write `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    branches: [master, main]
    paths: [manifest.json]

jobs:
  release:
    name: Build and release
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - name: Read version from manifest
        id: version
        run: echo "version=$(node -p "require('./manifest.json').version")" >> $GITHUB_OUTPUT
      - name: Build plugin
        run: npm run build
      - name: Create GitHub release
        run: |
          if gh release view "${{ steps.version.outputs.version }}" > /dev/null 2>&1; then
            echo "Release ${{ steps.version.outputs.version }} already exists, skipping."
          else
            gh release create "${{ steps.version.outputs.version }}" \
              main.js manifest.json styles.css \
              --title "${{ steps.version.outputs.version }}" \
              --generate-notes
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 13: Write `version-bump.mjs` and `scripts/release.sh`**

`version-bump.mjs`:
```js
import { readFileSync, writeFileSync } from "fs";

const { version: targetVersion } = JSON.parse(readFileSync("package.json", "utf8"));

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
```

`scripts/release.sh`:
```bash
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
```

Then `chmod +x scripts/release.sh`.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "chore: scaffold plugin, build, CI and release tooling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Dev vault & install scripts

**Files:**
- Create: `dev-vault/.obsidian/community-plugins.json`, `dev-vault/.obsidian/core-plugins.json`, `dev-vault/.obsidian/app.json`
- Create: `dev-vault/README.md`
- Create: `scripts/install.sh`, `scripts/uninstall.sh`, `scripts/link.sh`
- Test: `tests/scripts.test.ts`

**Interfaces:**
- Consumes: `manifest.json` `id` (Task 1).
- Produces: `./scripts/install.sh` (copy build into a vault), `./scripts/link.sh` (symlink build + write `.hotreload`), `./scripts/uninstall.sh`. All default the vault arg to `./dev-vault`.

- [ ] **Step 1: Create the dev-vault skeleton**

`dev-vault/.obsidian/community-plugins.json`:
```json
["obsidian-email"]
```

`dev-vault/.obsidian/core-plugins.json`:
```json
{
  "file-explorer": true,
  "command-palette": true,
  "editor-status": true
}
```

`dev-vault/.obsidian/app.json`:
```json
{ "promptDelete": false }
```

`dev-vault/README.md`:
```markdown
# Email plugin dev vault

Open this folder as a vault in Obsidian to test the plugin.

## First-time setup
1. From the repo root: `npm install`
2. Install the Hot Reload plugin for live reload:
   `git clone https://github.com/pjeby/hot-reload dev-vault/.obsidian/plugins/hot-reload`
3. `./scripts/link.sh`
4. Open `dev-vault/` in Obsidian → enable **Email** and **Hot Reload**.
5. `npm run dev` — edits rebuild `main.js`; Hot Reload reloads the plugin.
   (Without Hot Reload, press Cmd/Ctrl+R in Obsidian after a rebuild.)

## Test checklist (SP1)
- Add a Gmail account via Settings → Email → Add account.
- Add a Microsoft 365 account.
- Inbox lists messages; opening one shows the sanitized body.
- Remote images are blocked until "Load remote images" is clicked.
- Search returns server results; clearing restores the list.
- Restarting Obsidian keeps accounts and shows cached mail immediately.
```

- [ ] **Step 2: Write `scripts/install.sh`**

```bash
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
```

- [ ] **Step 3: Write `scripts/link.sh`**

```bash
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
```

- [ ] **Step 4: Write `scripts/uninstall.sh`**

Port `ribbon-bar`'s `scripts/uninstall.sh` verbatim, with two changes: derive `PLUGIN_ID` via `node -p "require('$REPO_ROOT/manifest.json').id"` and set `VAULT_PATH="${1:-$REPO_ROOT/dev-vault}"`. It removes `$PLUGIN_DIR` and filters the id out of `community-plugins.json`.

- [ ] **Step 5: `chmod +x` the scripts**

Run: `chmod +x scripts/install.sh scripts/link.sh scripts/uninstall.sh`

- [ ] **Step 6: Write a test that the scripts are valid bash and wired to the manifest id**

`tests/scripts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const scripts = ["install.sh", "uninstall.sh", "link.sh"];

describe("scripts", () => {
  it.each(scripts)("%s parses as valid bash", (s) => {
    expect(() => execFileSync("bash", ["-n", `scripts/${s}`])).not.toThrow();
  });

  it.each(scripts)("%s does not hardcode the plugin id", (s) => {
    const body = readFileSync(`scripts/${s}`, "utf8");
    expect(body).toContain("manifest.json').id");
    expect(body).not.toMatch(/plugins\/obsidian-email/);
  });
});
```

- [ ] **Step 7: Run the test**

Run: `npm test -- scripts`
Expected: PASS.

- [ ] **Step 8: Manually verify install into the dev vault**

Run: `./scripts/link.sh && ls -l dev-vault/.obsidian/plugins/obsidian-email/`
Expected: three symlinks + `.hotreload`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: add dev vault and install/link/uninstall scripts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `util/result.ts` and `util/logger.ts`

**Files:**
- Create: `src/util/result.ts`, `src/util/logger.ts`
- Test: `tests/util/result.test.ts`, `tests/util/logger.test.ts`

**Interfaces:**
- Produces:
  - `type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }`
  - `ok<T>(value: T): Result<T, never>`
  - `err<E>(error: E): Result<never, E>`
  - `isOk` / `isErr` type guards
  - `class Logger { constructor(scope: string, opts: { debug: () => boolean }); debug(msg: string, ...a: unknown[]): void; info(...): void; warn(...): void; error(...): void }`

- [ ] **Step 1: Write failing tests for `Result`**

`tests/util/result.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr } from "../../src/util/result";

describe("Result", () => {
  it("ok wraps a value", () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err wraps an error", () => {
    const r = err(new Error("boom"));
    expect(isErr(r)).toBe(true);
    if (!r.ok) expect(r.error.message).toBe("boom");
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

Run: `npm test -- util/result`

- [ ] **Step 3: Implement `src/util/result.ts`**

```ts
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- util/result`

- [ ] **Step 5: Write failing test for `Logger`**

`tests/util/logger.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { Logger } from "../../src/util/logger";

describe("Logger", () => {
  it("suppresses debug when the debug flag is false", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    new Logger("test", { debug: () => false }).debug("hidden");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("emits debug when the flag is true, prefixed with scope", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    new Logger("auth", { debug: () => true }).debug("hello");
    expect(spy).toHaveBeenCalledWith("[obsidian-email-auth] hello");
    spy.mockRestore();
  });

  it("always emits warn and error", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    new Logger("x", { debug: () => false }).warn("careful");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 6: Run — expect FAIL**

- [ ] **Step 7: Implement `src/util/logger.ts`**

```ts
type Level = "debug" | "info" | "warn" | "error";

export class Logger {
  constructor(
    private scope: string,
    private opts: { debug: () => boolean },
  ) {}

  private prefix(): string {
    return `[obsidian-email-${this.scope}]`;
  }

  private emit(level: Level, msg: string, args: unknown[]): void {
    if (level === "debug" && !this.opts.debug()) return;
    // eslint-disable-next-line no-console
    console[level](`${this.prefix()} ${msg}`, ...args);
  }

  debug(msg: string, ...args: unknown[]): void { this.emit("debug", msg, args); }
  info(msg: string, ...args: unknown[]): void { this.emit("info", msg, args); }
  warn(msg: string, ...args: unknown[]): void { this.emit("warn", msg, args); }
  error(msg: string, ...args: unknown[]): void { this.emit("error", msg, args); }
}
```

Note: `console[level](fmt, ...args)` called with zero extra args must still match the test's `toHaveBeenCalledWith("[obsidian-email-auth] hello")` — `vi` treats trailing spread of `[]` as no args, so this passes.

- [ ] **Step 8: Run — expect PASS**

- [ ] **Step 9: Commit**

```bash
git add src/util/result.ts src/util/logger.ts tests/util/
git commit -m "feat: add Result type and scoped Logger

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `util/backoff.ts`

**Files:**
- Create: `src/util/backoff.ts`
- Test: `tests/util/backoff.test.ts`

**Interfaces:**
- Produces:
  - `interface RetryOptions { retries: number; baseMs: number; maxMs: number; jitter?: () => number }`
  - `async function withRetry<T>(fn: () => Promise<RetryableResult<T>>, opts: RetryOptions, sleep?: (ms: number) => Promise<void>): Promise<T>`
  - `type RetryableResult<T> = { retry: false; value: T } | { retry: true; afterMs?: number; error: Error }`
  - `function parseRetryAfter(headerValue: string | undefined, nowMs: number): number | undefined` (seconds or HTTP-date → ms)

- [ ] **Step 1: Write failing tests**

`tests/util/backoff.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { withRetry, parseRetryAfter } from "../../src/util/backoff";

const noSleep = () => Promise.resolve();

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("120", 0)).toBe(120_000);
  });
  it("parses an HTTP date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
  });
  it("returns undefined for garbage", () => {
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
    expect(parseRetryAfter(undefined, 0)).toBeUndefined();
  });
});

describe("withRetry", () => {
  it("returns immediately on retry:false", async () => {
    const fn = vi.fn().mockResolvedValue({ retry: false, value: 7 });
    await expect(withRetry(fn, { retries: 3, baseMs: 1, maxMs: 10 }, noSleep)).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries then succeeds", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ retry: true, error: new Error("429") })
      .mockResolvedValueOnce({ retry: false, value: "ok" });
    await expect(withRetry(fn, { retries: 3, baseMs: 1, maxMs: 10, jitter: () => 0 }, noSleep)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after exhausting retries", async () => {
    const fn = vi.fn().mockResolvedValue({ retry: true, error: new Error("still 503") });
    await expect(withRetry(fn, { retries: 2, baseMs: 1, maxMs: 10, jitter: () => 0 }, noSleep))
      .rejects.toTHROW(/still 503/i);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
```

(Fix the typo `toTHROW` → `toThrow` when writing the file.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/util/backoff.ts`**

```ts
export type RetryableResult<T> =
  | { retry: false; value: T }
  | { retry: true; afterMs?: number; error: Error };

export interface RetryOptions {
  retries: number;
  baseMs: number;
  maxMs: number;
  jitter?: () => number; // 0..1, default Math.random
}

export function parseRetryAfter(
  headerValue: string | undefined,
  nowMs: number,
): number | undefined {
  if (!headerValue) return undefined;
  const secs = Number(headerValue);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(headerValue);
  if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  return undefined;
}

export async function withRetry<T>(
  fn: () => Promise<RetryableResult<T>>,
  opts: RetryOptions,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  const jitter = opts.jitter ?? Math.random;
  let lastError = new Error("withRetry: no attempts made");
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const result = await fn();
    if (!result.retry) return result.value;
    lastError = result.error;
    if (attempt === opts.retries) break;
    const expo = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
    const delay = result.afterMs ?? expo * (0.5 + 0.5 * jitter());
    await sleep(delay);
  }
  throw lastError;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/util/backoff.ts tests/util/backoff.test.ts
git commit -m "feat: add withRetry and Retry-After parsing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `providers/types.ts` — domain models, `MailProvider`, errors

**Files:**
- Create: `src/providers/types.ts`
- Test: `tests/providers/types.test.ts` (compile-time shape assertions only)

**Interfaces:**
- Produces the exported types below. Every later provider/cache/view task imports from here.

- [ ] **Step 1: Write `src/providers/types.ts`**

```ts
export type ProviderKind = "gmail" | "ms-graph";

export interface Address {
  name?: string;
  email: string;
}

export type MailboxKind =
  | "inbox" | "sent" | "drafts" | "archive" | "trash" | "spam" | "custom";

export interface Mailbox {
  id: string;
  name: string;
  kind: MailboxKind;
  unreadCount?: number;
}

export interface MessageSummary {
  id: string;
  threadId: string;
  mailboxIds: string[];
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  snippet: string;
  date: number; // epoch ms
  unread: boolean;
  hasAttachments: boolean;
  flagged: boolean;
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
  contentId?: string;
}

export interface MessageBody {
  id: string;
  html: string | null;
  text: string | null;
  attachments: AttachmentMeta[];
  headers: Record<string, string>;
}

export interface Page<T> {
  items: T[];
  nextPageToken?: string;
}

export type SyncCursor =
  | { kind: "gmail"; historyId: string }
  | { kind: "ms-graph"; deltaLinks: Record<string, string> };

export interface SyncResult {
  upserts: MessageSummary[];
  deletions: string[];
  mailboxChanges: Mailbox[];
  cursor: SyncCursor;
}

export interface MailProvider {
  readonly kind: ProviderKind;
  listMailboxes(): Promise<Mailbox[]>;
  listMessages(mailboxId: string, pageToken?: string): Promise<Page<MessageSummary>>;
  getMessageBody(id: string): Promise<MessageBody>;
  getAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer>;
  search(query: string, pageToken?: string): Promise<Page<MessageSummary>>;
  initialCursor(): Promise<SyncCursor>;
  syncSince(cursor: SyncCursor): Promise<SyncResult>;
}

/** Thrown when the account must re-authenticate (refresh failed / revoked). */
export class AuthError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AuthError";
  }
}

/** Thrown for transient provider/network failures worth retrying later. */
export class ProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}
```

- [ ] **Step 2: Write a compile assertion test**

`tests/providers/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { AuthError, ProviderError } from "../../src/providers/types";
import type { MessageSummary, SyncCursor } from "../../src/providers/types";

describe("types", () => {
  it("AuthError and ProviderError carry their fields", () => {
    expect(new AuthError("x").name).toBe("AuthError");
    const p = new ProviderError("y", 503, true);
    expect(p.status).toBe(503);
    expect(p.retryable).toBe(true);
  });

  it("SyncCursor discriminates on kind", () => {
    const c: SyncCursor = { kind: "gmail", historyId: "1" };
    expect(c.kind === "gmail" && c.historyId).toBe("1");
  });

  it("MessageSummary is structurally usable", () => {
    const m: MessageSummary = {
      id: "1", threadId: "t1", mailboxIds: ["INBOX"],
      from: { email: "a@b.com" }, to: [], cc: [],
      subject: "hi", snippet: "...", date: 0,
      unread: true, hasAttachments: false, flagged: false,
    };
    expect(m.id).toBe("1");
  });
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `npm test -- providers/types`

- [ ] **Step 4: Commit**

```bash
git add src/providers/types.ts tests/providers/types.test.ts
git commit -m "feat: add provider domain models and MailProvider interface

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `providers/fake-provider.ts` and the shared contract suite

**Files:**
- Create: `src/providers/fake-provider.ts`, `src/providers/provider-contract.ts`
- Test: `tests/providers/fake-provider.test.ts`

**Interfaces:**
- Consumes: `MailProvider` and models (Task 5).
- Produces:
  - `class FakeProvider implements MailProvider` with seed helpers: `constructor(seed?: { mailboxes?: Mailbox[]; messages?: MessageSummary[]; bodies?: Record<string, MessageBody> })`, `addMessage(m: MessageSummary)`, `removeMessage(id: string)`, `setSearchResults(q: string, items: MessageSummary[])`, `pageSize` (default 2).
  - `function runMailProviderContract(name: string, makeProvider: () => Promise<{ provider: MailProvider; seedInbox: (n: number) => Promise<string[]> }>): void` — a Vitest `describe` block asserting pagination, `syncSince` upsert/deletion, cursor round-trip. Real adapters call this in their own tests.

- [ ] **Step 1: Write `tests/providers/fake-provider.test.ts` (failing)**

```ts
import { describe } from "vitest";
import { FakeProvider } from "../../src/providers/fake-provider";
import { runMailProviderContract } from "../../src/providers/provider-contract";

runMailProviderContract("FakeProvider", async () => {
  const provider = new FakeProvider({
    mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }],
  });
  provider.pageSize = 2;
  let n = 0;
  const seedInbox = async (count: number) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `m${++n}`;
      provider.addMessage({
        id, threadId: id, mailboxIds: ["INBOX"],
        from: { email: "s@x.com" }, to: [], cc: [],
        subject: `msg ${id}`, snippet: "", date: n * 1000,
        unread: true, hasAttachments: false, flagged: false,
      });
      ids.push(id);
    }
    return ids;
  };
  return { provider, seedInbox };
});
```

- [ ] **Step 2: Run — expect FAIL (modules missing)**

- [ ] **Step 3: Implement `src/providers/provider-contract.ts`**

```ts
import { describe, it, expect } from "vitest";
import type { MailProvider, MessageSummary } from "./types";

export function runMailProviderContract(
  name: string,
  makeProvider: () => Promise<{
    provider: MailProvider;
    seedInbox: (n: number) => Promise<string[]>;
  }>,
): void {
  describe(`${name} — MailProvider contract`, () => {
    it("paginates listMessages", async () => {
      const { provider, seedInbox } = await makeProvider();
      await seedInbox(5);
      const first = await provider.listMessages("INBOX");
      expect(first.items.length).toBeGreaterThan(0);
      let count = first.items.length;
      let token = first.nextPageToken;
      const seen = new Set(first.items.map((m) => m.id));
      while (token) {
        const next = await provider.listMessages("INBOX", token);
        next.items.forEach((m) => seen.add(m.id));
        count += next.items.length;
        token = next.nextPageToken;
      }
      expect(seen.size).toBe(5);
    });

    it("round-trips a cursor and reports upserts", async () => {
      const { provider, seedInbox } = await makeProvider();
      await seedInbox(1);
      const cursor = await provider.initialCursor();
      const added = await seedInbox(2);
      const result = await provider.syncSince(cursor);
      const upsertIds = result.upserts.map((m: MessageSummary) => m.id);
      added.forEach((id) => expect(upsertIds).toContain(id));
      expect(result.cursor).toBeTruthy();
    });

    it("reports deletions in syncSince", async () => {
      const { provider, seedInbox } = await makeProvider();
      const ids = await seedInbox(2);
      const cursor = await provider.initialCursor();
      // deletion is provider-specific; the fake removes, real adapters
      // simulate via mocked history/delta fixtures in their own tests.
      if ("removeMessage" in provider) {
        (provider as unknown as { removeMessage: (id: string) => void })
          .removeMessage(ids[0]);
        const result = await provider.syncSince(cursor);
        expect(result.deletions).toContain(ids[0]);
      }
    });
  });
}
```

- [ ] **Step 4: Implement `src/providers/fake-provider.ts`**

```ts
import type {
  MailProvider, Mailbox, MessageBody, MessageSummary, Page, SyncCursor, SyncResult,
} from "./types";

interface Seed {
  mailboxes?: Mailbox[];
  messages?: MessageSummary[];
  bodies?: Record<string, MessageBody>;
}

export class FakeProvider implements MailProvider {
  readonly kind = "gmail" as const;
  pageSize = 2;

  private mailboxes: Mailbox[];
  private messages = new Map<string, MessageSummary>();
  private bodies: Record<string, MessageBody>;
  private searchResults = new Map<string, MessageSummary[]>();
  private seq = 0;
  private log: Array<{ seq: number; type: "upsert" | "delete"; msg?: MessageSummary; id?: string }> = [];

  constructor(seed: Seed = {}) {
    this.mailboxes = seed.mailboxes ?? [];
    this.bodies = seed.bodies ?? {};
    (seed.messages ?? []).forEach((m) => this.addMessage(m));
  }

  addMessage(m: MessageSummary): void {
    this.messages.set(m.id, m);
    this.log.push({ seq: ++this.seq, type: "upsert", msg: m });
  }

  removeMessage(id: string): void {
    this.messages.delete(id);
    this.log.push({ seq: ++this.seq, type: "delete", id });
  }

  setSearchResults(q: string, items: MessageSummary[]): void {
    this.searchResults.set(q, items);
  }

  async listMailboxes(): Promise<Mailbox[]> {
    return [...this.mailboxes];
  }

  async listMessages(mailboxId: string, pageToken?: string): Promise<Page<MessageSummary>> {
    const all = [...this.messages.values()]
      .filter((m) => m.mailboxIds.includes(mailboxId))
      .sort((a, b) => b.date - a.date);
    const start = pageToken ? Number(pageToken) : 0;
    const items = all.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return { items, nextPageToken: next < all.length ? String(next) : undefined };
  }

  async getMessageBody(id: string): Promise<MessageBody> {
    return this.bodies[id] ?? { id, html: null, text: `body ${id}`, attachments: [], headers: {} };
  }

  async getAttachment(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  async search(query: string, pageToken?: string): Promise<Page<MessageSummary>> {
    const all = this.searchResults.get(query) ?? [];
    const start = pageToken ? Number(pageToken) : 0;
    const items = all.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return { items, nextPageToken: next < all.length ? String(next) : undefined };
  }

  async initialCursor(): Promise<SyncCursor> {
    return { kind: "gmail", historyId: String(this.seq) };
  }

  async syncSince(cursor: SyncCursor): Promise<SyncResult> {
    const since = cursor.kind === "gmail" ? Number(cursor.historyId) : 0;
    const upserts: MessageSummary[] = [];
    const deletions: string[] = [];
    for (const entry of this.log) {
      if (entry.seq <= since) continue;
      if (entry.type === "upsert" && entry.msg) upserts.push(entry.msg);
      if (entry.type === "delete" && entry.id) deletions.push(entry.id);
    }
    return {
      upserts, deletions, mailboxChanges: [],
      cursor: { kind: "gmail", historyId: String(this.seq) },
    };
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- providers/fake-provider`

- [ ] **Step 6: Commit**

```bash
git add src/providers/fake-provider.ts src/providers/provider-contract.ts tests/providers/fake-provider.test.ts
git commit -m "test: add FakeProvider and shared MailProvider contract suite

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `auth/pkce.ts`

**Files:**
- Create: `src/auth/pkce.ts`
- Test: `tests/auth/pkce.test.ts`

**Interfaces:**
- Produces:
  - `function randomUrlSafe(bytes: number): string` — base64url of N random bytes
  - `async function pkceChallenge(verifier: string): Promise<string>` — base64url(SHA-256(verifier))
  - `function newPkcePair(): Promise<{ verifier: string; challenge: string }>`
  - `function newState(): string`
  - Uses global `crypto` (Web Crypto — present in Electron renderer and jsdom ≥ 24 via Node).

- [ ] **Step 1: Write failing tests**

`tests/auth/pkce.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { randomUrlSafe, pkceChallenge, newPkcePair, newState } from "../../src/auth/pkce";

describe("pkce", () => {
  it("randomUrlSafe returns url-safe chars only and varies", () => {
    const a = randomUrlSafe(32);
    const b = randomUrlSafe(32);
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("pkceChallenge matches the RFC 7636 test vector", async () => {
    // RFC 7636 Appendix B
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await pkceChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("newPkcePair produces a verifier whose challenge is reproducible", async () => {
    const { verifier, challenge } = await newPkcePair();
    expect(await pkceChallenge(verifier)).toBe(challenge);
  });

  it("newState is url-safe and long", () => {
    expect(newState()).toMatch(/^[A-Za-z0-9\-_]{22,}$/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/auth/pkce.ts`**

```ts
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomUrlSafe(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toBase64Url(buf);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(digest));
}

export async function newPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlSafe(32); // 43 chars, within RFC 7636's 43-128
  const challenge = await pkceChallenge(verifier);
  return { verifier, challenge };
}

export function newState(): string {
  return randomUrlSafe(16);
}
```

- [ ] **Step 4: Run — expect PASS**

If `crypto.subtle` is undefined in the jsdom env, add to `tests/setup.ts`:
```ts
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
```

- [ ] **Step 5: Commit**

```bash
git add src/auth/pkce.ts tests/auth/pkce.test.ts tests/setup.ts
git commit -m "feat: add PKCE verifier/challenge/state generation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `auth/provider-oauth-config.ts` and `auth/oauth-client.ts`

**Files:**
- Create: `src/auth/provider-oauth-config.ts`, `src/auth/oauth-client.ts`
- Test: `tests/auth/oauth-client.test.ts`

**Interfaces:**
- Consumes: `pkce.ts` (Task 7), `ProviderKind` (Task 5).
- Produces:
  - `interface OAuthProviderConfig { authorizeUrl: string; tokenUrl: string; scopes: string[]; loopbackHost: "127.0.0.1" | "localhost"; extraAuthParams: Record<string, string>; usesClientSecret: boolean }`
  - `const OAUTH_CONFIG: Record<ProviderKind, OAuthProviderConfig>`
  - `interface HttpPost { (url: string, form: Record<string, string>): Promise<{ status: number; json: unknown }> }`
  - `function buildAuthorizeUrl(cfg: OAuthProviderConfig, args: { clientId: string; redirectUri: string; challenge: string; state: string }): string`
  - `interface TokenResponse { accessToken: string; refreshToken?: string; expiresInSec: number }`
  - `async function exchangeCode(cfg, post: HttpPost, args: { clientId: string; clientSecret?: string; code: string; verifier: string; redirectUri: string }): Promise<TokenResponse>`
  - `async function refreshAccessToken(cfg, post: HttpPost, args: { clientId: string; clientSecret?: string; refreshToken: string }): Promise<TokenResponse>`
  - All three throw `AuthError` on `invalid_grant` / non-2xx.

- [ ] **Step 1: Write `src/auth/provider-oauth-config.ts`**

```ts
import type { ProviderKind } from "../providers/types";

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  loopbackHost: "127.0.0.1" | "localhost";
  extraAuthParams: Record<string, string>;
  usesClientSecret: boolean;
}

export const OAUTH_CONFIG: Record<ProviderKind, OAuthProviderConfig> = {
  gmail: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    loopbackHost: "127.0.0.1",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    usesClientSecret: true,
  },
  "ms-graph": {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["Mail.ReadWrite", "Mail.Send", "offline_access", "User.Read"],
    loopbackHost: "localhost",
    extraAuthParams: {},
    usesClientSecret: false,
  },
};
```

- [ ] **Step 2: Write failing tests for `oauth-client.ts`**

`tests/auth/oauth-client.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { OAUTH_CONFIG } from "../../src/auth/provider-oauth-config";
import { buildAuthorizeUrl, exchangeCode, refreshAccessToken } from "../../src/auth/oauth-client";
import { AuthError } from "../../src/providers/types";

describe("buildAuthorizeUrl", () => {
  it("includes PKCE, state, scope and Google extras", () => {
    const url = new URL(buildAuthorizeUrl(OAUTH_CONFIG.gmail, {
      clientId: "cid", redirectUri: "http://127.0.0.1:5000",
      challenge: "chal", state: "st",
    }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5000");
  });
});

describe("exchangeCode", () => {
  it("maps a token response", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200,
      json: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
    });
    const r = await exchangeCode(OAUTH_CONFIG["ms-graph"], post, {
      clientId: "cid", code: "c", verifier: "v", redirectUri: "http://localhost:5000",
    });
    expect(r).toEqual({ accessToken: "at", refreshToken: "rt", expiresInSec: 3600 });
    const [, form] = post.mock.calls[0];
    expect(form.grant_type).toBe("authorization_code");
    expect(form.code_verifier).toBe("v");
    expect(form.client_secret).toBeUndefined();
  });

  it("throws AuthError on invalid_grant", async () => {
    const post = vi.fn().mockResolvedValue({ status: 400, json: { error: "invalid_grant" } });
    await expect(exchangeCode(OAUTH_CONFIG.gmail, post, {
      clientId: "cid", clientSecret: "sec", code: "c", verifier: "v",
      redirectUri: "http://127.0.0.1:5000",
    })).rejects.toBeInstanceOf(AuthError);
  });
});

describe("refreshAccessToken", () => {
  it("sends grant_type=refresh_token and includes the Google secret", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at2", expires_in: 3599 },
    });
    const r = await refreshAccessToken(OAUTH_CONFIG.gmail, post, {
      clientId: "cid", clientSecret: "sec", refreshToken: "rt",
    });
    expect(r.accessToken).toBe("at2");
    expect(r.refreshToken).toBeUndefined();
    const [, form] = post.mock.calls[0];
    expect(form.grant_type).toBe("refresh_token");
    expect(form.client_secret).toBe("sec");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement `src/auth/oauth-client.ts`**

```ts
import { AuthError } from "../providers/types";
import type { OAuthProviderConfig } from "./provider-oauth-config";

export interface HttpPost {
  (url: string, form: Record<string, string>): Promise<{ status: number; json: unknown }>;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresInSec: number;
}

export function buildAuthorizeUrl(
  cfg: OAuthProviderConfig,
  args: { clientId: string; redirectUri: string; challenge: string; state: string },
): string {
  const url = new URL(cfg.authorizeUrl);
  const p = url.searchParams;
  p.set("client_id", args.clientId);
  p.set("redirect_uri", args.redirectUri);
  p.set("response_type", "code");
  p.set("scope", cfg.scopes.join(" "));
  p.set("code_challenge", args.challenge);
  p.set("code_challenge_method", "S256");
  p.set("state", args.state);
  for (const [k, v] of Object.entries(cfg.extraAuthParams)) p.set(k, v);
  return url.toString();
}

function mapToken(json: Record<string, unknown>): TokenResponse {
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresInSec: Number(json.expires_in ?? 3600),
  };
}

function assertOk(status: number, json: unknown): asserts json is Record<string, unknown> {
  const body = (json ?? {}) as Record<string, unknown>;
  if (status < 200 || status >= 300 || typeof body.access_token !== "string") {
    const detail = typeof body.error === "string" ? body.error : `HTTP ${status}`;
    throw new AuthError(`OAuth token request failed: ${detail}`, body);
  }
}

export async function exchangeCode(
  cfg: OAuthProviderConfig,
  post: HttpPost,
  args: { clientId: string; clientSecret?: string; code: string; verifier: string; redirectUri: string },
): Promise<TokenResponse> {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: args.clientId,
    code: args.code,
    code_verifier: args.verifier,
    redirect_uri: args.redirectUri,
  };
  if (cfg.usesClientSecret && args.clientSecret) form.client_secret = args.clientSecret;
  const { status, json } = await post(cfg.tokenUrl, form);
  assertOk(status, json);
  return mapToken(json);
}

export async function refreshAccessToken(
  cfg: OAuthProviderConfig,
  post: HttpPost,
  args: { clientId: string; clientSecret?: string; refreshToken: string },
): Promise<TokenResponse> {
  const form: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: args.clientId,
    refresh_token: args.refreshToken,
  };
  if (cfg.usesClientSecret && args.clientSecret) form.client_secret = args.clientSecret;
  const { status, json } = await post(cfg.tokenUrl, form);
  assertOk(status, json);
  return mapToken(json);
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/auth/provider-oauth-config.ts src/auth/oauth-client.ts tests/auth/oauth-client.test.ts
git commit -m "feat: add OAuth config and authorize/exchange/refresh helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `auth/loopback-server.ts`

**Files:**
- Create: `src/auth/loopback-server.ts`
- Test: `tests/auth/loopback-server.test.ts`

**Interfaces:**
- Produces:
  - `interface LoopbackResult { code: string; state: string }`
  - `class LoopbackServer { constructor(host: "127.0.0.1" | "localhost"); listen(): Promise<{ port: number; redirectUri: string }>; waitForCode(opts?: { timeoutMs?: number }): Promise<LoopbackResult>; close(): void }`
  - Uses `require("node:http")` (external at bundle time; available in Electron). Responds with a minimal HTML page, then the promise resolves. On `?error=...` it rejects with `AuthError`. Timeout (default 300_000 ms) rejects and closes.

- [ ] **Step 1: Write failing tests**

`tests/auth/loopback-server.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import http from "node:http";
import { LoopbackServer } from "../../src/auth/loopback-server";
import { AuthError } from "../../src/providers/types";

function hit(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject);
  });
}

describe("LoopbackServer", () => {
  it("captures code and state from the redirect", async () => {
    const server = new LoopbackServer("127.0.0.1");
    const { redirectUri } = await server.listen();
    const waiting = server.waitForCode();
    const status = await hit(`${redirectUri}/?code=abc&state=xyz`);
    expect(status).toBe(200);
    await expect(waiting).resolves.toEqual({ code: "abc", state: "xyz" });
    server.close();
  });

  it("rejects with AuthError when the provider returns error", async () => {
    const server = new LoopbackServer("127.0.0.1");
    const { redirectUri } = await server.listen();
    const waiting = server.waitForCode();
    await hit(`${redirectUri}/?error=access_denied`);
    await expect(waiting).rejects.toBeInstanceOf(AuthError);
    server.close();
  });

  it("times out", async () => {
    const server = new LoopbackServer("127.0.0.1");
    await server.listen();
    await expect(server.waitForCode({ timeoutMs: 10 })).rejects.toBeInstanceOf(AuthError);
    server.close();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/auth/loopback-server.ts`**

```ts
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { AuthError } from "../providers/types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const http = require("node:http") as typeof import("node:http");

export interface LoopbackResult {
  code: string;
  state: string;
}

const DONE_HTML =
  "<!doctype html><meta charset=utf-8><title>Obsidian Email</title>" +
  "<body style=\"font-family:system-ui;padding:2rem\">" +
  "<h2>Authentication complete</h2><p>You can close this tab and return to Obsidian.</p>";

export class LoopbackServer {
  private server?: Server;
  private port = 0;
  private settle?: {
    resolve: (r: LoopbackResult) => void;
    reject: (e: Error) => void;
  };
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private host: "127.0.0.1" | "localhost") {}

  listen(): Promise<{ port: number; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.on("error", reject);
      this.server.listen(0, this.host, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") this.port = addr.port;
        resolve({ port: this.port, redirectUri: `http://${this.host}:${this.port}` });
      });
    });
  }

  waitForCode(opts: { timeoutMs?: number } = {}): Promise<LoopbackResult> {
    const timeoutMs = opts.timeoutMs ?? 300_000;
    return new Promise<LoopbackResult>((resolve, reject) => {
      this.settle = { resolve, reject };
      this.timer = setTimeout(() => {
        this.settle = undefined;
        reject(new AuthError("Timed out waiting for the authentication redirect."));
        this.close();
      }, timeoutMs);
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${this.host}:${this.port}`);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(DONE_HTML);
    if (!this.settle) return;
    if (this.timer) clearTimeout(this.timer);
    const settle = this.settle;
    this.settle = undefined;
    if (error) settle.reject(new AuthError(`Authorization failed: ${error}`));
    else if (code) settle.resolve({ code, state });
    else settle.reject(new AuthError("Redirect had neither code nor error."));
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.server?.close();
    this.server = undefined;
  }
}
```

Note on bundling: `require("node:http")` stays a runtime require because `esbuild` treats `node:*` as external by default for the `node` platform; for the `cjs`/browser target add `"node:http"` — actually esbuild leaves unknown `node:` builtins external automatically when `platform` is not `browser`. Verify `npm run build` does not inline it; if it errors, add `external: [..., "node:http"]` in `esbuild.config.mjs`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Verify the production build still works**

Run: `npm run build`
Expected: success; if esbuild complains about `node:http`, add it to `external` and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/auth/loopback-server.ts tests/auth/loopback-server.test.ts esbuild.config.mjs
git commit -m "feat: add one-shot loopback HTTP server for OAuth redirects

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `auth/token-manager.ts`

**Files:**
- Create: `src/auth/token-manager.ts`
- Test: `tests/auth/token-manager.test.ts`

**Interfaces:**
- Consumes: `oauth-client.ts` (`refreshAccessToken`, `HttpPost`, `TokenResponse`), `provider-oauth-config.ts`, `AuthError`, `ProviderKind`.
- Produces:
  - `interface SecretStore { getSecret(id: string): Promise<string | null>; setSecret(id: string, secret: string): Promise<void> }` (structural match for `app.secretStorage`)
  - `interface TokenManagerDeps { secrets: SecretStore; post: HttpPost; now: () => number }`
  - `class TokenManager`
    - `constructor(accountId: string, kind: ProviderKind, clientId: string, deps: TokenManagerDeps)`
    - `async storeInitialTokens(t: TokenResponse, clientSecret?: string): Promise<void>`
    - `async getAccessToken(): Promise<string>` — cached until 60 s before expiry; single-flight refresh; throws `AuthError` on failure
    - `async clear(): Promise<void>` — best-effort wipe of the two secret keys
  - Secret keys: `obsidian-email-<accountId>:refresh`, `obsidian-email-<accountId>:secret`.

- [ ] **Step 1: Write failing tests**

`tests/auth/token-manager.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { TokenManager } from "../../src/auth/token-manager";
import { AuthError } from "../../src/providers/types";

function makeSecrets(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getSecret: vi.fn(async (id: string) => map.get(id) ?? null),
    setSecret: vi.fn(async (id: string, s: string) => void map.set(id, s)),
  };
}

const KEY = (id: string, s: string) => `obsidian-email-${id}:${s}`;

describe("TokenManager", () => {
  it("returns the cached access token until near expiry", async () => {
    const secrets = makeSecrets({ [KEY("a1", "refresh")]: "rt" });
    let t = 1_000_000;
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at1", expires_in: 3600 },
    });
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post, now: () => t });
    expect(await tm.getAccessToken()).toBe("at1");
    t += 1000; // 1s later, still valid
    expect(await tm.getAccessToken()).toBe("at1");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("refreshes once when concurrent callers race an expired token", async () => {
    const secrets = makeSecrets({ [KEY("a1", "refresh")]: "rt" });
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "atX", expires_in: 3600 },
    });
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post, now: () => 0 });
    const [x, y] = await Promise.all([tm.getAccessToken(), tm.getAccessToken()]);
    expect(x).toBe("atX");
    expect(y).toBe("atX");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("persists a rotated refresh token", async () => {
    const secrets = makeSecrets({ [KEY("a1", "refresh")]: "rt-old" });
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at", refresh_token: "rt-new", expires_in: 3600 },
    });
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post, now: () => 0 });
    await tm.getAccessToken();
    expect(secrets.map.get(KEY("a1", "refresh"))).toBe("rt-new");
  });

  it("throws AuthError when there is no stored refresh token", async () => {
    const secrets = makeSecrets();
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post: vi.fn(), now: () => 0 });
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);
  });

  it("throws AuthError when refresh fails and does not cache", async () => {
    const secrets = makeSecrets({ [KEY("a1", "refresh")]: "rt" });
    const post = vi.fn().mockResolvedValue({ status: 400, json: { error: "invalid_grant" } });
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post, now: () => 0 });
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);
  });

  it("sends the Google client secret from storage on refresh", async () => {
    const secrets = makeSecrets({
      [KEY("g1", "refresh")]: "rt", [KEY("g1", "secret")]: "goog-secret",
    });
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at", expires_in: 3600 },
    });
    const tm = new TokenManager("g1", "gmail", "cid", { secrets, post, now: () => 0 });
    await tm.getAccessToken();
    const [, form] = post.mock.calls[0];
    expect(form.client_secret).toBe("goog-secret");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/auth/token-manager.ts`**

```ts
import { AuthError } from "../providers/types";
import type { ProviderKind } from "../providers/types";
import { OAUTH_CONFIG } from "./provider-oauth-config";
import { refreshAccessToken, type HttpPost, type TokenResponse } from "./oauth-client";

export interface SecretStore {
  getSecret(id: string): Promise<string | null>;
  setSecret(id: string, secret: string): Promise<void>;
}

export interface TokenManagerDeps {
  secrets: SecretStore;
  post: HttpPost;
  now: () => number;
}

const SKEW_MS = 60_000;

export class TokenManager {
  private accessToken?: string;
  private expiresAtMs = 0;
  private refreshInFlight?: Promise<string>;

  constructor(
    private accountId: string,
    private kind: ProviderKind,
    private clientId: string,
    private deps: TokenManagerDeps,
  ) {}

  private key(suffix: "refresh" | "secret"): string {
    return `obsidian-email-${this.accountId}:${suffix}`;
  }

  async storeInitialTokens(t: TokenResponse, clientSecret?: string): Promise<void> {
    if (!t.refreshToken) {
      throw new AuthError("Provider did not return a refresh token; re-consent is required.");
    }
    await this.deps.secrets.setSecret(this.key("refresh"), t.refreshToken);
    if (clientSecret) await this.deps.secrets.setSecret(this.key("secret"), clientSecret);
    this.accessToken = t.accessToken;
    this.expiresAtMs = this.deps.now() + t.expiresInSec * 1000;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.deps.now() < this.expiresAtMs - SKEW_MS) {
      return this.accessToken;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doRefresh().finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<string> {
    const refreshToken = await this.deps.secrets.getSecret(this.key("refresh"));
    if (!refreshToken) throw new AuthError("No stored refresh token for this account.");
    const cfg = OAUTH_CONFIG[this.kind];
    const clientSecret = cfg.usesClientSecret
      ? (await this.deps.secrets.getSecret(this.key("secret"))) ?? undefined
      : undefined;
    const t = await refreshAccessToken(cfg, this.deps.post, {
      clientId: this.clientId,
      clientSecret,
      refreshToken,
    });
    if (t.refreshToken && t.refreshToken !== refreshToken) {
      await this.deps.secrets.setSecret(this.key("refresh"), t.refreshToken);
    }
    this.accessToken = t.accessToken;
    this.expiresAtMs = this.deps.now() + t.expiresInSec * 1000;
    return t.accessToken;
  }

  async clear(): Promise<void> {
    // secretStorage has no delete in the public API; overwrite with empty.
    try {
      await this.deps.secrets.setSecret(this.key("refresh"), "");
      await this.deps.secrets.setSecret(this.key("secret"), "");
    } catch {
      /* best effort */
    }
    this.accessToken = undefined;
    this.expiresAtMs = 0;
  }
}
```

Note: if `app.secretStorage` gains a `removeSecret` before implementation, prefer it in `clear()`. Confirm against the installed `obsidian` types.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/auth/token-manager.ts tests/auth/token-manager.test.ts
git commit -m "feat: add TokenManager with single-flight refresh and secret storage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: HTTP client abstraction + `providers/gmail/gmail-mappers.ts`

**Files:**
- Create: `src/providers/http.ts`, `src/providers/gmail/gmail-mappers.ts`
- Create: `tests/fixtures/gmail/message-metadata.json`, `tests/fixtures/gmail/message-full.json`, `tests/fixtures/gmail/labels.json`
- Test: `tests/providers/gmail/gmail-mappers.test.ts`

**Interfaces:**
- Produces:
  - `src/providers/http.ts`:
    ```ts
    export interface HttpResponse { status: number; json: unknown; text: string; arrayBuffer: ArrayBuffer; headers: Record<string, string>; }
    export interface HttpClient { request(opts: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<HttpResponse>; }
    ```
  - `src/providers/gmail/gmail-mappers.ts`:
    - `parseAddress(raw: string): Address`
    - `parseAddressList(raw: string | undefined): Address[]`
    - `decodeBase64Url(data: string): string`
    - `headerMap(headers: Array<{ name: string; value: string }>): Record<string, string>`
    - `mapGmailSummary(msg: GmailMessage): MessageSummary`
    - `mapGmailBody(msg: GmailMessage): MessageBody`
    - `mapGmailLabels(labels: GmailLabel[]): Mailbox[]`
    - `GMAIL_ARCHIVE_MAILBOX: Mailbox` (`{ id: "ARCHIVE", name: "All Mail", kind: "archive" }`)
    - exported `interface GmailMessage`, `interface GmailLabel` matching the API shapes used.

- [ ] **Step 1: Create fixtures**

Get real shapes from the Gmail API docs (`users.messages.get`, `users.labels.list`). Minimum viable fixtures:

`tests/fixtures/gmail/message-metadata.json`:
```json
{
  "id": "18f1a", "threadId": "18f1a", "labelIds": ["INBOX", "UNREAD", "IMPORTANT"],
  "snippet": "Hello there, this is the preview",
  "payload": {
    "headers": [
      { "name": "From", "value": "Jane Doe <jane@example.com>" },
      { "name": "To", "value": "me@example.com" },
      { "name": "Cc", "value": "Team <team@example.com>, bob@example.com" },
      { "name": "Subject", "value": "Weekly sync" },
      { "name": "Date", "value": "Wed, 03 Sep 2026 14:05:00 -0700" }
    ]
  }
}
```

`tests/fixtures/gmail/message-full.json`:
```json
{
  "id": "18f1a", "threadId": "18f1a", "labelIds": ["INBOX"],
  "snippet": "Hello",
  "payload": {
    "mimeType": "multipart/mixed",
    "headers": [
      { "name": "From", "value": "jane@example.com" },
      { "name": "Subject", "value": "With attachment" },
      { "name": "Date", "value": "Wed, 03 Sep 2026 14:05:00 -0700" }
    ],
    "parts": [
      {
        "mimeType": "multipart/alternative",
        "parts": [
          { "mimeType": "text/plain", "body": { "data": "SGVsbG8gd29ybGQ" } },
          { "mimeType": "text/html", "body": { "data": "PHA-SGVsbG88L3A-" } }
        ]
      },
      {
        "mimeType": "application/pdf",
        "filename": "report.pdf",
        "headers": [{ "name": "Content-Disposition", "value": "attachment; filename=\"report.pdf\"" }],
        "body": { "attachmentId": "ANGjdJ9", "size": 12345 }
      },
      {
        "mimeType": "image/png",
        "filename": "logo.png",
        "headers": [
          { "name": "Content-Disposition", "value": "inline" },
          { "name": "Content-ID", "value": "<logo123>" }
        ],
        "body": { "attachmentId": "IMG1", "size": 999 }
      }
    ]
  }
}
```

`tests/fixtures/gmail/labels.json`:
```json
{ "labels": [
  { "id": "INBOX", "name": "INBOX", "type": "system" },
  { "id": "SENT", "name": "SENT", "type": "system" },
  { "id": "TRASH", "name": "TRASH", "type": "system" },
  { "id": "SPAM", "name": "SPAM", "type": "system" },
  { "id": "DRAFT", "name": "DRAFT", "type": "system" },
  { "id": "CATEGORY_PROMOTIONS", "name": "CATEGORY_PROMOTIONS", "type": "system" },
  { "id": "Label_12", "name": "Projects/Acme", "type": "user" }
] }
```

- [ ] **Step 2: Write failing tests**

`tests/providers/gmail/gmail-mappers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseAddress, parseAddressList, decodeBase64Url,
  mapGmailSummary, mapGmailBody, mapGmailLabels,
} from "../../../src/providers/gmail/gmail-mappers";

const load = (p: string) => JSON.parse(readFileSync(`tests/fixtures/gmail/${p}`, "utf8"));

describe("gmail address parsing", () => {
  it("parses 'Name <email>'", () => {
    expect(parseAddress("Jane Doe <jane@example.com>")).toEqual({ name: "Jane Doe", email: "jane@example.com" });
  });
  it("parses a bare email", () => {
    expect(parseAddress("bob@example.com")).toEqual({ email: "bob@example.com" });
  });
  it("splits a list on commas outside quotes", () => {
    const list = parseAddressList('"Doe, Jane" <jane@x.com>, bob@y.com');
    expect(list).toEqual([
      { name: "Doe, Jane", email: "jane@x.com" },
      { email: "bob@y.com" },
    ]);
  });
});

describe("decodeBase64Url", () => {
  it("decodes url-safe base64 without padding, utf-8 aware", () => {
    expect(decodeBase64Url("SGVsbG8gd29ybGQ")).toBe("Hello world");
  });
});

describe("mapGmailSummary", () => {
  it("maps metadata to a MessageSummary", () => {
    const m = mapGmailSummary(load("message-metadata.json"));
    expect(m).toMatchObject({
      id: "18f1a", threadId: "18f1a", subject: "Weekly sync",
      from: { name: "Jane Doe", email: "jane@example.com" },
      unread: true, hasAttachments: false, flagged: false,
      mailboxIds: ["INBOX"],
    });
    expect(m.cc).toHaveLength(2);
    expect(m.date).toBe(Date.parse("Wed, 03 Sep 2026 14:05:00 -0700"));
  });
});

describe("mapGmailBody", () => {
  it("prefers text/html, collects attachments, flags inline + contentId", () => {
    const b = mapGmailBody(load("message-full.json"));
    expect(b.html).toBe("<p>Hello</p>");
    expect(b.text).toBe("Hello world");
    expect(b.attachments).toHaveLength(2);
    const pdf = b.attachments.find((a) => a.filename === "report.pdf")!;
    expect(pdf).toMatchObject({ id: "ANGjdJ9", mimeType: "application/pdf", inline: false, size: 12345 });
    const png = b.attachments.find((a) => a.filename === "logo.png")!;
    expect(png).toMatchObject({ inline: true, contentId: "logo123" });
  });
});

describe("mapGmailLabels", () => {
  it("maps system labels to kinds, hides categories, keeps user labels", () => {
    const boxes = mapGmailLabels(load("labels.json").labels);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    expect(byId.INBOX.kind).toBe("inbox");
    expect(byId.SENT.kind).toBe("sent");
    expect(byId.TRASH.kind).toBe("trash");
    expect(byId.SPAM.kind).toBe("spam");
    expect(byId.DRAFT.kind).toBe("drafts");
    expect(byId.CATEGORY_PROMOTIONS).toBeUndefined();
    expect(byId.Label_12).toMatchObject({ kind: "custom", name: "Projects/Acme" });
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement `src/providers/http.ts`**

```ts
export interface HttpResponse {
  status: number;
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
  headers: Record<string, string>;
}

export interface HttpClient {
  request(opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<HttpResponse>;
}
```

- [ ] **Step 5: Implement `src/providers/gmail/gmail-mappers.ts`**

```ts
import type { Address, AttachmentMeta, Mailbox, MailboxKind, MessageBody, MessageSummary } from "../types";

export interface GmailHeader { name: string; value: string; }
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}
export interface GmailLabel { id: string; name: string; type?: string; }

export const GMAIL_ARCHIVE_MAILBOX: Mailbox = { id: "ARCHIVE", name: "All Mail", kind: "archive" };

export function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(data.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

export function parseAddress(raw: string): Address {
  const t = raw.trim();
  const m = t.match(/^\s*(?:"?([^"<]*?)"?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    return name ? { name, email: m[2].trim() } : { email: m[2].trim() };
  }
  return { email: t.replace(/^<|>$/g, "") };
}

export function parseAddressList(raw: string | undefined): Address[] {
  if (!raw) return [];
  const parts: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ch of raw) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === "," && !inQuote) { parts.push(buf); buf = ""; }
    else buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((p) => parseAddress(p)).filter((a) => a.email);
}

export function headerMap(headers: GmailHeader[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name.toLowerCase()] = h.value;
  return out;
}

const SYSTEM_LABEL_KIND: Record<string, MailboxKind> = {
  INBOX: "inbox", SENT: "sent", TRASH: "trash", SPAM: "spam", DRAFT: "drafts",
};
const HIDDEN_LABELS = new Set([
  "UNREAD", "STARRED", "IMPORTANT", "CHAT",
  "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES", "CATEGORY_FORUMS",
]);

function summaryMailboxIds(labelIds: string[]): string[] {
  const visible = labelIds.filter((id) => !HIDDEN_LABELS.has(id));
  return visible.length ? visible : [GMAIL_ARCHIVE_MAILBOX.id];
}

export function mapGmailSummary(msg: GmailMessage): MessageSummary {
  const h = headerMap(msg.payload?.headers);
  const labels = msg.labelIds ?? [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    mailboxIds: summaryMailboxIds(labels),
    from: parseAddress(h.from ?? ""),
    to: parseAddressList(h.to),
    cc: parseAddressList(h.cc),
    subject: h.subject ?? "(no subject)",
    snippet: msg.snippet ?? "",
    date: h.date ? Date.parse(h.date) : Date.now(),
    unread: labels.includes("UNREAD"),
    hasAttachments: hasAttachmentPart(msg.payload),
    flagged: labels.includes("STARRED"),
  };
}

function hasAttachmentPart(part?: GmailPart): boolean {
  if (!part) return false;
  if (part.filename && part.body?.attachmentId) return true;
  return (part.parts ?? []).some(hasAttachmentPart);
}

function walkParts(part: GmailPart, acc: { html?: string; text?: string; attachments: AttachmentMeta[] }): void {
  const mime = part.mimeType ?? "";
  if (part.filename && part.body?.attachmentId) {
    const ph = headerMap(part.headers);
    const disposition = ph["content-disposition"] ?? "";
    const cid = (ph["content-id"] ?? "").replace(/^<|>$/g, "");
    acc.attachments.push({
      id: part.body.attachmentId,
      filename: part.filename,
      mimeType: mime || "application/octet-stream",
      size: part.body.size ?? 0,
      inline: /inline/i.test(disposition) || Boolean(cid),
      contentId: cid || undefined,
    });
    return;
  }
  if (mime === "text/html" && part.body?.data) acc.html = decodeBase64Url(part.body.data);
  else if (mime === "text/plain" && part.body?.data && acc.text === undefined) {
    acc.text = decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) walkParts(child, acc);
}

export function mapGmailBody(msg: GmailMessage): MessageBody {
  const acc: { html?: string; text?: string; attachments: AttachmentMeta[] } = { attachments: [] };
  if (msg.payload) walkParts(msg.payload, acc);
  return {
    id: msg.id,
    html: acc.html ?? null,
    text: acc.text ?? null,
    attachments: acc.attachments,
    headers: headerMap(msg.payload?.headers),
  };
}

export function mapGmailLabels(labels: GmailLabel[]): Mailbox[] {
  const boxes: Mailbox[] = [];
  for (const l of labels) {
    if (HIDDEN_LABELS.has(l.id)) continue;
    const kind = SYSTEM_LABEL_KIND[l.id];
    if (kind) { boxes.push({ id: l.id, name: titleCase(l.id), kind }); continue; }
    if (l.type === "system") continue; // other system labels not surfaced
    boxes.push({ id: l.id, name: l.name, kind: "custom" });
  }
  boxes.push(GMAIL_ARCHIVE_MAILBOX);
  return boxes;
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
```

- [ ] **Step 6: Run — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add src/providers/http.ts src/providers/gmail/gmail-mappers.ts tests/fixtures/gmail tests/providers/gmail
git commit -m "feat: add HttpClient interface and Gmail response mappers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: `providers/gmail/gmail-provider.ts`

**Files:**
- Create: `src/providers/gmail/gmail-provider.ts`
- Create: `tests/fixtures/gmail/{messages-list.json,history.json,profile.json}`
- Test: `tests/providers/gmail/gmail-provider.test.ts`

**Interfaces:**
- Consumes: `HttpClient` (Task 11), gmail mappers (Task 11), `MailProvider` + models + errors (Task 5), `withRetry`/`parseRetryAfter` (Task 4), `runMailProviderContract` (Task 6).
- Produces:
  - `interface GmailProviderDeps { http: HttpClient; getAccessToken: () => Promise<string>; baseUrl?: string; concurrency?: number }`
  - `class GmailProvider implements MailProvider` (constructed with `GmailProviderDeps`).

- [ ] **Step 1: Create fixtures**

`tests/fixtures/gmail/messages-list.json`:
```json
{ "messages": [{ "id": "m1", "threadId": "t1" }, { "id": "m2", "threadId": "t2" }],
  "nextPageToken": "PAGE2", "resultSizeEstimate": 2 }
```
`tests/fixtures/gmail/profile.json`:
```json
{ "emailAddress": "me@example.com", "historyId": "900" }
```
`tests/fixtures/gmail/history.json`:
```json
{ "history": [
    { "id": "901", "messagesAdded": [{ "message": { "id": "m3", "threadId": "t3", "labelIds": ["INBOX", "UNREAD"] } }] },
    { "id": "902", "messagesDeleted": [{ "message": { "id": "m1", "threadId": "t1" } }] }
  ],
  "historyId": "902" }
```

- [ ] **Step 2: Write failing tests**

`tests/providers/gmail/gmail-provider.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GmailProvider } from "../../../src/providers/gmail/gmail-provider";
import { runMailProviderContract } from "../../../src/providers/provider-contract";
import type { HttpClient, HttpResponse } from "../../../src/providers/http";

const fx = (p: string) => JSON.parse(readFileSync(`tests/fixtures/gmail/${p}`, "utf8"));

function resp(json: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, json, text: JSON.stringify(json), arrayBuffer: new ArrayBuffer(0), headers };
}

/** Route requests by URL substring. */
function router(routes: Array<[RegExp, (url: string) => HttpResponse]>): HttpClient {
  return {
    request: vi.fn(async ({ url }) => {
      for (const [re, fn] of routes) if (re.test(url)) return fn(url);
      throw new Error(`no route for ${url}`);
    }),
  };
}

describe("GmailProvider", () => {
  it("listMessages hydrates summaries and passes through the page token", async () => {
    const http = router([
      [/messages\?/, () => resp(fx("messages-list.json"))],
      [/messages\/m1/, () => resp({ ...fx("message-metadata.json"), id: "m1", threadId: "t1" })],
      [/messages\/m2/, () => resp({ ...fx("message-metadata.json"), id: "m2", threadId: "t2" })],
    ]);
    const p = new GmailProvider({ http, getAccessToken: async () => "at" });
    const page = await p.listMessages("INBOX");
    expect(page.items.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect(page.nextPageToken).toBe("PAGE2");
  });

  it("sends the bearer token", async () => {
    const http = router([[/./, () => resp(fx("profile.json"))]]);
    const p = new GmailProvider({ http, getAccessToken: async () => "tok123" });
    await p.initialCursor();
    const call = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.headers.Authorization).toBe("Bearer tok123");
  });

  it("syncSince returns upserts and deletions from history", async () => {
    const http = router([
      [/history\?/, () => resp(fx("history.json"))],
      [/messages\/m3/, () => resp({ ...fx("message-metadata.json"), id: "m3", threadId: "t3" })],
    ]);
    const p = new GmailProvider({ http, getAccessToken: async () => "at" });
    const result = await p.syncSince({ kind: "gmail", historyId: "900" });
    expect(result.upserts.map((m) => m.id)).toContain("m3");
    expect(result.deletions).toContain("m1");
    expect(result.cursor).toEqual({ kind: "gmail", historyId: "902" });
  });

  it("retries once on HTTP 429 then succeeds", async () => {
    let calls = 0;
    const http: HttpClient = {
      request: vi.fn(async () => {
        calls++;
        return calls === 1 ? resp({}, 429, { "retry-after": "0" }) : resp(fx("profile.json"));
      }),
    };
    const p = new GmailProvider({ http, getAccessToken: async () => "at" });
    await expect(p.initialCursor()).resolves.toEqual({ kind: "gmail", historyId: "900" });
    expect(calls).toBe(2);
  });

  it("throws AuthError on 401", async () => {
    const http = router([[/./, () => resp({ error: "unauthorized" }, 401)]]);
    const p = new GmailProvider({ http, getAccessToken: async () => "at" });
    await expect(p.listMailboxes()).rejects.toMatchObject({ name: "AuthError" });
  });
});

runMailProviderContract("GmailProvider", async () => {
  const state = {
    messages: new Map<string, Record<string, unknown>>(),
    history: [] as Array<Record<string, unknown>>,
    historyId: 100,
  };
  const seedInbox = async (n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `g${state.messages.size + 1}`;
      state.historyId++;
      state.messages.set(id, {
        id, threadId: id, labelIds: ["INBOX", "UNREAD"], snippet: "",
        payload: { headers: [
          { name: "From", value: "s@x.com" }, { name: "Subject", value: id },
          { name: "Date", value: new Date(state.historyId * 1000).toUTCString() },
        ] },
      });
      state.history.push({ id: String(state.historyId), messagesAdded: [{ message: { id, threadId: id, labelIds: ["INBOX"] } }] });
      ids.push(id);
    }
    return ids;
  };
  const http: HttpClient = {
    request: vi.fn(async ({ url }) => {
      if (/\/profile/.test(url)) return resp({ emailAddress: "me@x.com", historyId: String(state.historyId) });
      if (/history\?/.test(url)) {
        const since = Number(new URL(url).searchParams.get("startHistoryId"));
        return resp({ history: state.history.filter((h) => Number(h.id) > since), historyId: String(state.historyId) });
      }
      const idMatch = url.match(/messages\/([^/?]+)/);
      if (idMatch) return resp(state.messages.get(idMatch[1]) ?? {});
      // messages?labelIds=...
      const all = [...state.messages.keys()].map((id) => ({ id, threadId: id }));
      const u = new URL(url);
      const start = Number(u.searchParams.get("pageToken") ?? 0);
      const size = 2;
      const slice = all.slice(start, start + size);
      const next = start + size < all.length ? String(start + size) : undefined;
      return resp({ messages: slice, nextPageToken: next });
    }),
  };
  const provider = new GmailProvider({ http, getAccessToken: async () => "at", concurrency: 2 });
  return { provider, seedInbox };
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement `src/providers/gmail/gmail-provider.ts`**

```ts
import { AuthError, ProviderError } from "../types";
import type { MailProvider, Mailbox, MessageBody, MessageSummary, Page, SyncCursor, SyncResult } from "../types";
import type { HttpClient, HttpResponse } from "../http";
import { withRetry, parseRetryAfter, type RetryableResult } from "../../util/backoff";
import {
  GMAIL_ARCHIVE_MAILBOX, decodeBase64Url, mapGmailBody, mapGmailLabels, mapGmailSummary,
  type GmailMessage,
} from "./gmail-mappers";

export interface GmailProviderDeps {
  http: HttpClient;
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  concurrency?: number;
}

const DEFAULT_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PAGE_SIZE = 25;

export class GmailProvider implements MailProvider {
  readonly kind = "gmail" as const;
  private base: string;
  private concurrency: number;

  constructor(private deps: GmailProviderDeps) {
    this.base = deps.baseUrl ?? DEFAULT_BASE;
    this.concurrency = deps.concurrency ?? 4;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.deps.getAccessToken();
    return withRetry<T>(async (): Promise<RetryableResult<T>> => {
      const res: HttpResponse = await this.deps.http.request({
        url: `${this.base}${path}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        return { retry: false, value: Promise.reject(new AuthError(`Gmail ${res.status}`)) as never };
      }
      if (res.status === 429 || res.status >= 500) {
        return {
          retry: true,
          afterMs: parseRetryAfter(res.headers["retry-after"], Date.now()),
          error: new ProviderError(`Gmail ${res.status}`, res.status, true),
        };
      }
      if (res.status < 200 || res.status >= 300) {
        return { retry: false, value: Promise.reject(new ProviderError(`Gmail ${res.status}`, res.status)) as never };
      }
      return { retry: false, value: res.json as T };
    }, { retries: 4, baseMs: 500, maxMs: 8000 });
  }

  private async mapPool<A, B>(items: A[], fn: (a: A) => Promise<B>): Promise<B[]> {
    const out: B[] = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    });
    await Promise.all(workers);
    return out;
  }

  async listMailboxes(): Promise<Mailbox[]> {
    const data = await this.get<{ labels?: Array<{ id: string; name: string; type?: string }> }>("/labels");
    return mapGmailLabels(data.labels ?? []);
  }

  private async hydrate(ids: string[]): Promise<MessageSummary[]> {
    const msgs = await this.mapPool(ids, (id) =>
      this.get<GmailMessage>(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`),
    );
    return msgs.filter((m) => m.id).map(mapGmailSummary);
  }

  private listQuery(mailboxId: string, pageToken?: string): string {
    const params = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    if (mailboxId === GMAIL_ARCHIVE_MAILBOX.id) params.set("q", "-in:inbox -in:trash -in:spam");
    else params.set("labelIds", mailboxId);
    return params.toString();
  }

  async listMessages(mailboxId: string, pageToken?: string): Promise<Page<MessageSummary>> {
    const data = await this.get<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      `/messages?${this.listQuery(mailboxId, pageToken)}`,
    );
    const items = await this.hydrate((data.messages ?? []).map((m) => m.id));
    return { items, nextPageToken: data.nextPageToken };
  }

  async search(query: string, pageToken?: string): Promise<Page<MessageSummary>> {
    const params = new URLSearchParams({ maxResults: String(PAGE_SIZE), q: query });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await this.get<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      `/messages?${params.toString()}`,
    );
    const items = await this.hydrate((data.messages ?? []).map((m) => m.id));
    return { items, nextPageToken: data.nextPageToken };
  }

  async getMessageBody(id: string): Promise<MessageBody> {
    return mapGmailBody(await this.get<GmailMessage>(`/messages/${id}?format=full`));
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer> {
    const data = await this.get<{ data?: string }>(`/messages/${messageId}/attachments/${attachmentId}`);
    const bin = decodeBase64Url(data.data ?? "");
    return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
  }

  async initialCursor(): Promise<SyncCursor> {
    const p = await this.get<{ historyId: string }>("/profile");
    return { kind: "gmail", historyId: p.historyId };
  }

  async syncSince(cursor: SyncCursor): Promise<SyncResult> {
    if (cursor.kind !== "gmail") throw new ProviderError("wrong cursor kind for Gmail");
    const addedIds = new Set<string>();
    const deletions = new Set<string>();
    let pageToken: string | undefined;
    let latestHistoryId = cursor.historyId;
    do {
      const params = new URLSearchParams({ startHistoryId: cursor.historyId });
      for (const t of ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]) {
        params.append("historyTypes", t);
      }
      if (pageToken) params.set("pageToken", pageToken);
      const data = await this.get<{
        history?: Array<Record<string, Array<{ message: { id: string } }>>> & Array<{ id: string }>;
        historyId?: string;
        nextPageToken?: string;
      }>(`/history?${params.toString()}`);
      for (const h of (data.history ?? []) as Array<Record<string, unknown>>) {
        if (typeof h.id === "string") latestHistoryId = h.id;
        for (const a of (h.messagesAdded as Array<{ message: { id: string } }>) ?? []) addedIds.add(a.message.id);
        for (const d of (h.messagesDeleted as Array<{ message: { id: string } }>) ?? []) deletions.add(d.message.id);
        for (const key of ["labelsAdded", "labelsRemoved"]) {
          for (const l of (h[key] as Array<{ message: { id: string } }>) ?? []) addedIds.add(l.message.id);
        }
      }
      if (data.historyId) latestHistoryId = data.historyId;
      pageToken = data.nextPageToken;
    } while (pageToken);

    for (const id of deletions) addedIds.delete(id);
    const upserts = await this.hydrate([...addedIds]);
    return {
      upserts,
      deletions: [...deletions],
      mailboxChanges: [],
      cursor: { kind: "gmail", historyId: latestHistoryId },
    };
  }
}
```

- [ ] **Step 5: Run — expect PASS (unit tests + contract suite)**

Run: `npm test -- gmail-provider`

- [ ] **Step 6: Commit**

```bash
git add src/providers/gmail/gmail-provider.ts tests/fixtures/gmail tests/providers/gmail/gmail-provider.test.ts
git commit -m "feat: add GmailProvider (list, body, attachment, search, sync)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: `providers/ms-graph/graph-mappers.ts`

**Files:**
- Create: `src/providers/ms-graph/graph-mappers.ts`
- Create: `tests/fixtures/graph/{message.json,message-full.json,folders.json}`
- Test: `tests/providers/ms-graph/graph-mappers.test.ts`

**Interfaces:**
- Produces:
  - `mapGraphAddress(r?: { emailAddress?: { name?: string; address?: string } }): Address`
  - `mapGraphSummary(m: GraphMessage, folderId: string): MessageSummary`
  - `mapGraphBody(m: GraphMessage): MessageBody`
  - `mapGraphFolders(folders: GraphFolder[]): Mailbox[]`
  - exported `interface GraphMessage`, `interface GraphFolder`.
  - Well-known folder mapping: `inbox→inbox`, `sentitems→sent`, `drafts→drafts`, `archive→archive`, `deleteditems→trash`, `junkemail→spam`.

- [ ] **Step 1: Create fixtures**

`tests/fixtures/graph/folders.json`:
```json
{ "value": [
  { "id": "AAAInbox", "displayName": "Inbox", "wellKnownName": "inbox", "unreadItemCount": 3 },
  { "id": "AAASent", "displayName": "Sent Items", "wellKnownName": "sentitems" },
  { "id": "AAADrafts", "displayName": "Drafts", "wellKnownName": "drafts" },
  { "id": "AAADel", "displayName": "Deleted Items", "wellKnownName": "deleteditems" },
  { "id": "AAAJunk", "displayName": "Junk Email", "wellKnownName": "junkemail" },
  { "id": "AAAProj", "displayName": "Projects", "wellKnownName": null }
] }
```

`tests/fixtures/graph/message.json`:
```json
{
  "id": "MSG1", "conversationId": "CONV1",
  "subject": "Quarterly report",
  "bodyPreview": "Here is the summary",
  "receivedDateTime": "2026-09-03T21:05:00Z",
  "isRead": false,
  "hasAttachments": true,
  "flag": { "flagStatus": "flagged" },
  "from": { "emailAddress": { "name": "Jane Doe", "address": "jane@example.com" } },
  "toRecipients": [{ "emailAddress": { "address": "me@example.com" } }],
  "ccRecipients": [{ "emailAddress": { "name": "Team", "address": "team@example.com" } }]
}
```

`tests/fixtures/graph/message-full.json`:
```json
{
  "id": "MSG1", "conversationId": "CONV1", "subject": "With body",
  "receivedDateTime": "2026-09-03T21:05:00Z", "isRead": true, "hasAttachments": true,
  "from": { "emailAddress": { "address": "jane@example.com" } },
  "toRecipients": [], "ccRecipients": [],
  "body": { "contentType": "html", "content": "<p>Hello <b>world</b></p>" },
  "internetMessageHeaders": [{ "name": "Message-ID", "value": "<abc@ex>" }],
  "attachments": [
    { "@odata.type": "#microsoft.graph.fileAttachment", "id": "ATT1", "name": "report.pdf",
      "contentType": "application/pdf", "size": 2048, "isInline": false },
    { "@odata.type": "#microsoft.graph.fileAttachment", "id": "ATT2", "name": "logo.png",
      "contentType": "image/png", "size": 512, "isInline": true, "contentId": "logo42" }
  ]
}
```

- [ ] **Step 2: Write failing tests**

`tests/providers/ms-graph/graph-mappers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapGraphSummary, mapGraphBody, mapGraphFolders } from "../../../src/providers/ms-graph/graph-mappers";

const fx = (p: string) => JSON.parse(readFileSync(`tests/fixtures/graph/${p}`, "utf8"));

describe("mapGraphSummary", () => {
  it("maps a message to a MessageSummary", () => {
    const m = mapGraphSummary(fx("message.json"), "AAAInbox");
    expect(m).toMatchObject({
      id: "MSG1", threadId: "CONV1", subject: "Quarterly report",
      from: { name: "Jane Doe", email: "jane@example.com" },
      unread: true, hasAttachments: true, flagged: true,
      mailboxIds: ["AAAInbox"],
    });
    expect(m.date).toBe(Date.parse("2026-09-03T21:05:00Z"));
    expect(m.cc[0]).toEqual({ name: "Team", email: "team@example.com" });
  });
});

describe("mapGraphBody", () => {
  it("maps html body, headers and attachments with inline flag", () => {
    const b = mapGraphBody(fx("message-full.json"));
    expect(b.html).toBe("<p>Hello <b>world</b></p>");
    expect(b.text).toBeNull();
    expect(b.headers["message-id"]).toBe("<abc@ex>");
    expect(b.attachments).toEqual([
      { id: "ATT1", filename: "report.pdf", mimeType: "application/pdf", size: 2048, inline: false, contentId: undefined },
      { id: "ATT2", filename: "logo.png", mimeType: "image/png", size: 512, inline: true, contentId: "logo42" },
    ]);
  });

  it("maps a text body when contentType is text", () => {
    const b = mapGraphBody({ ...fx("message-full.json"), body: { contentType: "text", content: "plain" }, attachments: [] });
    expect(b.text).toBe("plain");
    expect(b.html).toBeNull();
  });
});

describe("mapGraphFolders", () => {
  it("maps well-known names to kinds and unread counts", () => {
    const boxes = mapGraphFolders(fx("folders.json").value);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    expect(byId.AAAInbox).toMatchObject({ kind: "inbox", name: "Inbox", unreadCount: 3 });
    expect(byId.AAASent.kind).toBe("sent");
    expect(byId.AAADel.kind).toBe("trash");
    expect(byId.AAAJunk.kind).toBe("spam");
    expect(byId.AAAProj.kind).toBe("custom");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement `src/providers/ms-graph/graph-mappers.ts`**

```ts
import type { Address, AttachmentMeta, Mailbox, MailboxKind, MessageBody, MessageSummary } from "../types";

interface GraphRecipient { emailAddress?: { name?: string; address?: string }; }
export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  flag?: { flagStatus?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  body?: { contentType?: string; content?: string };
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  attachments?: Array<{
    id: string; name?: string; contentType?: string; size?: number;
    isInline?: boolean; contentId?: string;
  }>;
}
export interface GraphFolder {
  id: string;
  displayName?: string;
  wellKnownName?: string | null;
  unreadItemCount?: number;
}

const WELL_KNOWN_KIND: Record<string, MailboxKind> = {
  inbox: "inbox", sentitems: "sent", drafts: "drafts",
  archive: "archive", deleteditems: "trash", junkemail: "spam",
};

export function mapGraphAddress(r?: GraphRecipient): Address {
  const e = r?.emailAddress ?? {};
  const email = e.address ?? "";
  return e.name ? { name: e.name, email } : { email };
}

export function mapGraphSummary(m: GraphMessage, folderId: string): MessageSummary {
  return {
    id: m.id,
    threadId: m.conversationId ?? m.id,
    mailboxIds: [folderId],
    from: mapGraphAddress(m.from),
    to: (m.toRecipients ?? []).map(mapGraphAddress).filter((a) => a.email),
    cc: (m.ccRecipients ?? []).map(mapGraphAddress).filter((a) => a.email),
    subject: m.subject || "(no subject)",
    snippet: m.bodyPreview ?? "",
    date: m.receivedDateTime ? Date.parse(m.receivedDateTime) : Date.now(),
    unread: m.isRead === false,
    hasAttachments: Boolean(m.hasAttachments),
    flagged: m.flag?.flagStatus === "flagged",
  };
}

export function mapGraphBody(m: GraphMessage): MessageBody {
  const isHtml = (m.body?.contentType ?? "").toLowerCase() === "html";
  const headers: Record<string, string> = {};
  for (const h of m.internetMessageHeaders ?? []) headers[h.name.toLowerCase()] = h.value;
  return {
    id: m.id,
    html: isHtml ? m.body?.content ?? null : null,
    text: !isHtml ? m.body?.content ?? null : null,
    headers,
    attachments: (m.attachments ?? []).map((a): AttachmentMeta => ({
      id: a.id,
      filename: a.name ?? "attachment",
      mimeType: a.contentType ?? "application/octet-stream",
      size: a.size ?? 0,
      inline: Boolean(a.isInline),
      contentId: a.contentId ?? undefined,
    })),
  };
}

export function mapGraphFolders(folders: GraphFolder[]): Mailbox[] {
  return folders.map((f): Mailbox => ({
    id: f.id,
    name: f.displayName ?? f.wellKnownName ?? "Folder",
    kind: WELL_KNOWN_KIND[f.wellKnownName ?? ""] ?? "custom",
    unreadCount: f.unreadItemCount,
  }));
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/providers/ms-graph/graph-mappers.ts tests/fixtures/graph tests/providers/ms-graph
git commit -m "feat: add Microsoft Graph response mappers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: `providers/ms-graph/graph-provider.ts`

**Files:**
- Create: `src/providers/ms-graph/graph-provider.ts`
- Create: `tests/fixtures/graph/{messages-page.json,delta-page.json}`
- Test: `tests/providers/ms-graph/graph-provider.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, graph mappers, `MailProvider` + errors, `withRetry`, `runMailProviderContract`.
- Produces:
  - `interface GraphProviderDeps { http: HttpClient; getAccessToken: () => Promise<string>; baseUrl?: string; syncFolderIds?: string[] }`
  - `class GraphProvider implements MailProvider`.
- Behavior notes:
  - `listMessages(folderId, pageToken)` — `GET {base}/me/mailFolders/{folderId}/messages?$select=...&$top=25`; `pageToken` is the full `@odata.nextLink` URL (used verbatim when present).
  - `search(query, pageToken)` — `GET {base}/me/messages?$search="query"&$top=25`.
  - `getMessageBody(id)` — `GET {base}/me/messages/{id}?$expand=attachments`.
  - `getAttachment(messageId, attachmentId)` — `GET {base}/me/messages/{messageId}/attachments/{attachmentId}` → decode `contentBytes` (standard base64).
  - `initialCursor()` — for each folder in `syncFolderIds` (default: resolve inbox+sent+drafts+archive ids from `listMailboxes()`), call the delta endpoint until `@odata.deltaLink`, store `{ folderId: deltaLink }`. Discard the message items from the initial delta (backfill uses `listMessages`).
  - `syncSince(cursor)` — for each stored deltaLink, follow it, paginate `@odata.nextLink`, collect changed messages as upserts and `@removed` entries as deletions, store the new `@odata.deltaLink`.

- [ ] **Step 1: Create fixtures**

`tests/fixtures/graph/messages-page.json`:
```json
{ "value": [
    { "id": "G1", "conversationId": "C1", "subject": "one", "receivedDateTime": "2026-09-01T00:00:00Z", "isRead": false },
    { "id": "G2", "conversationId": "C2", "subject": "two", "receivedDateTime": "2026-09-02T00:00:00Z", "isRead": true }
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders/AAAInbox/messages?$skiptoken=PAGE2" }
```

`tests/fixtures/graph/delta-page.json`:
```json
{ "value": [
    { "id": "G3", "conversationId": "C3", "subject": "new", "receivedDateTime": "2026-09-04T00:00:00Z", "isRead": false },
    { "id": "G1", "@removed": { "reason": "deleted" } }
  ],
  "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/AAAInbox/messages/delta?$deltatoken=NEXT" }
```

- [ ] **Step 2: Write failing tests**

`tests/providers/ms-graph/graph-provider.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GraphProvider } from "../../../src/providers/ms-graph/graph-provider";
import { runMailProviderContract } from "../../../src/providers/provider-contract";
import type { HttpClient, HttpResponse } from "../../../src/providers/http";

const fx = (p: string) => JSON.parse(readFileSync(`tests/fixtures/graph/${p}`, "utf8"));
const resp = (json: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse =>
  ({ status, json, text: JSON.stringify(json), arrayBuffer: new ArrayBuffer(0), headers });

describe("GraphProvider", () => {
  it("listMessages maps items and returns the nextLink as the page token", async () => {
    const http: HttpClient = { request: vi.fn(async () => resp(fx("messages-page.json"))) };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    const page = await p.listMessages("AAAInbox");
    expect(page.items.map((m) => m.id)).toEqual(["G1", "G2"]);
    expect(page.nextPageToken).toContain("$skiptoken=PAGE2");
  });

  it("follows a page token URL verbatim", async () => {
    const req = vi.fn(async () => resp({ value: [] }));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.listMessages("AAAInbox", "https://graph.microsoft.com/v1.0/x?$skiptoken=Z");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/x?$skiptoken=Z");
  });

  it("syncSince collects upserts and @removed deletions and stores the new deltaLink", async () => {
    const http: HttpClient = { request: vi.fn(async () => resp(fx("delta-page.json"))) };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    const result = await p.syncSince({
      kind: "ms-graph",
      deltaLinks: { AAAInbox: "https://graph.microsoft.com/v1.0/me/mailFolders/AAAInbox/messages/delta?$deltatoken=OLD" },
    });
    expect(result.upserts.map((m) => m.id)).toEqual(["G3"]);
    expect(result.deletions).toEqual(["G1"]);
    expect(result.cursor).toMatchObject({
      kind: "ms-graph",
      deltaLinks: { AAAInbox: expect.stringContaining("$deltatoken=NEXT") },
    });
  });

  it("throws AuthError on 401", async () => {
    const http: HttpClient = { request: vi.fn(async () => resp({}, 401)) };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    await expect(p.listMailboxes()).rejects.toMatchObject({ name: "AuthError" });
  });
});

runMailProviderContract("GraphProvider", async () => {
  const msgs = new Map<string, Record<string, unknown>>();
  const deltaLog: Array<{ seq: number; id: string; removed?: boolean }> = [];
  let seq = 0;
  const seedInbox = async (n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `X${msgs.size + 1}`;
      seq++;
      msgs.set(id, { id, conversationId: id, subject: id, receivedDateTime: new Date(seq * 1000).toISOString(), isRead: false });
      deltaLog.push({ seq, id });
      ids.push(id);
    }
    return ids;
  };
  const http: HttpClient = {
    request: vi.fn(async ({ url }) => {
      if (/\/mailFolders(\?|$)/.test(url) || /\/mailFolders$/.test(url)) {
        return resp({ value: [{ id: "AAAInbox", displayName: "Inbox", wellKnownName: "inbox" }] });
      }
      if (/messages\/delta/.test(url)) {
        const since = Number(new URL(url).searchParams.get("$deltatoken") ?? 0);
        const value = deltaLog.filter((e) => e.seq > since).map((e) =>
          e.removed ? { id: e.id, "@removed": { reason: "deleted" } } : msgs.get(e.id),
        );
        return resp({ value, "@odata.deltaLink": `https://g/me/mailFolders/AAAInbox/messages/delta?$deltatoken=${seq}` });
      }
      // list messages
      const all = [...msgs.values()];
      const u = new URL(url);
      const skip = Number(u.searchParams.get("$skiptoken") ?? 0);
      const slice = all.slice(skip, skip + 2);
      const body: Record<string, unknown> = { value: slice };
      if (skip + 2 < all.length) body["@odata.nextLink"] = `https://g/me/mailFolders/AAAInbox/messages?$skiptoken=${skip + 2}`;
      return resp(body);
    }),
  };
  const provider = new GraphProvider({ http, getAccessToken: async () => "at", syncFolderIds: ["AAAInbox"] });
  return { provider, seedInbox };
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement `src/providers/ms-graph/graph-provider.ts`**

```ts
import { AuthError, ProviderError } from "../types";
import type { MailProvider, Mailbox, MessageBody, MessageSummary, Page, SyncCursor, SyncResult } from "../types";
import type { HttpClient, HttpResponse } from "../http";
import { withRetry, parseRetryAfter, type RetryableResult } from "../../util/backoff";
import { mapGraphBody, mapGraphFolders, mapGraphSummary, type GraphMessage } from "./graph-mappers";

export interface GraphProviderDeps {
  http: HttpClient;
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  syncFolderIds?: string[];
}

const DEFAULT_BASE = "https://graph.microsoft.com/v1.0";
const SUMMARY_SELECT =
  "id,conversationId,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,flag";
const TOP = 25;

export class GraphProvider implements MailProvider {
  readonly kind = "ms-graph" as const;
  private base: string;

  constructor(private deps: GraphProviderDeps) {
    this.base = deps.baseUrl ?? DEFAULT_BASE;
  }

  private async get<T>(url: string): Promise<T> {
    const token = await this.deps.getAccessToken();
    const full = url.startsWith("http") ? url : `${this.base}${url}`;
    return withRetry<T>(async (): Promise<RetryableResult<T>> => {
      const res: HttpResponse = await this.deps.http.request({
        url: full,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        return { retry: false, value: Promise.reject(new AuthError(`Graph ${res.status}`)) as never };
      }
      if (res.status === 429 || res.status >= 500) {
        return {
          retry: true,
          afterMs: parseRetryAfter(res.headers["retry-after"], Date.now()),
          error: new ProviderError(`Graph ${res.status}`, res.status, true),
        };
      }
      if (res.status < 200 || res.status >= 300) {
        return { retry: false, value: Promise.reject(new ProviderError(`Graph ${res.status}`, res.status)) as never };
      }
      return { retry: false, value: res.json as T };
    }, { retries: 4, baseMs: 500, maxMs: 8000 });
  }

  async listMailboxes(): Promise<Mailbox[]> {
    const data = await this.get<{ value?: Parameters<typeof mapGraphFolders>[0] }>(
      "/me/mailFolders?$top=100",
    );
    return mapGraphFolders(data.value ?? []);
  }

  async listMessages(folderId: string, pageToken?: string): Promise<Page<MessageSummary>> {
    const url = pageToken
      ? pageToken
      : `/me/mailFolders/${folderId}/messages?$select=${SUMMARY_SELECT}&$top=${TOP}`;
    const data = await this.get<{ value?: GraphMessage[]; "@odata.nextLink"?: string }>(url);
    return {
      items: (data.value ?? []).map((m) => mapGraphSummary(m, folderId)),
      nextPageToken: data["@odata.nextLink"],
    };
  }

  async search(query: string, pageToken?: string): Promise<Page<MessageSummary>> {
    const url = pageToken
      ? pageToken
      : `/me/messages?$search=${encodeURIComponent(`"${query}"`)}&$select=${SUMMARY_SELECT}&$top=${TOP}`;
    const data = await this.get<{ value?: GraphMessage[]; "@odata.nextLink"?: string }>(url);
    return {
      items: (data.value ?? []).map((m) => mapGraphSummary(m, "")),
      nextPageToken: data["@odata.nextLink"],
    };
  }

  async getMessageBody(id: string): Promise<MessageBody> {
    return mapGraphBody(await this.get<GraphMessage>(`/me/messages/${id}?$expand=attachments`));
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer> {
    const data = await this.get<{ contentBytes?: string }>(
      `/me/messages/${messageId}/attachments/${attachmentId}`,
    );
    const bin = atob(data.contentBytes ?? "");
    return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
  }

  private async syncFolders(): Promise<string[]> {
    if (this.deps.syncFolderIds?.length) return this.deps.syncFolderIds;
    const boxes = await this.listMailboxes();
    return boxes
      .filter((b) => ["inbox", "sent", "drafts", "archive"].includes(b.kind))
      .map((b) => b.id);
  }

  async initialCursor(): Promise<SyncCursor> {
    const deltaLinks: Record<string, string> = {};
    for (const folderId of await this.syncFolders()) {
      let url = `/me/mailFolders/${folderId}/messages/delta?$select=${SUMMARY_SELECT}&$top=${TOP}`;
      // Walk to the deltaLink; discard items (backfill uses listMessages).
      // Guard against unbounded loops.
      for (let i = 0; i < 1000; i++) {
        const data = await this.get<{ "@odata.nextLink"?: string; "@odata.deltaLink"?: string }>(url);
        if (data["@odata.deltaLink"]) { deltaLinks[folderId] = data["@odata.deltaLink"]; break; }
        if (!data["@odata.nextLink"]) break;
        url = data["@odata.nextLink"];
      }
    }
    return { kind: "ms-graph", deltaLinks };
  }

  async syncSince(cursor: SyncCursor): Promise<SyncResult> {
    if (cursor.kind !== "ms-graph") throw new ProviderError("wrong cursor kind for Graph");
    const upserts: MessageSummary[] = [];
    const deletions: string[] = [];
    const newDeltaLinks: Record<string, string> = { ...cursor.deltaLinks };

    for (const [folderId, deltaLink] of Object.entries(cursor.deltaLinks)) {
      let url: string = deltaLink;
      for (let i = 0; i < 1000; i++) {
        const data = await this.get<{
          value?: Array<GraphMessage & { "@removed"?: unknown }>;
          "@odata.nextLink"?: string;
          "@odata.deltaLink"?: string;
        }>(url);
        for (const item of data.value ?? []) {
          if (item["@removed"]) deletions.push(item.id);
          else upserts.push(mapGraphSummary(item, folderId));
        }
        if (data["@odata.deltaLink"]) { newDeltaLinks[folderId] = data["@odata.deltaLink"]; break; }
        if (!data["@odata.nextLink"]) break;
        url = data["@odata.nextLink"];
      }
    }

    const deleted = new Set(deletions);
    return {
      upserts: upserts.filter((m) => !deleted.has(m.id)),
      deletions,
      mailboxChanges: [],
      cursor: { kind: "ms-graph", deltaLinks: newDeltaLinks },
    };
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- ms-graph`

- [ ] **Step 6: Commit**

```bash
git add src/providers/ms-graph/graph-provider.ts tests/fixtures/graph tests/providers/ms-graph/graph-provider.test.ts
git commit -m "feat: add GraphProvider (list, body, attachment, search, delta sync)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: `providers/provider-factory.ts` + Obsidian `HttpClient` impl

**Files:**
- Create: `src/providers/obsidian-http.ts`, `src/providers/provider-factory.ts`
- Test: `tests/providers/provider-factory.test.ts`

**Interfaces:**
- Consumes: `GmailProvider`, `GraphProvider`, `TokenManager`, `HttpClient`, `AccountConfig` (defined here, re-exported by settings in Task 19).
- Produces:
  - `src/providers/obsidian-http.ts`: `function makeObsidianHttp(requestUrl: RequestUrlFn): HttpClient` where `RequestUrlFn` matches Obsidian's `requestUrl` signature (`{ url, method?, headers?, body?, throw: false }` → `{ status, json, text, arrayBuffer, headers }`).
  - `src/providers/provider-factory.ts`:
    - `interface AccountConfig { id: string; email: string; provider: ProviderKind; clientId: string; addedAt: number }`
    - `function createProvider(account: AccountConfig, token: TokenManager, http: HttpClient): MailProvider`

- [ ] **Step 1: Write failing test**

`tests/providers/provider-factory.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createProvider } from "../../src/providers/provider-factory";
import { makeObsidianHttp } from "../../src/providers/obsidian-http";
import { GmailProvider } from "../../src/providers/gmail/gmail-provider";
import { GraphProvider } from "../../src/providers/ms-graph/graph-provider";
import type { TokenManager } from "../../src/auth/token-manager";

const fakeToken = { getAccessToken: async () => "at" } as unknown as TokenManager;
const fakeHttp = { request: vi.fn() };

describe("createProvider", () => {
  it("returns a GmailProvider for gmail accounts", () => {
    const p = createProvider(
      { id: "1", email: "a@g.com", provider: "gmail", clientId: "c", addedAt: 0 },
      fakeToken, fakeHttp,
    );
    expect(p).toBeInstanceOf(GmailProvider);
    expect(p.kind).toBe("gmail");
  });

  it("returns a GraphProvider for ms-graph accounts", () => {
    const p = createProvider(
      { id: "2", email: "a@o.com", provider: "ms-graph", clientId: "c", addedAt: 0 },
      fakeToken, fakeHttp,
    );
    expect(p).toBeInstanceOf(GraphProvider);
  });
});

describe("makeObsidianHttp", () => {
  it("adapts requestUrl and forces throw:false", async () => {
    const requestUrl = vi.fn().mockResolvedValue({
      status: 200, json: { ok: true }, text: "{}", arrayBuffer: new ArrayBuffer(0), headers: {},
    });
    const http = makeObsidianHttp(requestUrl as never);
    const res = await http.request({ url: "https://x", method: "GET" });
    expect(res.status).toBe(200);
    expect(requestUrl.mock.calls[0][0]).toMatchObject({ url: "https://x", method: "GET", throw: false });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/providers/obsidian-http.ts`**

```ts
import type { HttpClient, HttpResponse } from "./http";

export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}
export type RequestUrlFn = (p: RequestUrlParam) => Promise<{
  status: number;
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
  headers: Record<string, string>;
}>;

export function makeObsidianHttp(requestUrl: RequestUrlFn): HttpClient {
  return {
    async request(opts): Promise<HttpResponse> {
      const res = await requestUrl({ ...opts, throw: false });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers ?? {})) headers[k.toLowerCase()] = v;
      let json: unknown = undefined;
      try { json = res.json; } catch { json = undefined; }
      return { status: res.status, json, text: res.text, arrayBuffer: res.arrayBuffer, headers };
    },
  };
}
```

- [ ] **Step 4: Implement `src/providers/provider-factory.ts`**

```ts
import type { MailProvider, ProviderKind } from "./types";
import type { HttpClient } from "./http";
import type { TokenManager } from "../auth/token-manager";
import { GmailProvider } from "./gmail/gmail-provider";
import { GraphProvider } from "./ms-graph/graph-provider";

export interface AccountConfig {
  id: string;
  email: string;
  provider: ProviderKind;
  clientId: string;
  addedAt: number;
}

export function createProvider(
  account: AccountConfig,
  token: TokenManager,
  http: HttpClient,
): MailProvider {
  const getAccessToken = () => token.getAccessToken();
  if (account.provider === "gmail") return new GmailProvider({ http, getAccessToken });
  return new GraphProvider({ http, getAccessToken });
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/providers/obsidian-http.ts src/providers/provider-factory.ts tests/providers/provider-factory.test.ts
git commit -m "feat: add provider factory and Obsidian requestUrl HttpClient

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 16: `cache/schema.ts` and `cache/mail-cache.ts`

**Files:**
- Create: `src/cache/schema.ts`, `src/cache/mail-cache.ts`
- Test: `tests/cache/mail-cache.test.ts`

**Interfaces:**
- Consumes: `MessageSummary`, `MessageBody`, `Mailbox`, `SyncCursor` (Task 5); `AccountConfig` (Task 15); `idb`.
- Produces:
  - `src/cache/schema.ts`:
    - `const DB_NAME = "obsidian-email"`, `const DB_VERSION = 1`
    - `const RETENTION = { summaryDays: 90, summaryPerMailbox: 2000, bodyPerAccount: 200, bodyMaxAgeDays: 30 }`
    - `interface StoredMessage extends MessageSummary { key: string; accountId: string }` (key = `${accountId}/${id}`)
    - `interface StoredBody extends MessageBody { key: string; accountId: string; cachedAt: number }`
    - `interface StoredMailbox extends Mailbox { key: string; accountId: string }`
    - `interface MailDb extends DBSchema { ... }` for `idb` typing
    - `async function openMailDb(name?: string): Promise<IDBPDatabase<MailDb>>`
  - `src/cache/mail-cache.ts`:
    - `class MailCache`
      - `static async open(name?: string): Promise<MailCache>`
      - `putMailboxes(accountId, boxes: Mailbox[]): Promise<void>`
      - `getMailboxes(accountId): Promise<Mailbox[]>`
      - `upsertMessages(accountId, msgs: MessageSummary[]): Promise<void>`
      - `deleteMessages(accountId, ids: string[]): Promise<void>`
      - `listMailboxMessages(accountId, mailboxId, opts?: { limit?: number; before?: number }): Promise<MessageSummary[]>` (newest-first, date-desc, mailbox membership filtered in JS)
      - `getThreadMessages(accountId, threadId): Promise<MessageSummary[]>`
      - `putBody(accountId, body: MessageBody): Promise<void>`
      - `getBody(accountId, id): Promise<MessageBody | undefined>`
      - `pruneAccount(accountId, now?: number): Promise<void>` (applies `RETENTION`)
      - `clearAccount(accountId): Promise<void>`
      - `clearAll(): Promise<void>`

- [ ] **Step 1: Write failing tests**

`tests/cache/mail-cache.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { MailCache } from "../../src/cache/mail-cache";
import type { MessageSummary } from "../../src/providers/types";

let n = 0;
const freshName = () => `test-db-${Date.now()}-${n++}`;

function msg(id: string, over: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id, threadId: over.threadId ?? id, mailboxIds: over.mailboxIds ?? ["INBOX"],
    from: { email: "s@x.com" }, to: [], cc: [],
    subject: `s ${id}`, snippet: "", date: over.date ?? 1000,
    unread: true, hasAttachments: false, flagged: false, ...over,
  };
}

describe("MailCache", () => {
  let cache: MailCache;
  beforeEach(async () => { cache = await MailCache.open(freshName()); });

  it("upserts and lists mailbox messages newest-first", async () => {
    await cache.upsertMessages("a1", [msg("m1", { date: 1 }), msg("m2", { date: 3 }), msg("m3", { date: 2 })]);
    const list = await cache.listMailboxMessages("a1", "INBOX");
    expect(list.map((m) => m.id)).toEqual(["m2", "m3", "m1"]);
  });

  it("filters by mailbox membership", async () => {
    await cache.upsertMessages("a1", [msg("m1", { mailboxIds: ["INBOX"] }), msg("m2", { mailboxIds: ["SENT"] })]);
    expect((await cache.listMailboxMessages("a1", "SENT")).map((m) => m.id)).toEqual(["m2"]);
  });

  it("isolates accounts", async () => {
    await cache.upsertMessages("a1", [msg("m1")]);
    await cache.upsertMessages("a2", [msg("m1")]);
    await cache.deleteMessages("a1", ["m1"]);
    expect(await cache.listMailboxMessages("a1", "INBOX")).toHaveLength(0);
    expect(await cache.listMailboxMessages("a2", "INBOX")).toHaveLength(1);
  });

  it("stores and returns thread messages", async () => {
    await cache.upsertMessages("a1", [msg("m1", { threadId: "t" }), msg("m2", { threadId: "t" }), msg("m3", { threadId: "u" })]);
    expect((await cache.getThreadMessages("a1", "t")).map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("stores and evicts bodies by LRU count", async () => {
    for (let i = 0; i < 205; i++) {
      await cache.putBody("a1", { id: `b${i}`, html: null, text: "x", attachments: [], headers: {} });
    }
    await cache.pruneAccount("a1", Date.now());
    expect(await cache.getBody("a1", "b0")).toBeUndefined();
    expect(await cache.getBody("a1", "b204")).toBeTruthy();
  });

  it("prunes summaries older than the retention window when over the per-mailbox cap", async () => {
    const now = Date.now();
    const old = now - 100 * 24 * 3600 * 1000;
    const many = Array.from({ length: 2001 }, (_, i) => msg(`m${i}`, { date: i < 5 ? old : now }));
    await cache.upsertMessages("a1", many);
    await cache.pruneAccount("a1", now);
    const list = await cache.listMailboxMessages("a1", "INBOX", { limit: 5000 });
    expect(list.find((m) => m.id === "m0")).toBeUndefined();
    expect(list.length).toBe(1996);
  });

  it("clearAccount removes messages, bodies and mailboxes for that account only", async () => {
    await cache.upsertMessages("a1", [msg("m1")]);
    await cache.putMailboxes("a1", [{ id: "INBOX", name: "Inbox", kind: "inbox" }]);
    await cache.upsertMessages("a2", [msg("m9")]);
    await cache.clearAccount("a1");
    expect(await cache.getMailboxes("a1")).toHaveLength(0);
    expect(await cache.listMailboxMessages("a2", "INBOX")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/cache/schema.ts`**

```ts
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Mailbox, MessageBody, MessageSummary, SyncCursor } from "../providers/types";

export const DB_NAME = "obsidian-email";
export const DB_VERSION = 1;

export const RETENTION = {
  summaryDays: 90,
  summaryPerMailbox: 2000,
  bodyPerAccount: 200,
  bodyMaxAgeDays: 30,
} as const;

export interface StoredMessage extends MessageSummary {
  key: string;       // `${accountId}/${id}`
  accountId: string;
}
export interface StoredBody extends MessageBody {
  key: string;
  accountId: string;
  cachedAt: number;
}
export interface StoredMailbox extends Mailbox {
  key: string;
  accountId: string;
}
export interface StoredCursor {
  accountId: string;
  cursor: SyncCursor;
  backfillDone: boolean;
}

export interface MailDb extends DBSchema {
  mailboxes: { key: string; value: StoredMailbox; indexes: { "by-account": string } };
  messages: {
    key: string;
    value: StoredMessage;
    indexes: { "by-account": string; "by-account-date": [string, number]; "by-account-thread": [string, string] };
  };
  bodies: { key: string; value: StoredBody; indexes: { "by-account": string; "by-account-cachedAt": [string, number] } };
  cursors: { key: string; value: StoredCursor };
  meta: { key: string; value: unknown };
}

export function openMailDb(name: string = DB_NAME): Promise<IDBPDatabase<MailDb>> {
  return openDB<MailDb>(name, DB_VERSION, {
    upgrade(db) {
      const mailboxes = db.createObjectStore("mailboxes", { keyPath: "key" });
      mailboxes.createIndex("by-account", "accountId");

      const messages = db.createObjectStore("messages", { keyPath: "key" });
      messages.createIndex("by-account", "accountId");
      messages.createIndex("by-account-date", ["accountId", "date"]);
      messages.createIndex("by-account-thread", ["accountId", "threadId"]);

      const bodies = db.createObjectStore("bodies", { keyPath: "key" });
      bodies.createIndex("by-account", "accountId");
      bodies.createIndex("by-account-cachedAt", ["accountId", "cachedAt"]);

      db.createObjectStore("cursors", { keyPath: "accountId" });
      db.createObjectStore("meta");
    },
  });
}
```

- [ ] **Step 4: Implement `src/cache/mail-cache.ts`**

```ts
import type { IDBPDatabase } from "idb";
import type { Mailbox, MessageBody, MessageSummary } from "../providers/types";
import { RETENTION, openMailDb, type MailDb, type StoredMessage } from "./schema";

const DAY_MS = 24 * 3600 * 1000;
const key = (accountId: string, id: string) => `${accountId}/${id}`;

export class MailCache {
  private constructor(private db: IDBPDatabase<MailDb>) {}

  static async open(name?: string): Promise<MailCache> {
    return new MailCache(await openMailDb(name));
  }

  async putMailboxes(accountId: string, boxes: Mailbox[]): Promise<void> {
    const tx = this.db.transaction("mailboxes", "readwrite");
    for (const b of boxes) {
      await tx.store.put({ ...b, key: key(accountId, b.id), accountId });
    }
    await tx.done;
  }

  async getMailboxes(accountId: string): Promise<Mailbox[]> {
    const rows = await this.db.getAllFromIndex("mailboxes", "by-account", accountId);
    return rows.map(({ key: _k, accountId: _a, ...box }) => box);
  }

  async upsertMessages(accountId: string, msgs: MessageSummary[]): Promise<void> {
    const tx = this.db.transaction("messages", "readwrite");
    for (const m of msgs) {
      const existing = await tx.store.get(key(accountId, m.id));
      const merged: StoredMessage = {
        ...m,
        // union mailbox membership so a label-change delta doesn't drop a folder
        mailboxIds: existing ? [...new Set([...m.mailboxIds])] : m.mailboxIds,
        key: key(accountId, m.id),
        accountId,
      };
      await tx.store.put(merged);
    }
    await tx.done;
  }

  async deleteMessages(accountId: string, ids: string[]): Promise<void> {
    const tx = this.db.transaction("messages", "readwrite");
    for (const id of ids) await tx.store.delete(key(accountId, id));
    await tx.done;
  }

  async listMailboxMessages(
    accountId: string,
    mailboxId: string,
    opts: { limit?: number; before?: number } = {},
  ): Promise<MessageSummary[]> {
    const limit = opts.limit ?? 50;
    const out: MessageSummary[] = [];
    const range = IDBKeyRange.bound(
      [accountId, -Infinity],
      [accountId, opts.before ?? Infinity],
      false,
      true,
    );
    let cursor = await this.db
      .transaction("messages")
      .store.index("by-account-date")
      .openCursor(range, "prev");
    while (cursor && out.length < limit) {
      const v = cursor.value;
      if (v.mailboxIds.includes(mailboxId)) {
        const { key: _k, accountId: _a, ...summary } = v;
        out.push(summary);
      }
      cursor = await cursor.continue();
    }
    return out;
  }

  async getThreadMessages(accountId: string, threadId: string): Promise<MessageSummary[]> {
    const rows = await this.db.getAllFromIndex("messages", "by-account-thread", [accountId, threadId]);
    return rows
      .map(({ key: _k, accountId: _a, ...s }) => s)
      .sort((a, b) => a.date - b.date);
  }

  async putBody(accountId: string, body: MessageBody): Promise<void> {
    await this.db.put("bodies", { ...body, key: key(accountId, body.id), accountId, cachedAt: Date.now() });
  }

  async getBody(accountId: string, id: string): Promise<MessageBody | undefined> {
    const row = await this.db.get("bodies", key(accountId, id));
    if (!row) return undefined;
    const { key: _k, accountId: _a, cachedAt: _c, ...body } = row;
    return body;
  }

  async pruneAccount(accountId: string, now: number = Date.now()): Promise<void> {
    await this.pruneSummaries(accountId, now);
    await this.pruneBodies(accountId, now);
  }

  private async pruneSummaries(accountId: string, now: number): Promise<void> {
    const rows = await this.db.getAllFromIndex("messages", "by-account", accountId);
    const perMailbox = new Map<string, number>();
    for (const r of rows) for (const mb of r.mailboxIds) perMailbox.set(mb, (perMailbox.get(mb) ?? 0) + 1);
    const overCap = [...perMailbox.values()].some((c) => c > RETENTION.summaryPerMailbox);
    if (!overCap) return;
    const cutoff = now - RETENTION.summaryDays * DAY_MS;
    const tx = this.db.transaction("messages", "readwrite");
    for (const r of rows) if (r.date < cutoff) await tx.store.delete(r.key);
    await tx.done;
  }

  private async pruneBodies(accountId: string, now: number): Promise<void> {
    const rows = (await this.db.getAllFromIndex("bodies", "by-account", accountId))
      .sort((a, b) => b.cachedAt - a.cachedAt);
    const ageCutoff = now - RETENTION.bodyMaxAgeDays * DAY_MS;
    const tx = this.db.transaction("bodies", "readwrite");
    for (let i = 0; i < rows.length; i++) {
      if (i >= RETENTION.bodyPerAccount || rows[i].cachedAt < ageCutoff) {
        await tx.store.delete(rows[i].key);
      }
    }
    await tx.done;
  }

  async clearAccount(accountId: string): Promise<void> {
    for (const storeName of ["messages", "bodies", "mailboxes"] as const) {
      const tx = this.db.transaction(storeName, "readwrite");
      const keys = await tx.store.index("by-account").getAllKeys(accountId);
      for (const k of keys) await tx.store.delete(k);
      await tx.done;
    }
    await this.db.delete("cursors", accountId);
  }

  async clearAll(): Promise<void> {
    for (const storeName of ["messages", "bodies", "mailboxes", "cursors", "meta"] as const) {
      await this.db.clear(storeName);
    }
  }
}
```

Note: `fake-indexeddb/auto` (loaded in `tests/setup.ts`) provides `IDBKeyRange` and `indexedDB` globals.

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- cache/mail-cache`

- [ ] **Step 6: Commit**

```bash
git add src/cache/ tests/cache/
git commit -m "feat: add IndexedDB mail cache with retention pruning

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 17: `cache/cursor-store.ts`

**Files:**
- Create: `src/cache/cursor-store.ts`
- Test: `tests/cache/cursor-store.test.ts`

**Interfaces:**
- Consumes: `openMailDb` / `MailDb` (Task 16), `SyncCursor` (Task 5).
- Produces:
  - `class CursorStore`
    - `static async open(name?: string): Promise<CursorStore>`
    - `get(accountId): Promise<{ cursor: SyncCursor; backfillDone: boolean } | undefined>`
    - `set(accountId, cursor: SyncCursor, backfillDone: boolean): Promise<void>`
    - `delete(accountId): Promise<void>`

- [ ] **Step 1: Write failing tests**

`tests/cache/cursor-store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CursorStore } from "../../src/cache/cursor-store";

const name = () => `cursor-db-${Date.now()}-${Math.random()}`;

describe("CursorStore", () => {
  it("round-trips a gmail cursor", async () => {
    const s = await CursorStore.open(name());
    await s.set("a1", { kind: "gmail", historyId: "42" }, false);
    expect(await s.get("a1")).toEqual({ cursor: { kind: "gmail", historyId: "42" }, backfillDone: false });
  });

  it("overwrites and marks backfill done", async () => {
    const s = await CursorStore.open(name());
    await s.set("a1", { kind: "gmail", historyId: "1" }, false);
    await s.set("a1", { kind: "gmail", historyId: "9" }, true);
    expect(await s.get("a1")).toMatchObject({ backfillDone: true, cursor: { historyId: "9" } });
  });

  it("returns undefined for unknown accounts and deletes", async () => {
    const s = await CursorStore.open(name());
    expect(await s.get("nope")).toBeUndefined();
    await s.set("a1", { kind: "ms-graph", deltaLinks: {} }, true);
    await s.delete("a1");
    expect(await s.get("a1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/cache/cursor-store.ts`**

```ts
import type { IDBPDatabase } from "idb";
import type { SyncCursor } from "../providers/types";
import { openMailDb, type MailDb } from "./schema";

export class CursorStore {
  private constructor(private db: IDBPDatabase<MailDb>) {}

  static async open(name?: string): Promise<CursorStore> {
    return new CursorStore(await openMailDb(name));
  }

  async get(accountId: string): Promise<{ cursor: SyncCursor; backfillDone: boolean } | undefined> {
    const row = await this.db.get("cursors", accountId);
    return row ? { cursor: row.cursor, backfillDone: row.backfillDone } : undefined;
  }

  async set(accountId: string, cursor: SyncCursor, backfillDone: boolean): Promise<void> {
    await this.db.put("cursors", { accountId, cursor, backfillDone });
  }

  async delete(accountId: string): Promise<void> {
    await this.db.delete("cursors", accountId);
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/cache/cursor-store.ts tests/cache/cursor-store.test.ts
git commit -m "feat: add sync cursor store

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 18: `sync/emitter.ts` and `sync/sync-engine.ts`

**Files:**
- Create: `src/sync/emitter.ts`, `src/sync/sync-engine.ts`
- Test: `tests/sync/sync-engine.test.ts`

**Interfaces:**
- Consumes: `MailProvider` (Task 5), `MailCache` (Task 16), `CursorStore` (Task 17), `AuthError` (Task 5), `Logger` (Task 3).
- Produces:
  - `src/sync/emitter.ts`: `class Emitter<E> { on(fn: (e: E) => void): () => void; emit(e: E): void }`
  - `src/sync/sync-engine.ts`:
    - `type SyncStatus = "idle" | "syncing" | "needs-reauth" | "error"`
    - `interface CacheChange { accountId: string; mailboxIds: string[]; reason: "backfill" | "incremental" }`
    - `interface AccountState { accountId: string; status: SyncStatus; lastSyncMs?: number; lastError?: string }`
    - `interface SyncEngineDeps { cache: MailCache; cursors: CursorStore; getProvider: (accountId: string) => MailProvider | undefined; listAccountIds: () => string[]; logger: Logger; now?: () => number; backfillMailboxKinds?: string[] }`
    - `class SyncEngine`
      - `readonly changes: Emitter<CacheChange>`
      - `readonly states: Emitter<AccountState>`
      - `getState(accountId): AccountState`
      - `start(intervalMs: number | null): void` / `stop(): void` / `setInterval(intervalMs: number | null): void`
      - `syncAccount(accountId: string): Promise<void>` — single-flight; backfill if no/incomplete cursor, else incremental
      - `syncAll(): Promise<void>`

- [ ] **Step 1: Write failing tests**

`tests/sync/sync-engine.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { SyncEngine } from "../../src/sync/sync-engine";
import { MailCache } from "../../src/cache/mail-cache";
import { CursorStore } from "../../src/cache/cursor-store";
import { FakeProvider } from "../../src/providers/fake-provider";
import { Logger } from "../../src/util/logger";
import { AuthError } from "../../src/providers/types";
import type { MailProvider, MessageSummary } from "../../src/providers/types";

const logger = new Logger("test", { debug: () => false });
const dbName = () => `sync-db-${Date.now()}-${Math.random()}`;

function summary(id: string, date: number): MessageSummary {
  return {
    id, threadId: id, mailboxIds: ["INBOX"], from: { email: "s@x.com" }, to: [], cc: [],
    subject: id, snippet: "", date, unread: true, hasAttachments: false, flagged: false,
  };
}

async function harness(provider: MailProvider) {
  const name = dbName();
  const cache = await MailCache.open(name);
  const cursors = await CursorStore.open(name);
  const engine = new SyncEngine({
    cache, cursors,
    getProvider: () => provider,
    listAccountIds: () => ["a1"],
    logger,
  });
  return { cache, cursors, engine };
}

describe("SyncEngine", () => {
  it("backfills on first sync then persists a cursor with backfillDone", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    provider.addMessage(summary("m1", 1));
    provider.addMessage(summary("m2", 2));
    const { cache, cursors, engine } = await harness(provider);
    await engine.syncAccount("a1");
    expect((await cache.listMailboxMessages("a1", "INBOX")).map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect(await cursors.get("a1")).toMatchObject({ backfillDone: true });
  });

  it("applies incremental upserts and deletions after backfill", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    provider.addMessage(summary("m1", 1));
    const { cache, engine } = await harness(provider);
    await engine.syncAccount("a1");
    provider.addMessage(summary("m2", 2));
    provider.removeMessage("m1");
    await engine.syncAccount("a1");
    expect((await cache.listMailboxMessages("a1", "INBOX")).map((m) => m.id)).toEqual(["m2"]);
  });

  it("emits a CacheChange after a sync", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    provider.addMessage(summary("m1", 1));
    const { engine } = await harness(provider);
    const seen: unknown[] = [];
    engine.changes.on((e) => seen.push(e));
    await engine.syncAccount("a1");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ accountId: "a1", reason: "backfill" });
  });

  it("dedupes concurrent syncAccount calls", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    const spy = vi.spyOn(provider, "listMessages");
    provider.addMessage(summary("m1", 1));
    const { engine } = await harness(provider);
    await Promise.all([engine.syncAccount("a1"), engine.syncAccount("a1")]);
    // one backfill worth of listMessages calls, not two
    const firstRunCalls = spy.mock.calls.length;
    await engine.syncAccount("a1"); // now incremental, no listMessages
    expect(spy.mock.calls.length).toBe(firstRunCalls);
  });

  it("sets needs-reauth on AuthError and does not throw", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    vi.spyOn(provider, "listMailboxes").mockRejectedValue(new AuthError("revoked"));
    vi.spyOn(provider, "listMessages").mockRejectedValue(new AuthError("revoked"));
    vi.spyOn(provider, "initialCursor").mockRejectedValue(new AuthError("revoked"));
    const { engine } = await harness(provider);
    await engine.syncAccount("a1");
    expect(engine.getState("a1").status).toBe("needs-reauth");
  });

  it("sets error status on a transient failure", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    vi.spyOn(provider, "initialCursor").mockRejectedValue(new Error("network"));
    vi.spyOn(provider, "listMessages").mockRejectedValue(new Error("network"));
    vi.spyOn(provider, "listMailboxes").mockRejectedValue(new Error("network"));
    const { engine } = await harness(provider);
    await engine.syncAccount("a1");
    expect(engine.getState("a1").status).toBe("error");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/sync/emitter.ts`**

```ts
export class Emitter<E> {
  private listeners = new Set<(e: E) => void>();

  on(fn: (e: E) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: E): void {
    for (const fn of [...this.listeners]) {
      try { fn(e); } catch { /* listener errors must not break the emitter */ }
    }
  }
}
```

- [ ] **Step 4: Implement `src/sync/sync-engine.ts`**

```ts
import { AuthError } from "../providers/types";
import type { MailProvider, SyncCursor } from "../providers/types";
import type { MailCache } from "../cache/mail-cache";
import type { CursorStore } from "../cache/cursor-store";
import type { Logger } from "../util/logger";
import { Emitter } from "./emitter";

export type SyncStatus = "idle" | "syncing" | "needs-reauth" | "error";

export interface CacheChange {
  accountId: string;
  mailboxIds: string[];
  reason: "backfill" | "incremental";
}

export interface AccountState {
  accountId: string;
  status: SyncStatus;
  lastSyncMs?: number;
  lastError?: string;
}

export interface SyncEngineDeps {
  cache: MailCache;
  cursors: CursorStore;
  getProvider: (accountId: string) => MailProvider | undefined;
  listAccountIds: () => string[];
  logger: Logger;
  now?: () => number;
  backfillMailboxKinds?: string[];
}

const BACKFILL_KINDS = ["inbox", "sent", "drafts", "archive"];
const BACKFILL_PAGE_CAP = 8; // pages per mailbox during backfill

export class SyncEngine {
  readonly changes = new Emitter<CacheChange>();
  readonly states = new Emitter<AccountState>();

  private inFlight = new Map<string, Promise<void>>();
  private state = new Map<string, AccountState>();
  private timer?: ReturnType<typeof setInterval>;
  private now: () => number;

  constructor(private deps: SyncEngineDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  getState(accountId: string): AccountState {
    return this.state.get(accountId) ?? { accountId, status: "idle" };
  }

  private setState(accountId: string, patch: Partial<AccountState>): void {
    const next: AccountState = { ...this.getState(accountId), accountId, ...patch };
    this.state.set(accountId, next);
    this.states.emit(next);
  }

  setInterval(intervalMs: number | null): void {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    if (intervalMs && intervalMs > 0) {
      this.timer = setInterval(() => void this.syncAll(), intervalMs);
    }
  }

  start(intervalMs: number | null): void {
    void this.syncAll();
    this.setInterval(intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async syncAll(): Promise<void> {
    await Promise.all(this.deps.listAccountIds().map((id) => this.syncAccount(id)));
  }

  syncAccount(accountId: string): Promise<void> {
    const existing = this.inFlight.get(accountId);
    if (existing) return existing;
    const run = this.runSync(accountId).finally(() => this.inFlight.delete(accountId));
    this.inFlight.set(accountId, run);
    return run;
  }

  private async runSync(accountId: string): Promise<void> {
    const provider = this.deps.getProvider(accountId);
    if (!provider) return;
    this.setState(accountId, { status: "syncing" });
    try {
      const saved = await this.deps.cursors.get(accountId);
      if (!saved || !saved.backfillDone) {
        await this.backfill(accountId, provider);
      } else {
        await this.incremental(accountId, provider, saved.cursor);
      }
      this.setState(accountId, { status: "idle", lastSyncMs: this.now(), lastError: undefined });
    } catch (err) {
      if (err instanceof AuthError) {
        this.deps.logger.warn(`account ${accountId} needs reauth`, err.message);
        this.setState(accountId, { status: "needs-reauth", lastError: err.message });
      } else {
        this.deps.logger.error(`sync failed for ${accountId}`, (err as Error).message);
        this.setState(accountId, { status: "error", lastError: (err as Error).message });
      }
    }
  }

  private async backfill(accountId: string, provider: MailProvider): Promise<void> {
    const boxes = await provider.listMailboxes();
    await this.deps.cache.putMailboxes(accountId, boxes);
    const kinds = this.deps.backfillMailboxKinds ?? BACKFILL_KINDS;
    const target = boxes.filter((b) => kinds.includes(b.kind));
    const touched = new Set<string>();
    for (const box of target) {
      let token: string | undefined;
      for (let page = 0; page < BACKFILL_PAGE_CAP; page++) {
        const res = await provider.listMessages(box.id, token);
        if (res.items.length) {
          await this.deps.cache.upsertMessages(accountId, res.items);
          touched.add(box.id);
        }
        if (!res.nextPageToken) break;
        token = res.nextPageToken;
      }
    }
    const cursor = await provider.initialCursor();
    await this.deps.cursors.set(accountId, cursor, true);
    await this.deps.cache.pruneAccount(accountId, this.now());
    this.changes.emit({ accountId, mailboxIds: [...touched], reason: "backfill" });
  }

  private async incremental(accountId: string, provider: MailProvider, cursor: SyncCursor): Promise<void> {
    const result = await provider.syncSince(cursor);
    if (result.mailboxChanges.length) {
      await this.deps.cache.putMailboxes(accountId, result.mailboxChanges);
    }
    if (result.upserts.length) await this.deps.cache.upsertMessages(accountId, result.upserts);
    if (result.deletions.length) await this.deps.cache.deleteMessages(accountId, result.deletions);
    await this.deps.cursors.set(accountId, result.cursor, true);
    await this.deps.cache.pruneAccount(accountId, this.now());
    const mailboxIds = [
      ...new Set(result.upserts.flatMap((m) => m.mailboxIds)),
    ];
    this.changes.emit({ accountId, mailboxIds, reason: "incremental" });
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- sync/sync-engine`

- [ ] **Step 6: Commit**

```bash
git add src/sync/ tests/sync/
git commit -m "feat: add sync engine with backfill, incremental sync and status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 19: `settings/settings-store.ts`

**Files:**
- Create: `src/settings/settings-store.ts`
- Test: `tests/settings/settings-store.test.ts`

**Interfaces:**
- Consumes: `AccountConfig` (Task 15), `ProviderKind` (Task 5).
- Produces:
  - `interface Prefs { pollMinutes: number | null; autoLoadImages: boolean; attachmentDir: string | null; syncWindowDays: number; defaultAccountId: string | null; debug: boolean }`
  - `interface PluginSettings { schemaVersion: number; accounts: AccountConfig[]; prefs: Prefs }`
  - `const DEFAULT_SETTINGS: PluginSettings`
  - `interface PersistHost { loadData(): Promise<unknown>; saveData(data: unknown): Promise<void> }` (structural match for `Plugin`)
  - `class SettingsStore`
    - `static async load(host: PersistHost): Promise<SettingsStore>`
    - `get(): PluginSettings` (readonly snapshot)
    - `addAccount(a: AccountConfig): Promise<void>`
    - `removeAccount(id: string): Promise<void>`
    - `updatePrefs(patch: Partial<Prefs>): Promise<void>`
    - `pollIntervalMs(): number | null`
  - Migration: unknown/old `schemaVersion` → merge onto `DEFAULT_SETTINGS`.

- [ ] **Step 1: Write failing tests**

`tests/settings/settings-store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SettingsStore, DEFAULT_SETTINGS } from "../../src/settings/settings-store";

function host(initial: unknown = null) {
  let store = initial;
  return {
    saved: () => store,
    loadData: async () => store,
    saveData: async (d: unknown) => { store = d; },
  };
}

const acct = (id: string) =>
  ({ id, email: `${id}@x.com`, provider: "gmail" as const, clientId: "c", addedAt: 1 });

describe("SettingsStore", () => {
  it("returns defaults for an empty vault", async () => {
    const s = await SettingsStore.load(host());
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("adds and removes accounts, persisting each time", async () => {
    const h = host();
    const s = await SettingsStore.load(h);
    await s.addAccount(acct("a1"));
    await s.addAccount(acct("a2"));
    expect(s.get().accounts.map((a) => a.id)).toEqual(["a1", "a2"]);
    await s.removeAccount("a1");
    expect(s.get().accounts.map((a) => a.id)).toEqual(["a2"]);
    expect((h.saved() as { accounts: unknown[] }).accounts).toHaveLength(1);
  });

  it("clears defaultAccountId when that account is removed", async () => {
    const s = await SettingsStore.load(host());
    await s.addAccount(acct("a1"));
    await s.updatePrefs({ defaultAccountId: "a1" });
    await s.removeAccount("a1");
    expect(s.get().prefs.defaultAccountId).toBeNull();
  });

  it("merges partial persisted data onto defaults", async () => {
    const s = await SettingsStore.load(host({ schemaVersion: 0, accounts: [acct("x")] }));
    expect(s.get().prefs.pollMinutes).toBe(DEFAULT_SETTINGS.prefs.pollMinutes);
    expect(s.get().accounts).toHaveLength(1);
    expect(s.get().schemaVersion).toBe(DEFAULT_SETTINGS.schemaVersion);
  });

  it("computes poll interval in ms, or null when manual", async () => {
    const s = await SettingsStore.load(host());
    await s.updatePrefs({ pollMinutes: 5 });
    expect(s.pollIntervalMs()).toBe(300_000);
    await s.updatePrefs({ pollMinutes: null });
    expect(s.pollIntervalMs()).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/settings/settings-store.ts`**

```ts
import type { AccountConfig } from "../providers/provider-factory";

export interface Prefs {
  pollMinutes: number | null;
  autoLoadImages: boolean;
  attachmentDir: string | null;
  syncWindowDays: number;
  defaultAccountId: string | null;
  debug: boolean;
}

export interface PluginSettings {
  schemaVersion: number;
  accounts: AccountConfig[];
  prefs: Prefs;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  schemaVersion: 1,
  accounts: [],
  prefs: {
    pollMinutes: 5,
    autoLoadImages: false,
    attachmentDir: null,
    syncWindowDays: 90,
    defaultAccountId: null,
    debug: false,
  },
};

export interface PersistHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

function migrate(raw: unknown): PluginSettings {
  const obj = (raw ?? {}) as Partial<PluginSettings>;
  return {
    schemaVersion: DEFAULT_SETTINGS.schemaVersion,
    accounts: Array.isArray(obj.accounts) ? obj.accounts : [],
    prefs: { ...DEFAULT_SETTINGS.prefs, ...(obj.prefs ?? {}) },
  };
}

export class SettingsStore {
  private constructor(private host: PersistHost, private settings: PluginSettings) {}

  static async load(host: PersistHost): Promise<SettingsStore> {
    return new SettingsStore(host, migrate(await host.loadData()));
  }

  get(): PluginSettings {
    return structuredClone(this.settings);
  }

  private async persist(): Promise<void> {
    await this.host.saveData(this.settings);
  }

  async addAccount(a: AccountConfig): Promise<void> {
    this.settings.accounts = [...this.settings.accounts.filter((x) => x.id !== a.id), a];
    await this.persist();
  }

  async removeAccount(id: string): Promise<void> {
    this.settings.accounts = this.settings.accounts.filter((x) => x.id !== id);
    if (this.settings.prefs.defaultAccountId === id) this.settings.prefs.defaultAccountId = null;
    await this.persist();
  }

  async updatePrefs(patch: Partial<Prefs>): Promise<void> {
    this.settings.prefs = { ...this.settings.prefs, ...patch };
    await this.persist();
  }

  pollIntervalMs(): number | null {
    const m = this.settings.prefs.pollMinutes;
    return m && m > 0 ? m * 60_000 : null;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/settings/settings-store.ts tests/settings/settings-store.test.ts
git commit -m "feat: add settings store with account CRUD and migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 20: `auth/add-account.ts` — OAuth "add account" orchestration

**Files:**
- Create: `src/auth/add-account.ts`
- Test: `tests/auth/add-account.test.ts`

**Interfaces:**
- Consumes: `pkce.ts`, `oauth-client.ts`, `loopback-server.ts`, `token-manager.ts`, `provider-oauth-config.ts`, `AccountConfig`, `AuthError`.
- Produces:
  - `interface AddAccountDeps { post: HttpPost; secrets: SecretStore; openBrowser: (url: string) => void; now: () => number; makeLoopback?: (host: "127.0.0.1" | "localhost") => LoopbackLike; fetchProfileEmail: (kind: ProviderKind, accessToken: string, post: HttpPost) => Promise<string>; genId: () => string }`
  - `interface LoopbackLike { listen(): Promise<{ port: number; redirectUri: string }>; waitForCode(o?: { timeoutMs?: number }): Promise<{ code: string; state: string }>; close(): void }`
  - `async function addAccount(input: { kind: ProviderKind; clientId: string; clientSecret?: string }, deps: AddAccountDeps): Promise<{ account: AccountConfig; token: TokenManager }>`
  - Flow: new PKCE pair + state → loopback `listen()` → `buildAuthorizeUrl` → `openBrowser` → `waitForCode` → verify `state` (throw `AuthError` on mismatch) → `exchangeCode` → `token.storeInitialTokens` → `fetchProfileEmail` → build `AccountConfig`. `close()` the loopback in a `finally`.
  - `fetchProfileEmail` default impl: gmail → `GET https://gmail.googleapis.com/gmail/v1/users/me/profile`; ms-graph → `GET https://graph.microsoft.com/v1.0/me` (`mail` || `userPrincipalName`). (Provided as `defaultFetchProfileEmail` using a `HttpClient`.)

- [ ] **Step 1: Write failing tests**

`tests/auth/add-account.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { addAccount } from "../../src/auth/add-account";
import { buildAuthorizeUrl } from "../../src/auth/oauth-client";
import { OAUTH_CONFIG } from "../../src/auth/provider-oauth-config";
import { AuthError } from "../../src/providers/types";

function makeLoopbackFactory(codeResult: { code: string; state: string } | Error) {
  return () => ({
    listen: async () => ({ port: 5555, redirectUri: "http://127.0.0.1:5555" }),
    waitForCode: async () => {
      if (codeResult instanceof Error) throw codeResult;
      return codeResult;
    },
    close: vi.fn(),
  });
}

function baseDeps(over: Partial<Parameters<typeof addAccount>[1]> = {}) {
  return {
    post: vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
    }),
    secrets: { getSecret: vi.fn().mockResolvedValue(null), setSecret: vi.fn().mockResolvedValue(undefined) },
    openBrowser: vi.fn(),
    now: () => 0,
    fetchProfileEmail: vi.fn().mockResolvedValue("me@example.com"),
    genId: () => "acct-1",
    ...over,
  };
}

describe("addAccount", () => {
  it("completes the flow and returns an AccountConfig", async () => {
    const capturedState = { value: "" };
    const deps = baseDeps({
      openBrowser: (url: string) => { capturedState.value = new URL(url).searchParams.get("state")!; },
    });
    // The loopback must echo back the same state the authorize URL used.
    const factory = () => ({
      listen: async () => ({ port: 1, redirectUri: "http://127.0.0.1:1" }),
      waitForCode: async () => ({ code: "CODE", state: capturedState.value }),
      close: vi.fn(),
    });
    const { account } = await addAccount(
      { kind: "gmail", clientId: "cid", clientSecret: "sec" },
      { ...deps, makeLoopback: factory },
    );
    expect(account).toMatchObject({ id: "acct-1", email: "me@example.com", provider: "gmail", clientId: "cid" });
    expect(deps.openBrowser).toHaveBeenCalledOnce();
    const [, form] = (deps.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(form.code).toBe("CODE");
    expect(form.client_secret).toBe("sec");
  });

  it("stores the Google client secret via TokenManager", async () => {
    const capturedState = { value: "" };
    const deps = baseDeps({
      openBrowser: (url: string) => { capturedState.value = new URL(url).searchParams.get("state")!; },
    });
    const factory = () => ({
      listen: async () => ({ port: 1, redirectUri: "http://127.0.0.1:1" }),
      waitForCode: async () => ({ code: "C", state: capturedState.value }),
      close: vi.fn(),
    });
    await addAccount({ kind: "gmail", clientId: "cid", clientSecret: "goog" }, { ...deps, makeLoopback: factory });
    expect(deps.secrets.setSecret).toHaveBeenCalledWith("obsidian-email-acct-1:secret", "goog");
    expect(deps.secrets.setSecret).toHaveBeenCalledWith("obsidian-email-acct-1:refresh", "rt");
  });

  it("throws AuthError on a state mismatch and closes the loopback", async () => {
    const close = vi.fn();
    const factory = () => ({
      listen: async () => ({ port: 1, redirectUri: "http://127.0.0.1:1" }),
      waitForCode: async () => ({ code: "C", state: "WRONG" }),
      close,
    });
    await expect(
      addAccount({ kind: "ms-graph", clientId: "cid" }, { ...baseDeps(), makeLoopback: factory }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(close).toHaveBeenCalled();
  });

  it("builds a Microsoft authorize URL with the localhost redirect", async () => {
    const url = buildAuthorizeUrl(OAUTH_CONFIG["ms-graph"], {
      clientId: "c", redirectUri: "http://localhost:9", challenge: "x", state: "s",
    });
    expect(url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A9");
    expect(url).toContain("offline_access");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/auth/add-account.ts`**

```ts
import { AuthError } from "../providers/types";
import type { ProviderKind } from "../providers/types";
import type { AccountConfig } from "../providers/provider-factory";
import type { HttpClient } from "../providers/http";
import { newPkcePair, newState } from "./pkce";
import { OAUTH_CONFIG } from "./provider-oauth-config";
import { buildAuthorizeUrl, exchangeCode, type HttpPost } from "./oauth-client";
import { LoopbackServer } from "./loopback-server";
import { TokenManager, type SecretStore } from "./token-manager";

export interface LoopbackLike {
  listen(): Promise<{ port: number; redirectUri: string }>;
  waitForCode(o?: { timeoutMs?: number }): Promise<{ code: string; state: string }>;
  close(): void;
}

export interface AddAccountDeps {
  post: HttpPost;
  secrets: SecretStore;
  openBrowser: (url: string) => void;
  now: () => number;
  fetchProfileEmail: (kind: ProviderKind, accessToken: string, post: HttpPost) => Promise<string>;
  genId: () => string;
  makeLoopback?: (host: "127.0.0.1" | "localhost") => LoopbackLike;
}

export async function addAccount(
  input: { kind: ProviderKind; clientId: string; clientSecret?: string },
  deps: AddAccountDeps,
): Promise<{ account: AccountConfig; token: TokenManager }> {
  const cfg = OAUTH_CONFIG[input.kind];
  const make = deps.makeLoopback ?? ((host) => new LoopbackServer(host));
  const loopback = make(cfg.loopbackHost);
  try {
    const { redirectUri } = await loopback.listen();
    const { verifier, challenge } = await newPkcePair();
    const state = newState();
    const authorizeUrl = buildAuthorizeUrl(cfg, {
      clientId: input.clientId, redirectUri, challenge, state,
    });
    deps.openBrowser(authorizeUrl);
    const { code, state: returnedState } = await loopback.waitForCode();
    if (returnedState !== state) throw new AuthError("OAuth state mismatch; aborting.");

    const tokens = await exchangeCode(cfg, deps.post, {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      code,
      verifier,
      redirectUri,
    });

    const id = deps.genId();
    const token = new TokenManager(id, input.kind, input.clientId, {
      secrets: deps.secrets, post: deps.post, now: deps.now,
    });
    await token.storeInitialTokens(tokens, cfg.usesClientSecret ? input.clientSecret : undefined);

    const email = await deps.fetchProfileEmail(input.kind, tokens.accessToken, deps.post);
    const account: AccountConfig = {
      id, email, provider: input.kind, clientId: input.clientId, addedAt: deps.now(),
    };
    return { account, token };
  } finally {
    loopback.close();
  }
}

export function defaultFetchProfileEmail(http: HttpClient) {
  return async (kind: ProviderKind, accessToken: string): Promise<string> => {
    const auth = { Authorization: `Bearer ${accessToken}` };
    if (kind === "gmail") {
      const res = await http.request({
        url: "https://gmail.googleapis.com/gmail/v1/users/me/profile", method: "GET", headers: auth,
      });
      const j = (res.json ?? {}) as { emailAddress?: string };
      if (!j.emailAddress) throw new AuthError("Could not read the Gmail profile email.");
      return j.emailAddress;
    }
    const res = await http.request({
      url: "https://graph.microsoft.com/v1.0/me", method: "GET", headers: auth,
    });
    const j = (res.json ?? {}) as { mail?: string; userPrincipalName?: string };
    const email = j.mail ?? j.userPrincipalName;
    if (!email) throw new AuthError("Could not read the Microsoft profile email.");
    return email;
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/auth/add-account.ts tests/auth/add-account.test.ts
git commit -m "feat: add OAuth add-account orchestration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 21: `render/html-sanitizer.ts`

**Files:**
- Create: `src/render/html-sanitizer.ts`
- Test: `tests/render/html-sanitizer.test.ts`

**Interfaces:**
- Consumes: `dompurify`.
- Produces:
  - `interface SanitizeResult { html: string; blockedRemoteContent: boolean }`
  - `function sanitizeEmailHtml(raw: string, opts: { allowRemote: boolean }): SanitizeResult`
    - Always strips `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, event handlers, `javascript:` URLs, non-image `data:` URLs.
    - When `allowRemote` is false: replaces `http(s)` `img[src]` with a neutral placeholder (`src` removed, `data-blocked-src` kept), strips `style` `url(...)` with remote targets and `background`/`background-image` attributes; sets `blockedRemoteContent` true if anything was neutralized.
    - Forces `a[target=_blank]` + `rel="noopener noreferrer"` and copies `href` into `title` when no title is present.
  - `function restoreBlockedContent(container: HTMLElement): void` — swaps `data-blocked-src` → `src` in place (used by "load remote images").

- [ ] **Step 1: Write failing tests**

`tests/render/html-sanitizer.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml, restoreBlockedContent } from "../../src/render/html-sanitizer";

const clean = (raw: string, allowRemote = false) => sanitizeEmailHtml(raw, { allowRemote });

describe("sanitizeEmailHtml — security", () => {
  it("strips script tags", () => {
    expect(clean('<p>hi</p><script>alert(1)</script>').html).toBe("<p>hi</p>");
  });
  it("strips inline event handlers", () => {
    expect(clean('<img src="x" onerror="alert(1)">').html).not.toContain("onerror");
  });
  it("strips javascript: hrefs", () => {
    const r = clean('<a href="javascript:alert(1)">x</a>');
    expect(r.html).not.toContain("javascript:");
  });
  it("drops iframes, objects, forms", () => {
    const r = clean('<iframe src="https://e.com"></iframe><object></object><form></form>');
    expect(r.html).not.toMatch(/iframe|object|form/);
  });
  it("keeps benign formatting and tables", () => {
    const r = clean("<h1>T</h1><table><tr><td><b>x</b></td></tr></table>");
    expect(r.html).toContain("<table>");
    expect(r.html).toContain("<b>x</b>");
  });
});

describe("sanitizeEmailHtml — remote content", () => {
  it("blocks remote images by default and flags it", () => {
    const r = clean('<img src="https://tracker.example/pixel.gif">');
    expect(r.blockedRemoteContent).toBe(true);
    expect(r.html).not.toContain('src="https://tracker');
    expect(r.html).toContain("data-blocked-src");
  });
  it("allows inline data: images", () => {
    const r = clean('<img src="data:image/png;base64,AAAA">');
    expect(r.blockedRemoteContent).toBe(false);
    expect(r.html).toContain("data:image/png");
  });
  it("keeps remote images when allowRemote is true", () => {
    const r = clean('<img src="https://cdn.example/logo.png">', true);
    expect(r.blockedRemoteContent).toBe(false);
    expect(r.html).toContain("https://cdn.example/logo.png");
  });
  it("neutralizes remote url() in style attributes", () => {
    const r = clean('<div style="background-image:url(https://x.example/bg.png)">x</div>');
    expect(r.html).not.toContain("x.example");
  });
});

describe("sanitizeEmailHtml — links", () => {
  it("forces target and rel and mirrors href into title", () => {
    const r = clean('<a href="https://example.com/path">click</a>');
    expect(r.html).toContain('target="_blank"');
    expect(r.html).toContain('rel="noopener noreferrer"');
    expect(r.html).toContain('title="https://example.com/path"');
  });
});

describe("restoreBlockedContent", () => {
  it("swaps data-blocked-src back to src", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img data-blocked-src="https://cdn.example/a.png">';
    restoreBlockedContent(div);
    expect(div.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example/a.png");
    expect(div.querySelector("img")!.hasAttribute("data-blocked-src")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/render/html-sanitizer.ts`**

```ts
import DOMPurify from "dompurify";

export interface SanitizeResult {
  html: string;
  blockedRemoteContent: boolean;
}

const FORBID_TAGS = ["script", "iframe", "object", "embed", "form", "base", "meta", "link"];
const FORBID_ATTR = ["srcset", "ping", "background"];

function isRemote(url: string): boolean {
  return /^https?:/i.test(url.trim());
}

export function sanitizeEmailHtml(raw: string, opts: { allowRemote: boolean }): SanitizeResult {
  let blocked = false;

  const purify = DOMPurify(window);

  purify.addHook("uponSanitizeAttribute", (node, data) => {
    const name = data.attrName;
    const value = data.attrValue ?? "";

    // Neutralize remote url() in style attributes.
    if (name === "style" && /url\(\s*['"]?https?:/i.test(value)) {
      data.attrValue = value.replace(/url\(\s*['"]?https?:[^)]*\)/gi, "url()");
      if (!opts.allowRemote) blocked = true;
    }

    if (name === "src" && (node as Element).tagName === "IMG") {
      if (isRemote(value) && !opts.allowRemote) {
        blocked = true;
        (node as Element).setAttribute("data-blocked-src", value);
        data.attrValue = "";
        data.keepAttr = false;
      }
    }
  });

  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
      if (href && !node.getAttribute("title")) node.setAttribute("title", href);
    }
  });

  const html = purify.sanitize(raw, {
    FORBID_TAGS,
    FORBID_ATTR,
    ADD_ATTR: ["target", "data-blocked-src"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|data:image\/(?:png|jpe?g|gif|webp|bmp);|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  });

  purify.removeAllHooks();
  return { html, blockedRemoteContent: blocked };
}

export function restoreBlockedContent(container: HTMLElement): void {
  container.querySelectorAll<HTMLImageElement>("img[data-blocked-src]").forEach((img) => {
    const src = img.getAttribute("data-blocked-src")!;
    img.setAttribute("src", src);
    img.removeAttribute("data-blocked-src");
  });
}
```

Note: DOMPurify's default tag allow-list already drops `on*` handlers and unknown protocols; `ALLOWED_URI_REGEXP` above additionally permits `cid:` (resolved later) and inline `data:image/*` only. Verify the regex against the tests; adjust if a benign case fails.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/render/html-sanitizer.ts tests/render/html-sanitizer.test.ts
git commit -m "feat: add email HTML sanitizer with remote-content blocking

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 22: `render/message-renderer.ts`

**Files:**
- Create: `src/render/message-renderer.ts`
- Test: `tests/render/message-renderer.test.ts`

**Interfaces:**
- Consumes: `html-sanitizer.ts`, `MessageBody` + `AttachmentMeta` (Task 5).
- Produces:
  - `interface RenderDeps { getInlineAttachment: (contentId: string) => Promise<Blob | undefined>; openExternal: (url: string) => void }`
  - `interface RenderHandle { blockedRemoteContent: boolean; loadRemoteImages(): void; dispose(): void }`
  - `function renderMessageBody(container: HTMLElement, body: MessageBody, opts: { allowRemote: boolean }, deps: RenderDeps): RenderHandle`
    - Sanitizes `body.html` (or wraps `body.text` in `<pre>`), sets `container.innerHTML`, adds class `obsidian-email-message-body`.
    - Resolves `cid:` image refs against `body.attachments` (inline) via `getInlineAttachment` → `URL.createObjectURL`; tracks the object URLs and revokes them in `dispose()`.
    - Intercepts clicks on `a[href]` → `preventDefault` + `deps.openExternal(href)`.
    - `loadRemoteImages()` re-sanitizes with `allowRemote: true` and re-runs cid resolution + link binding.

- [ ] **Step 1: Write failing tests**

`tests/render/message-renderer.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { renderMessageBody } from "../../src/render/message-renderer";
import type { MessageBody } from "../../src/providers/types";

const body = (over: Partial<MessageBody> = {}): MessageBody => ({
  id: "m1", html: null, text: null, attachments: [], headers: {}, ...over,
});

const deps = () => ({
  getInlineAttachment: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  openExternal: vi.fn(),
});

describe("renderMessageBody", () => {
  it("renders plain text when there is no html", () => {
    const el = document.createElement("div");
    renderMessageBody(el, body({ text: "hello <b>not bold</b>" }), { allowRemote: false }, deps());
    expect(el.textContent).toContain("hello <b>not bold</b>");
    expect(el.querySelector("b")).toBeNull();
  });

  it("reports blocked remote content", () => {
    const el = document.createElement("div");
    const h = renderMessageBody(el, body({ html: '<img src="https://t.example/p.gif">' }), { allowRemote: false }, deps());
    expect(h.blockedRemoteContent).toBe(true);
  });

  it("loadRemoteImages swaps blocked images in", () => {
    const el = document.createElement("div");
    const h = renderMessageBody(el, body({ html: '<img src="https://cdn.example/l.png">' }), { allowRemote: false }, deps());
    h.loadRemoteImages();
    expect(el.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example/l.png");
  });

  it("resolves cid: images from inline attachments", async () => {
    const d = deps();
    const el = document.createElement("div");
    renderMessageBody(
      el,
      body({
        html: '<img src="cid:logo42">',
        attachments: [{ id: "a1", filename: "l.png", mimeType: "image/png", size: 1, inline: true, contentId: "logo42" }],
      }),
      { allowRemote: false },
      d,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(d.getInlineAttachment).toHaveBeenCalledWith("logo42");
    expect(el.querySelector("img")!.getAttribute("src")).toMatch(/^blob:|^data:/);
  });

  it("intercepts link clicks and calls openExternal", () => {
    const d = deps();
    const el = document.createElement("div");
    renderMessageBody(el, body({ html: '<a href="https://example.com">go</a>' }), { allowRemote: false }, d);
    el.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(d.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("dispose revokes created object URLs", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    const el = document.createElement("div");
    const h = renderMessageBody(
      el,
      body({
        html: '<img src="cid:c1">',
        attachments: [{ id: "a", filename: "x", mimeType: "image/png", size: 1, inline: true, contentId: "c1" }],
      }),
      { allowRemote: false },
      deps(),
    );
    await Promise.resolve(); await Promise.resolve();
    h.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:fake");
    revoke.mockRestore();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/render/message-renderer.ts`**

```ts
import type { MessageBody } from "../providers/types";
import { restoreBlockedContent, sanitizeEmailHtml } from "./html-sanitizer";

export interface RenderDeps {
  getInlineAttachment: (contentId: string) => Promise<Blob | undefined>;
  openExternal: (url: string) => void;
}

export interface RenderHandle {
  blockedRemoteContent: boolean;
  loadRemoteImages(): void;
  dispose(): void;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function renderMessageBody(
  container: HTMLElement,
  body: MessageBody,
  opts: { allowRemote: boolean },
  deps: RenderDeps,
): RenderHandle {
  container.classList.add("obsidian-email-message-body");
  const objectUrls: string[] = [];
  let disposed = false;

  const bindLinks = (): void => {
    container.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        deps.openExternal(a.getAttribute("href")!);
      });
    });
  };

  const resolveCids = (): void => {
    const inline = new Map(
      body.attachments.filter((a) => a.inline && a.contentId).map((a) => [a.contentId!, a]),
    );
    container.querySelectorAll<HTMLImageElement>('img[src^="cid:"]').forEach((img) => {
      const cid = img.getAttribute("src")!.slice(4).replace(/^<|>$/g, "");
      if (!inline.has(cid)) return;
      void deps.getInlineAttachment(cid).then((blob) => {
        if (disposed || !blob) return;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        img.setAttribute("src", url);
      });
    });
  };

  const paint = (allowRemote: boolean): boolean => {
    if (body.html) {
      const { html, blockedRemoteContent } = sanitizeEmailHtml(body.html, { allowRemote });
      container.innerHTML = html;
      bindLinks();
      resolveCids();
      return blockedRemoteContent;
    }
    container.innerHTML = `<pre class="obsidian-email-plaintext">${escapeHtml(body.text ?? "")}</pre>`;
    return false;
  };

  const blockedRemoteContent = paint(opts.allowRemote);

  return {
    blockedRemoteContent,
    loadRemoteImages(): void {
      // Fast path: if the DOM still has blocked markers, just swap them.
      if (container.querySelector("img[data-blocked-src]")) {
        restoreBlockedContent(container);
        bindLinks();
        return;
      }
      paint(true);
    },
    dispose(): void {
      disposed = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.length = 0;
      container.innerHTML = "";
    },
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/render/message-renderer.ts tests/render/message-renderer.test.ts
git commit -m "feat: add message renderer with cid resolution and link interception

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 23: `view/view-model.ts`

**Files:**
- Create: `src/view/view-model.ts`
- Test: `tests/view/view-model.test.ts`

**Interfaces:**
- Consumes: `MailCache` (Task 16), `SyncEngine` + `CacheChange` + `AccountState` (Task 18), `MailProvider` (Task 5), `AccountConfig` (Task 15), `SettingsStore` (Task 19).
- Produces (framework-agnostic; the Svelte layer subscribes):
  - `interface ThreadView { threadId: string; subject: string; lastDate: number; messages: MessageSummary[]; unread: boolean }`
  - `interface ViewState {`
    - `accounts: Array<{ id: string; email: string; provider: ProviderKind; status: SyncStatus }>`
    - `activeAccountId: string | null`
    - `mailboxes: Mailbox[]`
    - `activeMailboxId: string | null`
    - `threads: ThreadView[]`
    - `hasMore: boolean`
    - `loadingList: boolean`
    - `search: { query: string; active: boolean } `
    - `openThreadId: string | null`
    - `openMessages: Array<{ summary: MessageSummary; body?: MessageBody }>`
    - `notice: string | null`
  - `}`
  - `class ViewModel`
    - `constructor(deps: ViewModelDeps)` where `ViewModelDeps = { cache: MailCache; sync: SyncEngine; settings: SettingsStore; getProvider: (id: string) => MailProvider | undefined; isOnline: () => boolean }`
    - `subscribe(fn: (s: ViewState) => void): () => void` (emits current state immediately)
    - `getState(): ViewState`
    - `init(): Promise<void>` — load accounts, pick active (default or first), load mailboxes + first page
    - `selectAccount(id: string): Promise<void>`
    - `selectMailbox(id: string): Promise<void>`
    - `loadMore(): Promise<void>` — cache first; when cache is exhausted and `hasMore` from provider, fetch next provider page → cache → re-read
    - `openThread(threadId: string): Promise<void>` — load summaries from cache, lazy-load bodies via provider read-through (`cache.getBody` → `provider.getMessageBody` → `cache.putBody`)
    - `closeThread(): void`
    - `refresh(): Promise<void>` — `sync.syncAccount(active)`
    - `runSearch(query: string): Promise<void>` / `clearSearch(): Promise<void>` — provider `search`; offline → set `notice`
    - `dispose(): void` — unsubscribe from sync emitters
  - Threads are grouped from `MessageSummary[]` by `threadId`, newest thread first, `messages` sorted oldest→newest.

- [ ] **Step 1: Write failing tests**

`tests/view/view-model.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ViewModel } from "../../src/view/view-model";
import { MailCache } from "../../src/cache/mail-cache";
import { CursorStore } from "../../src/cache/cursor-store";
import { SyncEngine } from "../../src/sync/sync-engine";
import { SettingsStore } from "../../src/settings/settings-store";
import { FakeProvider } from "../../src/providers/fake-provider";
import { Logger } from "../../src/util/logger";
import type { MessageSummary } from "../../src/providers/types";

const logger = new Logger("t", { debug: () => false });
const name = () => `vm-db-${Date.now()}-${Math.random()}`;

function sum(id: string, threadId: string, date: number): MessageSummary {
  return {
    id, threadId, mailboxIds: ["INBOX"], from: { email: "s@x.com" }, to: [], cc: [],
    subject: `s ${threadId}`, snippet: "", date, unread: true, hasAttachments: false, flagged: false,
  };
}

async function build() {
  const dbName = name();
  const cache = await MailCache.open(dbName);
  const cursors = await CursorStore.open(dbName);
  const provider = new FakeProvider({ mailboxes: [
    { id: "INBOX", name: "Inbox", kind: "inbox" },
    { id: "SENT", name: "Sent", kind: "sent" },
  ] });
  const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
  await settings.addAccount({ id: "a1", email: "a1@x.com", provider: "gmail", clientId: "c", addedAt: 0 });
  const sync = new SyncEngine({
    cache, cursors, getProvider: () => provider, listAccountIds: () => ["a1"], logger,
  });
  const vm = new ViewModel({
    cache, sync, settings, getProvider: () => provider, isOnline: () => true,
  });
  return { cache, provider, sync, vm };
}

describe("ViewModel", () => {
  let ctx: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => { ctx = await build(); });

  it("init picks the first account, loads mailboxes and the first page grouped into threads", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [
      sum("m1", "t1", 1), sum("m2", "t1", 3), sum("m3", "t2", 2),
    ]);
    await ctx.vm.init();
    const s = ctx.vm.getState();
    expect(s.activeAccountId).toBe("a1");
    expect(s.mailboxes.map((m) => m.id)).toContain("INBOX");
    expect(s.threads.map((t) => t.threadId)).toEqual(["t1", "t2"]);
    expect(s.threads[0].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("selectMailbox reloads the list for that mailbox", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.cache.upsertMessages("a1", [{ ...sum("s1", "ts", 5), mailboxIds: ["SENT"] }]);
    await ctx.vm.init();
    await ctx.vm.selectMailbox("SENT");
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["ts"]);
  });

  it("openThread lazy-loads a body via read-through and caches it", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    const spy = vi.spyOn(ctx.provider, "getMessageBody");
    await ctx.vm.init();
    await ctx.vm.openThread("t1");
    expect(ctx.vm.getState().openMessages[0].body).toBeTruthy();
    expect(await ctx.cache.getBody("a1", "m1")).toBeTruthy();
    await ctx.vm.closeThread();
    await ctx.vm.openThread("t1");
    expect(spy).toHaveBeenCalledTimes(1); // second open hits the cache
  });

  it("runSearch replaces the list and clearSearch restores it", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    ctx.provider.setSearchResults("report", [sum("x1", "tx", 9)]);
    await ctx.vm.init();
    await ctx.vm.runSearch("report");
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["tx"]);
    expect(ctx.vm.getState().search).toEqual({ query: "report", active: true });
    await ctx.vm.clearSearch();
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
  });

  it("runSearch offline sets a notice and does not clear the list", async () => {
    const offlineVm = new ViewModel({
      cache: ctx.cache, sync: ctx.sync, settings: (ctx as never as { settings: SettingsStore }).settings ?? await SettingsStore.load({ loadData: async () => ({ accounts: [{ id: "a1", email: "e", provider: "gmail", clientId: "c", addedAt: 0 }] }), saveData: async () => {} }),
      getProvider: () => ctx.provider, isOnline: () => false,
    });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await offlineVm.init();
    await offlineVm.runSearch("anything");
    expect(offlineVm.getState().notice).toMatch(/offline/i);
    expect(offlineVm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
  });

  it("re-reads the list when the sync engine emits a change for the active mailbox", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    await ctx.cache.upsertMessages("a1", [sum("m2", "t2", 5)]);
    ctx.sync.changes.emit({ accountId: "a1", mailboxIds: ["INBOX"], reason: "incremental" });
    await Promise.resolve();
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/view/view-model.ts`**

```ts
import type { Mailbox, MailProvider, MessageBody, MessageSummary, ProviderKind } from "../providers/types";
import type { MailCache } from "../cache/mail-cache";
import type { SyncEngine, SyncStatus } from "../sync/sync-engine";
import type { SettingsStore } from "../settings/settings-store";

export interface ThreadView {
  threadId: string;
  subject: string;
  lastDate: number;
  messages: MessageSummary[];
  unread: boolean;
}

export interface ViewState {
  accounts: Array<{ id: string; email: string; provider: ProviderKind; status: SyncStatus }>;
  activeAccountId: string | null;
  mailboxes: Mailbox[];
  activeMailboxId: string | null;
  threads: ThreadView[];
  hasMore: boolean;
  loadingList: boolean;
  search: { query: string; active: boolean };
  openThreadId: string | null;
  openMessages: Array<{ summary: MessageSummary; body?: MessageBody }>;
  notice: string | null;
}

export interface ViewModelDeps {
  cache: MailCache;
  sync: SyncEngine;
  settings: SettingsStore;
  getProvider: (id: string) => MailProvider | undefined;
  isOnline: () => boolean;
}

const PAGE = 50;

function groupThreads(messages: MessageSummary[]): ThreadView[] {
  const byThread = new Map<string, MessageSummary[]>();
  for (const m of messages) {
    const arr = byThread.get(m.threadId) ?? [];
    arr.push(m);
    byThread.set(m.threadId, arr);
  }
  const threads: ThreadView[] = [];
  for (const [threadId, msgs] of byThread) {
    msgs.sort((a, b) => a.date - b.date);
    threads.push({
      threadId,
      subject: msgs[msgs.length - 1].subject,
      lastDate: Math.max(...msgs.map((m) => m.date)),
      messages: msgs,
      unread: msgs.some((m) => m.unread),
    });
  }
  threads.sort((a, b) => b.lastDate - a.lastDate);
  return threads;
}

export class ViewModel {
  private state: ViewState = {
    accounts: [], activeAccountId: null, mailboxes: [], activeMailboxId: null,
    threads: [], hasMore: false, loadingList: false,
    search: { query: "", active: false },
    openThreadId: null, openMessages: [], notice: null,
  };
  private listeners = new Set<(s: ViewState) => void>();
  private unsubSync: Array<() => void> = [];
  private providerListToken: string | undefined;
  private providerListExhausted = false;

  constructor(private deps: ViewModelDeps) {
    this.unsubSync.push(
      deps.sync.changes.on((e) => {
        if (e.accountId === this.state.activeAccountId && !this.state.search.active) {
          void this.reloadList();
        }
      }),
      deps.sync.states.on(() => this.refreshAccountStatuses()),
    );
  }

  getState(): ViewState { return this.state; }

  subscribe(fn: (s: ViewState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<ViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of [...this.listeners]) fn(this.state);
  }

  private refreshAccountStatuses(): void {
    this.set({
      accounts: this.state.accounts.map((a) => ({ ...a, status: this.deps.sync.getState(a.id).status })),
    });
  }

  async init(): Promise<void> {
    const cfg = this.deps.settings.get();
    const accounts = cfg.accounts.map((a) => ({
      id: a.id, email: a.email, provider: a.provider, status: this.deps.sync.getState(a.id).status,
    }));
    const active = cfg.prefs.defaultAccountId && accounts.some((a) => a.id === cfg.prefs.defaultAccountId)
      ? cfg.prefs.defaultAccountId
      : accounts[0]?.id ?? null;
    this.set({ accounts, activeAccountId: active });
    if (active) await this.selectAccount(active);
  }

  async selectAccount(id: string): Promise<void> {
    const mailboxes = await this.deps.cache.getMailboxes(id);
    const inbox = mailboxes.find((m) => m.kind === "inbox") ?? mailboxes[0];
    this.set({
      activeAccountId: id,
      mailboxes: sortMailboxes(mailboxes),
      activeMailboxId: inbox?.id ?? null,
      search: { query: "", active: false },
      openThreadId: null, openMessages: [],
    });
    if (inbox) await this.selectMailbox(inbox.id);
  }

  async selectMailbox(id: string): Promise<void> {
    this.set({ activeMailboxId: id, search: { query: "", active: false } });
    this.providerListToken = undefined;
    this.providerListExhausted = false;
    await this.reloadList();
  }

  private async reloadList(): Promise<void> {
    const acct = this.state.activeAccountId;
    const mb = this.state.activeMailboxId;
    if (!acct || !mb) return;
    this.set({ loadingList: true });
    const rows = await this.deps.cache.listMailboxMessages(acct, mb, { limit: PAGE * 4 });
    this.set({
      threads: groupThreads(rows),
      hasMore: !this.providerListExhausted,
      loadingList: false,
    });
  }

  async loadMore(): Promise<void> {
    const acct = this.state.activeAccountId;
    const mb = this.state.activeMailboxId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !mb || !provider || this.providerListExhausted) return;
    if (this.state.search.active) return;
    this.set({ loadingList: true });
    try {
      const page = await provider.listMessages(mb, this.providerListToken);
      if (page.items.length) await this.deps.cache.upsertMessages(acct, page.items);
      this.providerListToken = page.nextPageToken;
      this.providerListExhausted = !page.nextPageToken;
    } catch {
      this.set({ notice: "Couldn't load more messages." });
    }
    await this.reloadList();
  }

  async openThread(threadId: string): Promise<void> {
    const acct = this.state.activeAccountId;
    if (!acct) return;
    const summaries = await this.deps.cache.getThreadMessages(acct, threadId);
    this.set({ openThreadId: threadId, openMessages: summaries.map((s) => ({ summary: s })) });
    const provider = this.deps.getProvider(acct);
    for (const s of summaries) {
      let body = await this.deps.cache.getBody(acct, s.id);
      if (!body && provider) {
        try {
          body = await provider.getMessageBody(s.id);
          await this.deps.cache.putBody(acct, body);
        } catch {
          this.set({ notice: "Couldn't load a message body." });
        }
      }
      if (this.state.openThreadId !== threadId) return;
      this.set({
        openMessages: this.state.openMessages.map((m) =>
          m.summary.id === s.id ? { ...m, body: body ?? m.body } : m,
        ),
      });
    }
  }

  closeThread(): void {
    this.set({ openThreadId: null, openMessages: [] });
  }

  async refresh(): Promise<void> {
    if (this.state.activeAccountId) await this.deps.sync.syncAccount(this.state.activeAccountId);
  }

  async runSearch(query: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    if (!this.deps.isOnline()) {
      this.set({ notice: "Search is unavailable while offline." });
      return;
    }
    this.set({ loadingList: true, notice: null });
    try {
      const page = await provider.search(query);
      this.set({
        search: { query, active: true },
        threads: groupThreads(page.items),
        hasMore: false,
        loadingList: false,
      });
    } catch {
      this.set({ loadingList: false, notice: "Search failed." });
    }
  }

  async clearSearch(): Promise<void> {
    this.set({ search: { query: "", active: false }, notice: null });
    await this.reloadList();
  }

  dispose(): void {
    for (const off of this.unsubSync) off();
    this.unsubSync = [];
    this.listeners.clear();
  }
}

const MAILBOX_ORDER: Record<string, number> = {
  inbox: 0, sent: 1, drafts: 2, archive: 3, spam: 4, trash: 5, custom: 6,
};

function sortMailboxes(boxes: Mailbox[]): Mailbox[] {
  return [...boxes].sort((a, b) => {
    const d = (MAILBOX_ORDER[a.kind] ?? 9) - (MAILBOX_ORDER[b.kind] ?? 9);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- view/view-model`

- [ ] **Step 5: Commit**

```bash
git add src/view/view-model.ts tests/view/view-model.test.ts
git commit -m "feat: add ViewModel bridging cache, sync and provider reads

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 24: `view/mail-view.ts` + `App.svelte` + `AccountSwitcher.svelte` + `MailboxList.svelte`

**Files:**
- Create: `src/view/mail-view.ts`, `src/view/App.svelte`
- Create: `src/view/components/AccountSwitcher.svelte`, `src/view/components/MailboxList.svelte`
- Modify: `styles.css` (append view styles)
- Test: `tests/view/app.smoke.test.ts`

**Interfaces:**
- Consumes: `ViewModel` + `ViewState` (Task 23), Obsidian `ItemView`.
- Produces:
  - `export const MAIL_VIEW_TYPE = "obsidian-email-mail-view"`
  - `class MailView extends ItemView` — `constructor(leaf, vm: ViewModel)`; `getViewType()`, `getDisplayText()` → `"Email"`, `getIcon()` → `"mail"`; `onOpen()` mounts `App` with `props: { vm }`; `onClose()` unmounts and calls `vm` cleanup owned by `main.ts` (view does not dispose the shared vm).
  - `App.svelte` props: `{ vm: ViewModel }`. Subscribes via `vm.subscribe`; renders a 4-column CSS grid: `AccountSwitcher`, `MailboxList`, `<MessageList>` (Task 25), `<ReadingPane>` (Task 26). Shows `state.notice` as a dismissible bar.
  - `AccountSwitcher.svelte` props: `{ accounts: ViewState["accounts"]; activeId: string | null; onSelect: (id: string) => void; onAddAccount: () => void }`. Renders one button per account (initials avatar, unread not shown in SP1), a warning dot when `status === "needs-reauth"`, and a "+" button.
  - `MailboxList.svelte` props: `{ mailboxes: Mailbox[]; activeId: string | null; onSelect: (id: string) => void }`.

- [ ] **Step 1: Write the smoke test**

`tests/view/app.smoke.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import App from "../../src/view/App.svelte";
import type { ViewModel, ViewState } from "../../src/view/view-model";

function fakeVm(state: Partial<ViewState> = {}): ViewModel {
  const full: ViewState = {
    accounts: [{ id: "a1", email: "a1@x.com", provider: "gmail", status: "idle" }],
    activeAccountId: "a1",
    mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }],
    activeMailboxId: "INBOX",
    threads: [{
      threadId: "t1", subject: "Hello", lastDate: 1, unread: true,
      messages: [{
        id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "hi there", date: 1,
        unread: true, hasAttachments: false, flagged: false,
      }],
    }],
    hasMore: false, loadingList: false,
    search: { query: "", active: false },
    openThreadId: null, openMessages: [], notice: null,
    ...state,
  };
  return {
    getState: () => full,
    subscribe: (fn: (s: ViewState) => void) => { fn(full); return () => {}; },
    selectAccount: vi.fn(), selectMailbox: vi.fn(), openThread: vi.fn(), closeThread: vi.fn(),
    loadMore: vi.fn(), refresh: vi.fn(), runSearch: vi.fn(), clearSearch: vi.fn(),
  } as unknown as ViewModel;
}

describe("App.svelte smoke", () => {
  it("renders account, mailbox and thread rows", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm(), onAddAccount: () => {} } });
    expect(host.textContent).toContain("Inbox");
    expect(host.textContent).toContain("Hello");
    expect(host.textContent).toContain("Jane");
    unmount(app);
  });

  it("shows the notice bar when set", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm({ notice: "Offline" }), onAddAccount: () => {} } });
    expect(host.textContent).toContain("Offline");
    unmount(app);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/view/components/AccountSwitcher.svelte`**

```svelte
<script lang="ts">
  import type { ViewState } from "../view-model";

  let { accounts, activeId, onSelect, onAddAccount }: {
    accounts: ViewState["accounts"];
    activeId: string | null;
    onSelect: (id: string) => void;
    onAddAccount: () => void;
  } = $props();

  const initials = (email: string) => email.slice(0, 2).toUpperCase();
</script>

<div class="oe-accounts">
  {#each accounts as a (a.id)}
    <button
      class="oe-account"
      class:is-active={a.id === activeId}
      title={a.email}
      onclick={() => onSelect(a.id)}
    >
      <span class="oe-avatar">{initials(a.email)}</span>
      {#if a.status === "needs-reauth"}<span class="oe-warn" title="Needs re-authentication">!</span>{/if}
    </button>
  {/each}
  <button class="oe-account oe-add" title="Add account" onclick={onAddAccount}>+</button>
</div>
```

- [ ] **Step 4: Implement `src/view/components/MailboxList.svelte`**

```svelte
<script lang="ts">
  import type { Mailbox } from "../../providers/types";

  let { mailboxes, activeId, onSelect }: {
    mailboxes: Mailbox[];
    activeId: string | null;
    onSelect: (id: string) => void;
  } = $props();
</script>

<nav class="oe-mailboxes">
  {#each mailboxes as mb (mb.id)}
    <button class="oe-mailbox" class:is-active={mb.id === activeId} onclick={() => onSelect(mb.id)}>
      <span class="oe-mailbox-name">{mb.name}</span>
      {#if mb.unreadCount}<span class="oe-count">{mb.unreadCount}</span>{/if}
    </button>
  {/each}
</nav>
```

- [ ] **Step 5: Implement `src/view/App.svelte`**

```svelte
<script lang="ts">
  import type { ViewModel, ViewState } from "../view-model";
  import AccountSwitcher from "./components/AccountSwitcher.svelte";
  import MailboxList from "./components/MailboxList.svelte";
  import MessageList from "./components/MessageList.svelte";
  import ReadingPane from "./components/ReadingPane.svelte";
  import SearchBar from "./components/SearchBar.svelte";

  let { vm, onAddAccount }: { vm: ViewModel; onAddAccount: () => void } = $props();

  let state = $state<ViewState>(vm.getState());
  $effect(() => vm.subscribe((s) => { state = s; }));
</script>

<div class="obsidian-email-view oe-grid">
  <AccountSwitcher
    accounts={state.accounts}
    activeId={state.activeAccountId}
    onSelect={(id) => vm.selectAccount(id)}
    {onAddAccount}
  />
  <MailboxList
    mailboxes={state.mailboxes}
    activeId={state.activeMailboxId}
    onSelect={(id) => vm.selectMailbox(id)}
  />
  <section class="oe-list-col">
    <SearchBar
      query={state.search.query}
      active={state.search.active}
      onSearch={(q) => vm.runSearch(q)}
      onClear={() => vm.clearSearch()}
      onRefresh={() => vm.refresh()}
    />
    {#if state.notice}
      <div class="oe-notice">{state.notice}</div>
    {/if}
    <MessageList
      threads={state.threads}
      openThreadId={state.openThreadId}
      hasMore={state.hasMore}
      loading={state.loadingList}
      onOpen={(id) => vm.openThread(id)}
      onLoadMore={() => vm.loadMore()}
    />
  </section>
  <ReadingPane
    openMessages={state.openMessages}
    onClose={() => vm.closeThread()}
  />
</div>
```

- [ ] **Step 6: Implement `src/view/mail-view.ts`**

```ts
import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import App from "./App.svelte";
import type { ViewModel } from "./view-model";

export const MAIL_VIEW_TYPE = "obsidian-email-mail-view";

export class MailView extends ItemView {
  private app_?: ReturnType<typeof mount>;

  constructor(
    leaf: WorkspaceLeaf,
    private vm: ViewModel,
    private onAddAccount: () => void,
  ) {
    super(leaf);
  }

  getViewType(): string { return MAIL_VIEW_TYPE; }
  getDisplayText(): string { return "Email"; }
  getIcon(): string { return "mail"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.app_ = mount(App, {
      target: this.contentEl,
      props: { vm: this.vm, onAddAccount: this.onAddAccount },
    });
    await this.vm.init();
  }

  async onClose(): Promise<void> {
    if (this.app_) unmount(this.app_);
    this.app_ = undefined;
  }
}
```

- [ ] **Step 7: Append view styles to `styles.css`**

```css
.oe-grid {
  display: grid;
  grid-template-columns: 56px 200px minmax(260px, 1fr) minmax(320px, 1.4fr);
  height: 100%;
  overflow: hidden;
}
.oe-accounts { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-right: 1px solid var(--background-modifier-border); }
.oe-account { position: relative; width: 40px; height: 40px; border-radius: 8px; background: var(--background-secondary); color: var(--text-normal); cursor: pointer; }
.oe-account.is-active { outline: 2px solid var(--interactive-accent); }
.oe-warn { position: absolute; top: -4px; right: -4px; background: var(--text-error); color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 11px; }
.oe-mailboxes { display: flex; flex-direction: column; padding: 8px; border-right: 1px solid var(--background-modifier-border); overflow-y: auto; }
.oe-mailbox { display: flex; justify-content: space-between; padding: 6px 8px; border-radius: 6px; background: transparent; color: var(--text-normal); cursor: pointer; text-align: left; }
.oe-mailbox.is-active { background: var(--background-modifier-hover); }
.oe-list-col { display: flex; flex-direction: column; border-right: 1px solid var(--background-modifier-border); overflow: hidden; }
.oe-notice { padding: 6px 10px; background: var(--background-modifier-error); color: var(--text-on-accent); font-size: 12px; }
.oe-message-list { overflow-y: auto; flex: 1; }
.oe-thread-row { padding: 8px 10px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer; }
.oe-thread-row.is-unread .oe-thread-subject { font-weight: 600; }
.oe-thread-row.is-open { background: var(--background-modifier-hover); }
.oe-reading-pane { overflow-y: auto; padding: 12px 16px; }
.obsidian-email-message-body { max-width: 800px; overflow-x: auto; contain: content; }
.obsidian-email-message-body img { max-width: 100%; height: auto; }
.obsidian-email-plaintext { white-space: pre-wrap; word-break: break-word; font-family: var(--font-text); }
.oe-load-images { margin: 8px 0; padding: 6px 10px; border: 1px solid var(--background-modifier-border); border-radius: 6px; cursor: pointer; background: var(--background-secondary); }
.oe-search { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--background-modifier-border); }
.oe-search input { flex: 1; }
```

- [ ] **Step 8: Run the smoke test — expect PASS**

Run: `npm test -- view/app.smoke` (this also requires Tasks 25 & 26 components to exist as imports; if executing strictly in order, create minimal stub `.svelte` files for `MessageList`, `ReadingPane`, `SearchBar` now and flesh them out in the next tasks. Stub example: `<script lang="ts">let props = $props();</script>`.)

- [ ] **Step 9: Run the production build — expect PASS**

Run: `npm run build`

- [ ] **Step 10: Commit**

```bash
git add src/view/mail-view.ts src/view/App.svelte src/view/components/ styles.css tests/view/app.smoke.test.ts
git commit -m "feat: add mail view shell, account switcher and mailbox list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 25: `view/components/MessageList.svelte` + `ThreadRow.svelte`

**Files:**
- Create: `src/view/components/MessageList.svelte`, `src/view/components/ThreadRow.svelte`
- Test: `tests/view/message-list.smoke.test.ts`

**Interfaces:**
- Consumes: `ThreadView` (Task 23).
- Produces:
  - `MessageList.svelte` props: `{ threads: ThreadView[]; openThreadId: string | null; hasMore: boolean; loading: boolean; onOpen: (threadId: string) => void; onLoadMore: () => void }`.
    - Renders a scroll container of `ThreadRow`; an `IntersectionObserver` (or scroll handler) on a sentinel calls `onLoadMore` when `hasMore && !loading`.
    - Shows "Loading…", empty state ("No messages"), and a "Load more" button fallback.
  - `ThreadRow.svelte` props: `{ thread: ThreadView; isOpen: boolean; onOpen: () => void }`.
    - Shows newest sender name/email, subject, newest snippet, relative date (`formatRelativeDate(ts)` — implement inline), a bullet when `thread.unread`, a count badge when `messages.length > 1`, a paperclip when any message `hasAttachments`.

- [ ] **Step 1: Write the smoke test**

`tests/view/message-list.smoke.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import MessageList from "../../src/view/components/MessageList.svelte";
import type { ThreadView } from "../../src/view/view-model";

const thread = (id: string, over: Partial<ThreadView> = {}): ThreadView => ({
  threadId: id, subject: `Subject ${id}`, lastDate: Date.now(), unread: true,
  messages: [{
    id: `${id}-a`, threadId: id, mailboxIds: ["INBOX"], from: { name: "Alice", email: "a@x.com" },
    to: [], cc: [], subject: `Subject ${id}`, snippet: "preview text", date: Date.now(),
    unread: true, hasAttachments: true, flagged: false,
  }],
  ...over,
});

describe("MessageList smoke", () => {
  it("renders rows and calls onOpen on click", () => {
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [thread("t1")], openThreadId: null, hasMore: false, loading: false, onOpen, onLoadMore: () => {} },
    });
    expect(host.textContent).toContain("Subject t1");
    expect(host.textContent).toContain("Alice");
    host.querySelector<HTMLElement>(".oe-thread-row")!.click();
    expect(onOpen).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("shows an empty state", () => {
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [], openThreadId: null, hasMore: false, loading: false, onOpen: () => {}, onLoadMore: () => {} },
    });
    expect(host.textContent).toMatch(/no messages/i);
    unmount(app);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/view/components/ThreadRow.svelte`**

```svelte
<script lang="ts">
  import type { ThreadView } from "../view-model";

  let { thread, isOpen, onOpen }: { thread: ThreadView; isOpen: boolean; onOpen: () => void } = $props();

  const newest = $derived(thread.messages[thread.messages.length - 1]);
  const sender = $derived(newest.from.name || newest.from.email || "(unknown)");
  const hasAttachments = $derived(thread.messages.some((m) => m.hasAttachments));

  function relative(ts: number): string {
    const diff = Date.now() - ts;
    const min = 60_000, hr = 3_600_000, day = 86_400_000;
    if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m`;
    if (diff < day) return `${Math.round(diff / hr)}h`;
    if (diff < 7 * day) return `${Math.round(diff / day)}d`;
    return new Date(ts).toLocaleDateString();
  }
</script>

<button
  class="oe-thread-row"
  class:is-unread={thread.unread}
  class:is-open={isOpen}
  onclick={onOpen}
>
  <div class="oe-thread-line1">
    <span class="oe-thread-sender">{sender}</span>
    <span class="oe-thread-date">{relative(thread.lastDate)}</span>
  </div>
  <div class="oe-thread-line2">
    {#if thread.unread}<span class="oe-dot" aria-label="unread">●</span>{/if}
    <span class="oe-thread-subject">{thread.subject}</span>
    {#if thread.messages.length > 1}<span class="oe-thread-count">{thread.messages.length}</span>{/if}
    {#if hasAttachments}<span class="oe-clip" aria-label="has attachments">📎</span>{/if}
  </div>
  <div class="oe-thread-snippet">{newest.snippet}</div>
</button>
```

- [ ] **Step 4: Implement `src/view/components/MessageList.svelte`**

```svelte
<script lang="ts">
  import type { ThreadView } from "../view-model";
  import ThreadRow from "./ThreadRow.svelte";

  let { threads, openThreadId, hasMore, loading, onOpen, onLoadMore }: {
    threads: ThreadView[];
    openThreadId: string | null;
    hasMore: boolean;
    loading: boolean;
    onOpen: (threadId: string) => void;
    onLoadMore: () => void;
  } = $props();

  let sentinel = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!sentinel || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && hasMore && !loading) onLoadMore();
    });
    io.observe(sentinel);
    return () => io.disconnect();
  });
</script>

<div class="oe-message-list">
  {#if threads.length === 0 && !loading}
    <p class="oe-empty">No messages</p>
  {/if}
  {#each threads as t (t.threadId)}
    <ThreadRow thread={t} isOpen={t.threadId === openThreadId} onOpen={() => onOpen(t.threadId)} />
  {/each}
  {#if loading}<p class="oe-loading">Loading…</p>{/if}
  {#if hasMore}
    <div bind:this={sentinel}></div>
    <button class="oe-load-more" onclick={onLoadMore}>Load more</button>
  {/if}
</div>
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/view/components/MessageList.svelte src/view/components/ThreadRow.svelte tests/view/message-list.smoke.test.ts
git commit -m "feat: add threaded message list with infinite scroll

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 26: `ReadingPane.svelte` + `MessageBlock.svelte` + `SearchBar.svelte`

**Files:**
- Create: `src/view/components/ReadingPane.svelte`, `src/view/components/MessageBlock.svelte`, `src/view/components/SearchBar.svelte`
- Modify: `src/view/view-model.ts` — add `downloadAttachment(messageId, attachmentId, filename)` and expose `getInlineAttachment` + `openExternal` through a `renderDeps` accessor
- Test: `tests/view/reading-pane.smoke.test.ts`, extend `tests/view/view-model.test.ts`

**Interfaces:**
- Consumes: `renderMessageBody` (Task 22), `ViewState["openMessages"]` (Task 23).
- Produces:
  - `ViewModel.renderDeps(): { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void }` — `getInlineAttachment` maps a `cid` to the matching inline attachment of the currently open messages and calls `provider.getAttachment` → `new Blob([buf], { type })`.
  - `ViewModel.downloadAttachment(messageId: string, att: AttachmentMeta): Promise<Blob>` — `provider.getAttachment` → `Blob`; the Svelte layer triggers the save (`main.ts` supplies an `onSaveBlob` that uses the Obsidian `FileSystemAdapter` or a temp anchor).
  - `ReadingPane.svelte` props: `{ openMessages: ViewState["openMessages"]; renderDeps: ...; onClose: () => void; onDownload: (messageId: string, att: AttachmentMeta) => void }`. Empty state when nothing is open. Renders a header (subject + message count + close button) and one `MessageBlock` per message (collapsed except the last).
  - `MessageBlock.svelte` props: `{ summary: MessageSummary; body?: MessageBody; expanded: boolean; renderDeps; onToggle: () => void; onDownload: (att: AttachmentMeta) => void }`. On expand + body present, calls `renderMessageBody` into a bound `div`; shows a "Load remote images" button when `handle.blockedRemoteContent`; lists attachment chips (non-inline) that call `onDownload`. Calls `handle.dispose()` in an `$effect` cleanup / `onDestroy`.
  - `SearchBar.svelte` props: `{ query: string; active: boolean; onSearch: (q: string) => void; onClear: () => void; onRefresh: () => void }`. An input + submit; when `active`, shows a "Search: <query> ✕" pill wired to `onClear`; a refresh button.

- [ ] **Step 1: Write the smoke test**

`tests/view/reading-pane.smoke.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import ReadingPane from "../../src/view/components/ReadingPane.svelte";
import type { ViewState } from "../../src/view/view-model";

const renderDeps = { getInlineAttachment: vi.fn(), openExternal: vi.fn() };

const open = (): ViewState["openMessages"] => [{
  summary: {
    id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
    to: [{ email: "me@x.com" }], cc: [], subject: "Hello", snippet: "", date: Date.now(),
    unread: false, hasAttachments: true, flagged: false,
  },
  body: {
    id: "m1", html: "<p>Body <b>text</b></p>", text: null, headers: {},
    attachments: [{ id: "a1", filename: "report.pdf", mimeType: "application/pdf", size: 10, inline: false }],
  },
}];

describe("ReadingPane smoke", () => {
  it("renders the subject, sanitized body and an attachment chip", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: { openMessages: open(), renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    expect(host.textContent).toContain("Hello");
    expect(host.querySelector(".obsidian-email-message-body b")?.textContent).toBe("text");
    expect(host.textContent).toContain("report.pdf");
    unmount(app);
  });

  it("shows an empty state with no open thread", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host, props: { openMessages: [], renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    expect(host.textContent).toMatch(/select a message|nothing/i);
    unmount(app);
  });

  it("calls onDownload when an attachment chip is clicked", () => {
    const onDownload = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host, props: { openMessages: open(), renderDeps, onClose: () => {}, onDownload },
    });
    host.querySelector<HTMLElement>(".oe-attachment")!.click();
    expect(onDownload).toHaveBeenCalledWith("m1", expect.objectContaining({ filename: "report.pdf" }));
    unmount(app);
  });

  it("renders a Load remote images button for blocked content", () => {
    const host = document.createElement("div");
    const msgs = open();
    msgs[0].body!.html = '<img src="https://tracker.example/p.gif">';
    const app = mount(ReadingPane, {
      target: host, props: { openMessages: msgs, renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    expect(host.textContent).toMatch(/load remote images/i);
    unmount(app);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/view/components/MessageBlock.svelte`**

```svelte
<script lang="ts">
  import type { AttachmentMeta, MessageBody, MessageSummary } from "../../providers/types";
  import { renderMessageBody, type RenderHandle } from "../../render/message-renderer";

  let { summary, body, expanded, renderDeps, onToggle, onDownload }: {
    summary: MessageSummary;
    body?: MessageBody;
    expanded: boolean;
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onToggle: () => void;
    onDownload: (att: AttachmentMeta) => void;
  } = $props();

  let bodyEl = $state<HTMLDivElement | null>(null);
  let handle = $state<RenderHandle | null>(null);
  let blocked = $state(false);

  $effect(() => {
    if (!expanded || !body || !bodyEl) return;
    const h = renderMessageBody(bodyEl, body, { allowRemote: false }, renderDeps);
    handle = h;
    blocked = h.blockedRemoteContent;
    return () => { h.dispose(); handle = null; };
  });

  const fmtAddr = (a: { name?: string; email: string }) => a.name ? `${a.name} <${a.email}>` : a.email;
  const attachments = $derived((body?.attachments ?? []).filter((a) => !a.inline));
</script>

<article class="oe-message-block" class:is-expanded={expanded}>
  <header class="oe-message-head" onclick={onToggle} role="button" tabindex="0"
          onkeydown={(e) => (e.key === "Enter" ? onToggle() : null)}>
    <span class="oe-message-from">{summary.from.name || summary.from.email}</span>
    <span class="oe-message-date">{new Date(summary.date).toLocaleString()}</span>
  </header>
  {#if expanded}
    <div class="oe-message-meta">
      <div>From: {fmtAddr(summary.from)}</div>
      {#if summary.to.length}<div>To: {summary.to.map(fmtAddr).join(", ")}</div>{/if}
      {#if summary.cc.length}<div>Cc: {summary.cc.map(fmtAddr).join(", ")}</div>{/if}
    </div>
    {#if blocked}
      <button class="oe-load-images" onclick={() => { handle?.loadRemoteImages(); blocked = false; }}>
        Load remote images
      </button>
    {/if}
    {#if body}
      <div class="oe-message-body-host" bind:this={bodyEl}></div>
    {:else}
      <p class="oe-loading">Loading message…</p>
    {/if}
    {#if attachments.length}
      <div class="oe-attachments">
        {#each attachments as att (att.id)}
          <button class="oe-attachment" onclick={() => onDownload(att)}>
            📎 {att.filename} ({Math.ceil(att.size / 1024)} KB)
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</article>
```

- [ ] **Step 4: Implement `src/view/components/ReadingPane.svelte`**

```svelte
<script lang="ts">
  import type { AttachmentMeta } from "../../providers/types";
  import type { ViewState } from "../view-model";
  import MessageBlock from "./MessageBlock.svelte";

  let { openMessages, renderDeps, onClose, onDownload }: {
    openMessages: ViewState["openMessages"];
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onClose: () => void;
    onDownload: (messageId: string, att: AttachmentMeta) => void;
  } = $props();

  let expandedId = $state<string | null>(null);
  const lastId = $derived(openMessages.at(-1)?.summary.id ?? null);
  const isExpanded = (id: string) => (expandedId ?? lastId) === id;
</script>

<section class="oe-reading-pane">
  {#if openMessages.length === 0}
    <p class="oe-empty">Select a message to read</p>
  {:else}
    <header class="oe-reading-head">
      <h3>{openMessages.at(-1)?.summary.subject}</h3>
      <span>{openMessages.length} message{openMessages.length > 1 ? "s" : ""}</span>
      <button class="oe-close" onclick={onClose} aria-label="Close">✕</button>
    </header>
    {#each openMessages as m (m.summary.id)}
      <MessageBlock
        summary={m.summary}
        body={m.body}
        expanded={isExpanded(m.summary.id)}
        {renderDeps}
        onToggle={() => (expandedId = expandedId === m.summary.id ? null : m.summary.id)}
        onDownload={(att) => onDownload(m.summary.id, att)}
      />
    {/each}
  {/if}
</section>
```

- [ ] **Step 5: Implement `src/view/components/SearchBar.svelte`**

```svelte
<script lang="ts">
  let { query, active, onSearch, onClear, onRefresh }: {
    query: string;
    active: boolean;
    onSearch: (q: string) => void;
    onClear: () => void;
    onRefresh: () => void;
  } = $props();

  let value = $state(query);
  $effect(() => { value = query; });
</script>

<form class="oe-search" onsubmit={(e) => { e.preventDefault(); if (value.trim()) onSearch(value.trim()); }}>
  <input type="search" placeholder="Search mail…" bind:value />
  <button type="submit">Search</button>
  <button type="button" onclick={onRefresh} aria-label="Refresh">⟳</button>
  {#if active}
    <button type="button" class="oe-search-pill" onclick={onClear}>Search: {query} ✕</button>
  {/if}
</form>
```

- [ ] **Step 6: Add `renderDeps` / `downloadAttachment` to `src/view/view-model.ts`**

Add to `ViewModel`:
```ts
renderDeps(): { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void } {
  return {
    openExternal: (url: string) => this.deps.openExternal(url),
    getInlineAttachment: async (cid: string) => {
      const acct = this.state.activeAccountId;
      const provider = acct ? this.deps.getProvider(acct) : undefined;
      if (!acct || !provider) return undefined;
      for (const m of this.state.openMessages) {
        const att = m.body?.attachments.find((a) => a.inline && a.contentId === cid);
        if (att) {
          const buf = await provider.getAttachment(m.summary.id, att.id);
          return new Blob([buf], { type: att.mimeType });
        }
      }
      return undefined;
    },
  };
}

async downloadAttachment(messageId: string, att: AttachmentMeta): Promise<Blob> {
  const acct = this.state.activeAccountId;
  const provider = acct ? this.deps.getProvider(acct) : undefined;
  if (!acct || !provider) throw new Error("No active account");
  const buf = await provider.getAttachment(messageId, att.id);
  return new Blob([buf], { type: att.mimeType });
}
```
Extend `ViewModelDeps` with `openExternal: (url: string) => void`. Update `tests/view/view-model.test.ts` `build()` to pass `openExternal: () => {}` and add one test asserting `renderDeps().getInlineAttachment` returns a Blob for an open message's inline attachment (seed a body via `cache.putBody` with an inline attachment and stub `provider.getAttachment`).

- [ ] **Step 7: Run — expect PASS (smoke + view-model)**

Run: `npm test -- view/`

- [ ] **Step 8: Commit**

```bash
git add src/view/components/ReadingPane.svelte src/view/components/MessageBlock.svelte src/view/components/SearchBar.svelte src/view/view-model.ts tests/view/
git commit -m "feat: add reading pane, message blocks and search bar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 27: `main.ts` — wire everything together

**Files:**
- Modify: `src/main.ts`
- Create: `src/plugin-context.ts` (assembles cache, sync, providers, view-model from settings)
- Test: `tests/plugin-context.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `src/plugin-context.ts`:
    - `interface ContextHostDeps { http: HttpClient; secrets: SecretStore; post: HttpPost; openExternal: (url: string) => void; now?: () => number }`
    - `class PluginContext`
      - `static async create(settings: SettingsStore, host: ContextHostDeps, logger: Logger): Promise<PluginContext>`
      - `readonly cache: MailCache`, `readonly sync: SyncEngine`, `readonly vm: ViewModel`
      - `rebuildProviders(): void` — recreate `TokenManager` + `MailProvider` per account from current settings
      - `addAccountFlow(input: { kind; clientId; clientSecret? }): Promise<AccountConfig>` — calls `addAccount(...)`, persists via `settings.addAccount`, `rebuildProviders()`, `sync.syncAccount(id)`
      - `removeAccountFlow(id: string): Promise<void>` — `token.clear()`, `settings.removeAccount`, `cache.clearAccount`, `rebuildProviders()`
      - `applyPollInterval(): void` — `sync.setInterval(settings.pollIntervalMs())`
      - `dispose(): void`
  - `src/main.ts`:
    - `onload`: load `SettingsStore`; build `ContextHostDeps` from Obsidian (`makeObsidianHttp(requestUrl)`, `this.app.secretStorage`, a `post` built on `requestUrl` with form-encoding, `shell.openExternal` via `require("electron")`); `PluginContext.create`; register `MAIL_VIEW_TYPE` with a factory that passes `ctx.vm` and an `addAccount` callback that opens the settings tab; add ribbon icon `"mail"` + command `"obsidian-email-open"` → `activateView()`; `addSettingTab(new EmailSettingTab(this, ctx, settings))`; `ctx.sync.start(settings.pollIntervalMs())`.
    - `onunload`: `ctx.dispose()`, detach leaves of `MAIL_VIEW_TYPE`.
    - `activateView()`: reveal an existing leaf or create one in the main workspace (`getLeaf(false)` / right split — main area, this is a full client).

- [ ] **Step 1: Write failing test for `PluginContext`**

`tests/plugin-context.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { PluginContext } from "../src/plugin-context";
import { SettingsStore } from "../src/settings/settings-store";
import { Logger } from "../src/util/logger";

const logger = new Logger("t", { debug: () => false });

function hostDeps() {
  return {
    http: { request: vi.fn().mockResolvedValue({ status: 200, json: {}, text: "{}", arrayBuffer: new ArrayBuffer(0), headers: {} }) },
    secrets: { getSecret: vi.fn().mockResolvedValue(null), setSecret: vi.fn().mockResolvedValue(undefined) },
    post: vi.fn().mockResolvedValue({ status: 200, json: { access_token: "a", refresh_token: "r", expires_in: 3600 } }),
    openExternal: vi.fn(),
    now: () => 0,
  };
}

describe("PluginContext", () => {
  it("creates cache, sync and view-model", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    expect(ctx.cache).toBeTruthy();
    expect(ctx.sync).toBeTruthy();
    expect(ctx.vm).toBeTruthy();
    ctx.dispose();
  });

  it("rebuildProviders exposes a provider for each configured account", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "gmail", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    ctx.rebuildProviders();
    expect(ctx.providerFor("a1")?.kind).toBe("gmail");
    ctx.dispose();
  });

  it("removeAccountFlow clears secrets, settings and cache", async () => {
    const deps = hostDeps();
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "gmail", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, deps, logger);
    ctx.rebuildProviders();
    await ctx.removeAccountFlow("a1");
    expect(settings.get().accounts).toHaveLength(0);
    expect(deps.secrets.setSecret).toHaveBeenCalledWith("obsidian-email-a1:refresh", "");
  });
});
```

(Expose a small `providerFor(id)` accessor on `PluginContext` for this test and for `main.ts`'s view factory.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/plugin-context.ts`**

```ts
import type { HttpClient } from "./providers/http";
import type { HttpPost } from "./auth/oauth-client";
import type { SecretStore } from "./auth/token-manager";
import type { AccountConfig } from "./providers/provider-factory";
import type { ProviderKind, MailProvider } from "./providers/types";
import type { Logger } from "./util/logger";
import { SettingsStore } from "./settings/settings-store";
import { MailCache } from "./cache/mail-cache";
import { CursorStore } from "./cache/cursor-store";
import { SyncEngine } from "./sync/sync-engine";
import { ViewModel } from "./view/view-model";
import { TokenManager } from "./auth/token-manager";
import { createProvider } from "./providers/provider-factory";
import { addAccount, defaultFetchProfileEmail } from "./auth/add-account";

export interface ContextHostDeps {
  http: HttpClient;
  secrets: SecretStore;
  post: HttpPost;
  openExternal: (url: string) => void;
  now?: () => number;
}

export class PluginContext {
  private tokens = new Map<string, TokenManager>();
  private providers = new Map<string, MailProvider>();
  private now: () => number;

  private constructor(
    private settings: SettingsStore,
    private host: ContextHostDeps,
    private logger: Logger,
    readonly cache: MailCache,
    private cursors: CursorStore,
    readonly sync: SyncEngine,
    readonly vm: ViewModel,
  ) {
    this.now = host.now ?? (() => Date.now());
  }

  static async create(settings: SettingsStore, host: ContextHostDeps, logger: Logger): Promise<PluginContext> {
    const cache = await MailCache.open();
    const cursors = await CursorStore.open();
    const providersRef = { map: new Map<string, MailProvider>() };
    const sync = new SyncEngine({
      cache, cursors, logger,
      getProvider: (id) => providersRef.map.get(id),
      listAccountIds: () => settings.get().accounts.map((a) => a.id),
    });
    const vm = new ViewModel({
      cache, sync, settings,
      getProvider: (id) => providersRef.map.get(id),
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      openExternal: host.openExternal,
    });
    const ctx = new PluginContext(settings, host, logger, cache, cursors, sync, vm);
    // share the same map instance
    ctx.providers = providersRef.map;
    ctx.rebuildProviders();
    return ctx;
  }

  providerFor(id: string): MailProvider | undefined {
    return this.providers.get(id);
  }

  rebuildProviders(): void {
    const accounts = this.settings.get().accounts;
    const keep = new Set(accounts.map((a) => a.id));
    for (const id of [...this.providers.keys()]) if (!keep.has(id)) { this.providers.delete(id); this.tokens.delete(id); }
    for (const a of accounts) {
      const token = this.tokens.get(a.id) ?? new TokenManager(a.id, a.provider, a.clientId, {
        secrets: this.host.secrets, post: this.host.post, now: this.now,
      });
      this.tokens.set(a.id, token);
      this.providers.set(a.id, createProvider(a, token, this.host.http));
    }
  }

  async addAccountFlow(input: { kind: ProviderKind; clientId: string; clientSecret?: string }): Promise<AccountConfig> {
    const { account } = await addAccount(input, {
      post: this.host.post,
      secrets: this.host.secrets,
      openBrowser: this.host.openExternal,
      now: this.now,
      genId: () => crypto.randomUUID(),
      fetchProfileEmail: defaultFetchProfileEmail(this.host.http),
    });
    await this.settings.addAccount(account);
    this.rebuildProviders();
    void this.sync.syncAccount(account.id);
    return account;
  }

  async removeAccountFlow(id: string): Promise<void> {
    await this.tokens.get(id)?.clear();
    await this.settings.removeAccount(id);
    await this.cache.clearAccount(id);
    this.rebuildProviders();
  }

  applyPollInterval(): void {
    this.sync.setInterval(this.settings.pollIntervalMs());
  }

  dispose(): void {
    this.sync.stop();
    this.vm.dispose();
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Implement `src/main.ts`**

```ts
import { Plugin, WorkspaceLeaf, requestUrl } from "obsidian";
import { SettingsStore } from "./settings/settings-store";
import { PluginContext } from "./plugin-context";
import { MailView, MAIL_VIEW_TYPE } from "./view/mail-view";
import { EmailSettingTab } from "./settings/settings-tab";
import { makeObsidianHttp } from "./providers/obsidian-http";
import { Logger } from "./util/logger";
import type { HttpPost } from "./auth/oauth-client";

export default class EmailPlugin extends Plugin {
  private ctx?: PluginContext;
  private settings?: SettingsStore;

  async onload(): Promise<void> {
    this.settings = await SettingsStore.load(this);
    const logger = new Logger("plugin", { debug: () => this.settings!.get().prefs.debug });

    const http = makeObsidianHttp(requestUrl as never);
    const post: HttpPost = async (url, form) => {
      const body = new URLSearchParams(form).toString();
      const res = await requestUrl({
        url, method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body, throw: false,
      });
      let json: unknown;
      try { json = res.json; } catch { json = undefined; }
      return { status: res.status, json };
    };

    // electron is external at bundle time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { shell } = require("electron");
    const openExternal = (url: string) => void shell.openExternal(url);

    this.ctx = await PluginContext.create(this.settings, {
      http, secrets: this.app.secretStorage, post, openExternal,
    }, logger);

    this.registerView(
      MAIL_VIEW_TYPE,
      (leaf) => new MailView(leaf, this.ctx!.vm, () => {
        // open settings to the Email tab
        (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting.open();
        (this.app as unknown as { setting: { openTabById(id: string): void } }).setting.openTabById(this.manifest.id);
      }),
    );

    this.addRibbonIcon("mail", "Open mail", () => void this.activateView());
    this.addCommand({ id: "open", name: "Open mail", callback: () => void this.activateView() });
    this.addSettingTab(new EmailSettingTab(this, this.ctx, this.settings));

    this.ctx.sync.start(this.settings.pollIntervalMs());
  }

  onunload(): void {
    this.ctx?.dispose();
    this.app.workspace.detachLeavesOfType(MAIL_VIEW_TYPE);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(MAIL_VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? workspace.getLeaf(true);
    if (!existing) await leaf.setViewState({ type: MAIL_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }
}
```

Note: if `this.app.secretStorage` is not in the installed `obsidian` type defs, add a minimal `src/obsidian-augment.d.ts` declaring `interface App { secretStorage: { getSecret(id: string): Promise<string | null>; setSecret(id: string, v: string): Promise<void>; listSecrets(): Promise<string[]> } }`.

- [ ] **Step 6: Run typecheck + build + full test suite**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green. Fix type gaps (add the augment `.d.ts` if needed).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/plugin-context.ts src/obsidian-augment.d.ts tests/plugin-context.test.ts
git commit -m "feat: wire plugin context, view, commands and scheduler in main

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 28: `settings/settings-tab.ts` and README

**Files:**
- Create: `src/settings/settings-tab.ts`
- Modify: `README.md`
- Test: `tests/settings/settings-tab.test.ts` (logic-only: the add/remove handlers, not the DOM)

**Interfaces:**
- Consumes: `PluginContext` (Task 27), `SettingsStore` (Task 19), Obsidian `PluginSettingTab` / `Setting`.
- Produces:
  - `class EmailSettingTab extends PluginSettingTab`
    - `constructor(plugin: Plugin, ctx: PluginContext, settings: SettingsStore)`
    - `display()`: renders
      - **Accounts:** one row per account (email, provider, status from `ctx.sync.getState`), buttons **Re-authenticate** (`ctx.addAccountFlow` reusing stored `clientId`; on success replace), **Sign out / Remove** (`ctx.removeAccountFlow`).
      - **Add account:** provider dropdown, Client ID text, Client secret text (shown only for Google), **Connect** button → `ctx.addAccountFlow({...})` with a `Notice` on success/failure.
      - **Preferences:** poll interval dropdown (`Manual`,`1`,`5`,`15`,`30`,`60`) → `settings.updatePrefs` + `ctx.applyPollInterval()`; "Load remote images automatically" toggle; attachment folder text; default account dropdown; debug toggle.
      - **Danger zone:** "Clear local cache" → `ctx.cache.clearAll()` + `Notice`.
  - Extract the non-DOM handlers into pure functions for testing: `export async function handleConnect(ctx, input): Promise<{ ok: boolean; message: string }>` and `export async function handleClearCache(ctx): Promise<void>`.

- [ ] **Step 1: Write failing tests**

`tests/settings/settings-tab.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { handleConnect } from "../../src/settings/settings-tab";

describe("handleConnect", () => {
  it("returns ok with the new account email on success", async () => {
    const ctx = { addAccountFlow: vi.fn().mockResolvedValue({ email: "new@x.com" }) };
    const r = await handleConnect(ctx as never, { kind: "gmail", clientId: "c", clientSecret: "s" });
    expect(r).toEqual({ ok: true, message: expect.stringContaining("new@x.com") });
  });

  it("requires a client secret for Google", async () => {
    const ctx = { addAccountFlow: vi.fn() };
    const r = await handleConnect(ctx as never, { kind: "gmail", clientId: "c" });
    expect(r.ok).toBe(false);
    expect(ctx.addAccountFlow).not.toHaveBeenCalled();
  });

  it("does not require a secret for Microsoft", async () => {
    const ctx = { addAccountFlow: vi.fn().mockResolvedValue({ email: "m@x.com" }) };
    const r = await handleConnect(ctx as never, { kind: "ms-graph", clientId: "c" });
    expect(r.ok).toBe(true);
  });

  it("returns a failure message when the flow throws", async () => {
    const ctx = { addAccountFlow: vi.fn().mockRejectedValue(new Error("state mismatch")) };
    const r = await handleConnect(ctx as never, { kind: "ms-graph", clientId: "c" });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("state mismatch") });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/settings/settings-tab.ts`**

```ts
import { PluginSettingTab, Setting, Notice, type Plugin } from "obsidian";
import type { PluginContext } from "../plugin-context";
import type { SettingsStore } from "./settings-store";
import type { ProviderKind } from "../providers/types";

export interface ConnectInput {
  kind: ProviderKind;
  clientId: string;
  clientSecret?: string;
}

export async function handleConnect(
  ctx: Pick<PluginContext, "addAccountFlow">,
  input: ConnectInput,
): Promise<{ ok: boolean; message: string }> {
  if (!input.clientId.trim()) return { ok: false, message: "Client ID is required." };
  if (input.kind === "gmail" && !input.clientSecret?.trim()) {
    return { ok: false, message: "A client secret is required for Google." };
  }
  try {
    const account = await ctx.addAccountFlow(input);
    return { ok: true, message: `Connected ${account.email}.` };
  } catch (err) {
    return { ok: false, message: `Could not connect: ${(err as Error).message}` };
  }
}

export async function handleClearCache(ctx: Pick<PluginContext, "cache">): Promise<void> {
  await ctx.cache.clearAll();
}

const POLL_OPTIONS: Array<[string, string]> = [
  ["", "Manual only"], ["1", "1 minute"], ["5", "5 minutes"],
  ["15", "15 minutes"], ["30", "30 minutes"], ["60", "60 minutes"],
];

export class EmailSettingTab extends PluginSettingTab {
  constructor(plugin: Plugin, private ctx: PluginContext, private settings: SettingsStore) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const cfg = this.settings.get();

    containerEl.createEl("h2", { text: "Accounts" });
    for (const a of cfg.accounts) {
      const status = this.ctx["sync"].getState(a.id).status;
      new Setting(containerEl)
        .setName(a.email)
        .setDesc(`${a.provider} · ${status}`)
        .addButton((b) => b.setButtonText("Re-authenticate").onClick(async () => {
          const r = await handleConnect(this.ctx, { kind: a.provider, clientId: a.clientId });
          new Notice(r.message);
          this.display();
        }))
        .addButton((b) => b.setButtonText("Remove").setWarning().onClick(async () => {
          await this.ctx.removeAccountFlow(a.id);
          new Notice(`Removed ${a.email}.`);
          this.display();
        }));
    }

    containerEl.createEl("h2", { text: "Add account" });
    let kind: ProviderKind = "gmail";
    let clientId = "";
    let clientSecret = "";
    new Setting(containerEl).setName("Provider").addDropdown((d) => d
      .addOption("gmail", "Google (Gmail)")
      .addOption("ms-graph", "Microsoft 365")
      .setValue(kind)
      .onChange((v) => { kind = v as ProviderKind; this.display(); }));
    new Setting(containerEl).setName("Client ID").addText((t) => t.onChange((v) => (clientId = v)));
    if (kind === "gmail") {
      new Setting(containerEl).setName("Client secret").addText((t) => {
        t.inputEl.type = "password";
        t.onChange((v) => (clientSecret = v));
      });
    }
    new Setting(containerEl).addButton((b) => b.setCta().setButtonText("Connect").onClick(async () => {
      const r = await handleConnect(this.ctx, { kind, clientId, clientSecret: clientSecret || undefined });
      new Notice(r.message);
      if (r.ok) this.display();
    }));

    containerEl.createEl("h2", { text: "Preferences" });
    new Setting(containerEl).setName("Check for new mail").addDropdown((d) => {
      for (const [value, label] of POLL_OPTIONS) d.addOption(value, label);
      d.setValue(cfg.prefs.pollMinutes ? String(cfg.prefs.pollMinutes) : "");
      d.onChange(async (v) => {
        await this.settings.updatePrefs({ pollMinutes: v ? Number(v) : null });
        this.ctx.applyPollInterval();
      });
    });
    new Setting(containerEl).setName("Load remote images automatically")
      .addToggle((t) => t.setValue(cfg.prefs.autoLoadImages)
        .onChange((v) => this.settings.updatePrefs({ autoLoadImages: v })));
    new Setting(containerEl).setName("Attachment save folder (vault-relative; blank = ask)")
      .addText((t) => t.setValue(cfg.prefs.attachmentDir ?? "")
        .onChange((v) => this.settings.updatePrefs({ attachmentDir: v || null })));
    new Setting(containerEl).setName("Default account").addDropdown((d) => {
      d.addOption("", "First account");
      for (const a of cfg.accounts) d.addOption(a.id, a.email);
      d.setValue(cfg.prefs.defaultAccountId ?? "");
      d.onChange((v) => this.settings.updatePrefs({ defaultAccountId: v || null }));
    });
    new Setting(containerEl).setName("Debug logging")
      .addToggle((t) => t.setValue(cfg.prefs.debug).onChange((v) => this.settings.updatePrefs({ debug: v })));

    containerEl.createEl("h2", { text: "Danger zone" });
    new Setting(containerEl).setName("Clear local cache")
      .setDesc("Removes cached mail. Accounts and tokens are kept; mail re-syncs.")
      .addButton((b) => b.setWarning().setButtonText("Clear cache").onClick(async () => {
        await handleClearCache(this.ctx);
        new Notice("Local cache cleared.");
      }));
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- settings/settings-tab`

- [ ] **Step 5: Write `README.md`**

Sections:
- **What it is** — desktop-only full email client for Gmail + Microsoft 365 in an Obsidian view; SP1 = reading + search.
- **Install** — from release: copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/obsidian-email/`.
- **Google setup** — numbered steps: create Cloud project → enable Gmail API → configure OAuth consent screen (External, add yourself as a test user, scope `.../auth/gmail.modify`) → create OAuth client ID → **Desktop app** → copy Client ID + Client secret → paste in Settings → Email → Add account → Google → Connect → approve in the browser.
- **Microsoft setup** — numbered steps: Azure Portal → App registrations → New registration (single tenant or multitenant per your account) → Authentication → Add platform → **Mobile and desktop applications** → check `http://localhost` → API permissions → Microsoft Graph → Delegated → `Mail.ReadWrite`, `Mail.Send`, `offline_access`, `User.Read` → copy Application (client) ID → paste in Settings → Connect.
- **Security notes** — tokens stored in Obsidian `secretStorage` (OS keychain-backed on desktop), never in `data.json`; remote images blocked by default; links open in the system browser; no telemetry.
- **Development** — the five-step live-reload workflow from `dev-vault/README.md`; `npm test`, `npm run build`; where the spec and plan live.
- **Roadmap** — SP2 compose/send, SP3 mail actions + unified inbox, SP4 polish.

- [ ] **Step 6: Full green check**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass; `main.js` builds.

- [ ] **Step 7: Manual verification in the dev vault**

1. `./scripts/link.sh && npm run dev`
2. Open `dev-vault/` in Obsidian, enable **Email**.
3. Settings → Email → add a real Gmail account; confirm the browser flow completes and the loopback page says "Authentication complete".
4. Confirm the Inbox lists mail, opening a message renders a sanitized body, remote images are blocked with a "Load remote images" button.
5. Add a Microsoft 365 account; repeat.
6. Run a search; clear it.
7. Quit and reopen Obsidian; confirm accounts persist and cached mail appears immediately, then a background sync refreshes.

- [ ] **Step 8: Commit**

```bash
git add src/settings/settings-tab.ts tests/settings/settings-tab.test.ts README.md
git commit -m "feat: add settings tab and project README

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §2 architecture / module layout | Tasks 1, 3–28 (mirrors the layout) |
| §3 OAuth flow (PKCE, loopback, endpoints, refresh, timeout) | Tasks 7, 8, 9, 10, 20 |
| §3 scopes (`gmail.modify`, Graph delegated set) | Task 8 (`provider-oauth-config.ts`) |
| §4 domain models + `MailProvider` | Task 5 |
| §4 Gmail adapter (list/body/attachment/search/history sync, archive synthetic) | Tasks 11, 12 |
| §4 Graph adapter (folders, `$select`, `$expand`, delta sync, nextLink token) | Tasks 13, 14 |
| §4 rate limiting / retry / concurrency cap | Task 4 + Tasks 12, 14 |
| §4 auth injection via factory | Task 15 |
| §5 IndexedDB stores, indexes, retention constants | Task 16 |
| §5 cursor persistence | Task 17 |
| §5 sync engine: backfill, incremental, interval, manual refresh, single-flight, needs-reauth, per-account isolation | Task 18 |
| §5 on-demand backfill on scroll | Task 23 (`loadMore`) + Task 25 (sentinel) |
| §6 ItemView + 4-column layout | Task 24 |
| §6 account switcher / mailbox list / message list (threaded, virtualized-ish, infinite scroll) | Tasks 24, 25 |
| §6 reading pane, collapsible message blocks, attachment chips, read-state shown not mutated | Task 26 |
| §6 search UI + online-only notice | Tasks 23, 26 |
| §6 theme-variable styling | Task 24 (`styles.css`) |
| §7 sanitizer (script/iframe/handlers/js: URLs), remote blocking + "load images", link handling, cid resolution, no iframe | Tasks 21, 22 |
| §8 settings tab, persistence split, add/remove/re-auth, prefs, danger zone | Tasks 19, 20, 27, 28 |
| §9 build/CI/release tooling | Task 1 |
| §9a dev vault + install/link/uninstall scripts | Task 2 |
| §10 testing strategy (mappers, contract suite, sync engine, sanitizer, token manager, oauth, cache, component smoke) | Tasks 5–28 (each has tests) |
| §11 error handling (`Result`, AuthError vs transient, offline, cache-open fallback, partial failure, logging) | Tasks 3, 10, 12, 14, 18, 23 |
| §12 out of scope | Respected — no compose/send/mutations/unified inbox/notifications |

Note: `Result<T,E>` (Task 3) is defined and available; the provider/sync code chose typed exceptions (`AuthError`/`ProviderError`) as the spec's §11 allows ("exceptions only for programmer errors" is relaxed here to "typed exceptions for auth/transient, caught at the sync-engine boundary"). If a strict `Result` return is preferred at provider boundaries, that is a mechanical refactor and does not change the task structure.

**Cache-open failure fallback (§11):** `MailCache.open` rejecting should not brick the view. Add to Task 27 Step 3 a try/catch around `MailCache.open` / `CursorStore.open` in `PluginContext.create` that, on failure, logs, shows one `Notice`, and constructs the `ViewModel` with a no-op in-memory cache shim (`getProvider` still works, so the view degrades to direct provider reads with no offline). *Add this as Task 27 Step 3a when implementing.*

**Placeholder scan:** no "TBD"/"implement later". Two explicit "when implementing, verify X" notes remain (esbuild `node:http` external in Task 9; `secretStorage` type augmentation in Task 27) — these are verification instructions with the fallback spelled out, not placeholders. Task 24 Step 8 instructs creating throwaway stub `.svelte` files if executing strictly in order — acceptable scaffolding, replaced in Tasks 25–26.

**Type consistency:** `MailProvider` method names/signatures are identical across Tasks 5, 6, 11–15, 18, 23. `SyncCursor` discriminated union is consistent (Tasks 5, 12, 14, 17, 18). `CacheChange` / `AccountState` shapes match between Task 18 (producer) and Task 23 (consumer). `ViewState` shape matches between Task 23 (producer) and Tasks 24–26 (consumers). Secret key format `obsidian-email-<accountId>:{refresh,secret}` is identical in Tasks 10, 20, 27, 28 tests.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-10-obsidian-email-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
