# Obsidian Email Plugin — Sub-project 1: Foundation + Reading

**Status:** Design approved, pending spec review
**Date:** 2026-09-10
**Scope:** Sub-project 1 of 4 (see Decomposition). Desktop-only Obsidian plugin.

---

## 1. Overview

A desktop-only Obsidian plugin that provides a full email client experience for
Google Gmail and Microsoft 365 accounts inside a dedicated Obsidian view. Mail is
fetched via each provider's API, normalized to common domain models, cached
locally in IndexedDB, and rendered in a mail-client-style UI (account switcher →
mailbox list → threaded message list → reading pane).

This sub-project delivers **authentication, account management, the provider
abstraction, read paths for both providers, the mail view, local caching,
incremental background sync, and server-side search**. Compose/send, mail
actions (trash, move, mark-read), and polish are later sub-projects.

### Decomposition (full project)

| # | Sub-project | Scope |
|---|---|---|
| **1** | **Foundation + reading** (this spec) | Plugin scaffold, build/CI/release tooling, dev vault + install scripts, settings UI, per-account PKCE OAuth (Google + Microsoft), token storage via `app.secretStorage`, provider-adapter abstraction, Gmail + Graph read paths, mail view, IndexedDB cache, incremental background sync, server-side search. |
| **2** | **Compose & send** | Composer component, Markdown→MIME (multipart HTML + text), new / reply / reply-all / forward, drafts, attachments (receive + send). |
| **3** | **Actions & organization** | Trash/delete, archive, read/unread, move/label, star/flag, multi-select, keyboard shortcuts, optional unified inbox. |
| **4** | **Polish** | "Save thread to note", command-palette integration, optional new-mail notifications, theming pass. |

Each sub-project gets its own spec → plan → implementation cycle.

### Approved decisions

- **Experience model:** dedicated mail view (custom `ItemView`), not emails-as-notes. Mail cached in plugin storage, never written to the vault in SP1.
- **Auth model:** the user registers their own OAuth apps (Google Cloud "Desktop app" client; Azure "Mobile and desktop" public client) and pastes the client ID (+ Google client secret) into settings. PKCE loopback flow. No bundled client IDs, no broker service.
- **Token storage:** Obsidian's `app.secretStorage` API (`getSecret` / `setSecret` / `listSecrets`), vault-keyed, OS-keychain-backed on desktop. Requires Obsidian **≥ 1.11.4** (API finalized 2026-01-07). `data.json` never holds a credential.
- **Refresh:** background poll (configurable, default 5 min, "manual only" allowed) using incremental sync (Gmail `historyId`, Graph `delta`) + manual refresh button. Unread count in the view only; no notifications in SP1.
- **HTML rendering:** sanitized HTML (DOMPurify), remote images/content blocked by default with a per-message "Load remote images" bar.
- **Cache:** metadata + recently-opened bodies in IndexedDB; attachments fetched on demand, never persisted.
- **Search:** server-side passthrough to each provider's search API. Online-only.
- **UI framework:** Svelte 5 (same stack as the author's `ribbon-bar` plugin), bundled with esbuild + `esbuild-svelte`.
- **Composer format (SP2):** Markdown → multipart/alternative (rendered HTML + plain-text fallback).
- **Delete semantics (SP3):** "delete" = move to provider Trash. No permanent delete in v1.
- **Threading:** keyed on Gmail `threadId` / Graph `conversationId`.
- **Accounts:** per-account view with an account switcher. Unified inbox deferred to SP3.

---

## 2. Architecture & module layout

Bundled with esbuild (CJS output, `obsidian` / `electron` / `@codemirror/*`
external), Svelte 5 for the view layer, desktop-only.

```
src/
  main.ts                     # Plugin entry: lifecycle, view registration, commands, ribbon icon
  settings/
    settings-tab.ts           # Obsidian PluginSettingTab
    settings-store.ts         # Non-secret config (accounts list, poll interval, prefs)
  auth/
    oauth-client.ts           # PKCE flow orchestration (provider-agnostic)
    loopback-server.ts        # Temp 127.0.0.1 http server, one-shot code capture
    token-manager.ts          # secretStorage read/write, refresh, expiry tracking
    provider-oauth-config.ts  # Google vs Microsoft endpoints, scopes
  providers/
    types.ts                  # MailProvider interface + normalized domain models
    gmail/gmail-provider.ts    # Gmail REST adapter
    gmail/gmail-mappers.ts
    ms-graph/graph-provider.ts # Microsoft Graph adapter
    ms-graph/graph-mappers.ts
    provider-factory.ts        # kind -> adapter, wired with its TokenManager
  sync/
    sync-engine.ts            # Per-account incremental sync loop + scheduler
    cursor-store.ts           # historyId / delta-link persistence (in IndexedDB)
  cache/
    mail-cache.ts             # IndexedDB wrapper (idb), typed stores + queries
    schema.ts                 # Store definitions, retention constants, migrations
  view/
    mail-view.ts              # ItemView host, mounts the Svelte app
    App.svelte                # Layout: account switcher | mailbox list | message list | reading pane
    components/*.svelte
    view-model.ts             # Reactive state bridging cache/sync/providers to Svelte stores
  render/
    html-sanitizer.ts         # DOMPurify config + remote-content stripping
    message-renderer.ts       # sanitized HTML mount, "load images" gate, cid resolution
  util/
    logger.ts, result.ts, backoff.ts
```

### Data flow

`sync-engine` pulls from a `MailProvider`, writes normalized records to
`mail-cache` (IndexedDB), and emits `CacheChange` events on an `EventTarget`.
`view-model` reads from `mail-cache` for instant paint and subscribes to those
events, exposing Svelte stores. User actions in the view call `view-model` →
provider method → optimistic cache update → reconcile on response. The view never
touches providers or IndexedDB directly (except read-through fetches for bodies,
attachments, and search, which go through `view-model`).

### Boundaries

- Providers know nothing about cache or UI.
- Cache knows nothing about providers — stores normalized types only.
- The Svelte view depends only on `view-model`.
- Adapters receive a `getAccessToken()` callback bound to one account's
  `token-manager`; they never see refresh tokens or secrets.

---

## 3. OAuth flow

### Client registration (user, documented in README)

- **Google:** Google Cloud project → enable Gmail API → OAuth consent screen
  (External, add self as test user) → Credentials → OAuth client ID → **Desktop
  app** → copy client ID + client secret into plugin settings.
- **Microsoft:** Azure Portal → App registrations → New registration → add
  **Mobile and desktop applications** platform with redirect URI
  `http://localhost` → API permissions: `Mail.ReadWrite`, `Mail.Send`,
  `offline_access`, `User.Read` (delegated) → copy the Application (client) ID
  into plugin settings. No client secret (public client, PKCE only).

### Flow (per account, from settings "Add account")

1. `loopback-server` binds the provider's loopback host on port `0` (OS-assigned
   free port) — `127.0.0.1` for Google, `localhost` for Microsoft — and starts
   listening.
2. `oauth-client` builds the authorize URL: scopes, `code_challenge` (S256),
   `state` (128-bit random, verified on return), and the loopback
   `redirect_uri` — `http://127.0.0.1:<port>` for Google (loopback IP literal,
   no pre-registration needed for Desktop clients), `http://localhost:<port>`
   for Microsoft (host must match the registered `http://localhost` URI; Azure
   allows any port at runtime). Google adds `access_type=offline` +
   `prompt=consent`; Microsoft includes the `offline_access` scope.
3. Open the system browser via Electron `shell.openExternal`.
4. User consents; provider redirects to the loopback URL; the server captures
   `code`, returns a minimal "You can close this tab" HTML page, then closes.
5. `oauth-client` exchanges `code` + `code_verifier` (+ client secret for Google)
   at the token endpoint → `{ access_token, refresh_token, expires_in }`.
6. `token-manager` writes `refresh_token` (and, for Google, the client secret) to
   `app.secretStorage` under keys `email:<accountId>:refresh` and
   `email:<accountId>:secret`. Access token + expiry are held in memory only.
7. Fetch the profile email (`gmail users.getProfile` / Graph `/me`), create the
   `AccountConfig`, persist to `settings-store`, trigger an initial sync.

### Endpoints

| | Google | Microsoft |
|---|---|---|
| Authorize | `https://accounts.google.com/o/oauth2/v2/auth` | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` |
| Token | `https://oauth2.googleapis.com/token` | `https://login.microsoftonline.com/common/oauth2/v2.0/token` |
| Scopes | `https://www.googleapis.com/auth/gmail.modify` | `Mail.ReadWrite Mail.Send offline_access User.Read` |

`gmail.modify` (not `.readonly`) is requested now so SP2/SP3 need no re-consent.

### Refresh

`token-manager.getAccessToken(accountId)` returns the in-memory token if more
than 60 s from expiry, otherwise runs the refresh grant (single-flight per
account) and updates. All provider calls go through it. Refresh failure
(revoked/expired) sets the account status to `needs-reauth`, surfaced in the view
banner and settings; sync skips that account, others unaffected.

### Timeout / cancel

The loopback server auto-closes after 5 minutes or when the user clicks "Cancel"
in settings; the port is freed and no listener dangles. `state` mismatch aborts
with an inline error.

---

## 4. Provider adapter & normalized models

```ts
// providers/types.ts
type ProviderKind = 'gmail' | 'ms-graph';

interface Address { name?: string; email: string; }

interface Mailbox {
  id: string;              // provider-native id (label id / folder id)
  name: string;            // display name
  kind: 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam' | 'custom';
  unreadCount?: number;
}

interface MessageSummary {
  id: string;
  threadId: string;
  mailboxIds: string[];
  from: Address; to: Address[]; cc: Address[];
  subject: string;
  snippet: string;
  date: number;            // epoch ms
  unread: boolean;
  hasAttachments: boolean;
  flagged: boolean;
}

interface AttachmentMeta {
  id: string; filename: string; mimeType: string; size: number;
  inline: boolean; contentId?: string;
}

interface MessageBody {
  id: string;
  html: string | null;     // provider-decoded, pre-sanitization
  text: string | null;
  attachments: AttachmentMeta[];
  headers: Record<string, string>;
}

interface Thread { id: string; messageIds: string[]; subject: string; lastDate: number; }

interface Page<T> { items: T[]; nextPageToken?: string; }

type SyncCursor =
  | { kind: 'gmail'; historyId: string }
  | { kind: 'ms-graph'; deltaLinks: Record<string, string> }; // per-folder

interface SyncResult {
  upserts: MessageSummary[];
  deletions: string[];       // message ids removed / trashed
  mailboxChanges: Mailbox[];
  cursor: SyncCursor;
}

interface MailProvider {
  kind: ProviderKind;
  listMailboxes(): Promise<Mailbox[]>;
  listMessages(mailboxId: string, pageToken?: string): Promise<Page<MessageSummary>>;
  getMessageBody(id: string): Promise<MessageBody>;
  getAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer>;
  search(query: string, pageToken?: string): Promise<Page<MessageSummary>>;
  initialCursor(): Promise<SyncCursor>;
  syncSince(cursor: SyncCursor): Promise<SyncResult>;
}
```

### Gmail adapter

- HTTP via Obsidian `requestUrl` (CORS-free).
- Summaries: `users.messages.list` then batched `users.messages.get?format=metadata`
  (headers `From`, `To`, `Cc`, `Subject`, `Date`).
- Body: `users.messages.get?format=full` — walk `payload.parts`, base64url-decode,
  prefer `text/html` then `text/plain`; collect attachment parts.
- Mailboxes: `users.labels.list`; map `INBOX`/`SENT`/`TRASH`/`SPAM`/`DRAFT` →
  `kind`; `CATEGORY_*` and other system labels hidden; user labels → `custom`.
  Gmail "archive" = absence of `INBOX`; expose a synthetic "All Mail" archive
  view via `-in:inbox -in:trash -in:spam` semantics (list uses label `ALL`).
- Sync: `users.history.list?startHistoryId=` → translate `messagesAdded` /
  `messagesDeleted` / `labelsAdded|Removed` into `upserts` / `deletions` /
  mailbox membership changes. `initialCursor` ← `users.getProfile.historyId`.
- Search: `users.messages.list?q=<query>` (Gmail search syntax passed through).

### Microsoft Graph adapter

- HTTP via `requestUrl`.
- Mailboxes: `GET /me/mailFolders?$top=100` (+ `childFolders` one level); map
  well-known names (`inbox`, `sentitems`, `drafts`, `archive`, `deleteditems`,
  `junkemail`) → `kind`; others → `custom`.
- Summaries: `GET /me/mailFolders/{id}/messages?$select=id,conversationId,
  subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,
  flag,bodyPreview&$top=50`.
- Body: `GET /me/messages/{id}?$expand=attachments` — `body.contentType`
  (`html`|`text`), attachments inline via `contentBytes` (base64) or referenced.
- Sync: `GET /me/mailFolders/{id}/messages/delta` per synced folder; persist the
  `@odata.deltaLink` per folder in the cursor. Removed items arrive as
  `@removed` annotations → `deletions`.
- Search: `GET /me/messages?$search="<query>"` (KQL passed through).

### Cross-cutting

- **Rate limiting / retry** (`util/backoff.ts`): honor `Retry-After`, exponential
  backoff with jitter on 429/503, per-account concurrency cap of 4.
- Body fetches during sync are **lazy** — only when a message is opened — so sync
  traffic is metadata-only and cheap.
- **Auth injection:** `provider-factory` constructs each adapter with a
  `getAccessToken` callback bound to that account's `token-manager`.

---

## 5. Sync engine & cache

### Cache — IndexedDB via `idb`, one database per vault

| Store | Key | Contents | Indexes |
|---|---|---|---|
| `accounts` | `accountId` | display name, email, provider kind, status | — |
| `mailboxes` | `accountId/mailboxId` | `Mailbox` + `accountId` | by `accountId` |
| `messages` | `accountId/messageId` | `MessageSummary` + `accountId` | by `accountId/mailboxId` + `date`; by `accountId/threadId` |
| `bodies` | `accountId/messageId` | `MessageBody` + `cachedAt` | by `cachedAt` (LRU eviction) |
| `cursors` | `accountId` | `SyncCursor` + backfill progress | — |
| `meta` | key | schema version, per-account/per-folder last-sync timestamps | — |

### Retention (constants in `cache/schema.ts`, revisited later)

- **Summaries:** rolling window — keep the larger of *last 90 days* or *2,000
  messages per mailbox*; older pruned on each sync.
- **Bodies:** LRU-evict past *200 per account* or older than *30 days*.
- **Attachments:** never persisted.

### Sync engine

- Runs on plugin load and on an interval (`setInterval`; default 5 min;
  configurable 1/5/15/30/60 min or "manual only").
- Per `ok` account:
  - **No cursor →** initial backfill: `listMessages` over Inbox + Sent + a capped
    set of folders, page until the window is filled, then store `initialCursor()`.
  - **Has cursor →** incremental: `syncSince(cursor)`, apply
    `upserts` / `deletions` / `mailboxChanges` to the cache, persist the new cursor.
- Emits `CacheChange` events `{ accountId, mailboxIds, kind }` on an `EventTarget`.
- **Manual refresh** button runs the same incremental path immediately.
- **On-demand backfill:** scrolling to the end of a message list triggers
  `listMessages(nextPageToken)` and caches that page — paged history browsing
  without widening the sync window.
- **Single-flight guard** per account (no overlapping syncs).
- Errors logged; 401 after a refresh attempt → account `needs-reauth`; transient
  errors → account `error`, retried next tick. Per-account and per-folder
  isolation: one folder's delta failing does not abort the rest.

---

## 6. Mail view UI

Registered as an `ItemView` (`VIEW_TYPE = "email-mail-view"`), opened via a ribbon
icon and the command "Open mail". Single instance; mounts `App.svelte`.

### Layout — four resizable, collapsible columns

```
┌──────────┬─────────────┬──────────────────┬───────────────────────┐
│ Accounts │ Mailboxes   │ Message list     │ Reading pane          │
│ (icons)  │ Inbox    12 │ ▸ Jane  Re: ...  │ Subject               │
│  ● G     │ Sent        │   Bob   Invoice  │ From … · date         │
│  ● M365  │ Drafts      │   ...            │ [load remote images]  │
│  + Add   │ Archive     │                  │ <sanitized body>      │
│          │ Trash       │  [load more]     │ ▸ 2 attachments       │
└──────────┴─────────────┴──────────────────┴───────────────────────┘
```

- **Account switcher:** vertical strip of account avatars/initials; badge for
  total unread; `needs-reauth` accounts show a warning dot linking to settings.
  Selecting an account scopes the mailbox + message columns.
- **Mailbox list:** normalized mailboxes for the selected account; standard kinds
  ordered first, custom labels/folders below; unread counts. Click sets the
  active mailbox.
- **Message list:** virtualized (render only visible rows). Row = sender,
  subject, snippet, relative date, unread dot, attachment/flag icons. **Grouped
  by thread**; a thread row expands to its messages. Sorted newest-first.
  Infinite scroll → on-demand backfill. Loading / empty / error states.
- **Reading pane:** thread header; per-message collapsible blocks (collapsed
  except the newest); each shows from/to/cc, date, body, attachment chips
  (click → `getAttachment` → save dialog to disk or the configured vault folder).
  **Read-state is displayed from the server but not mutated in SP1** (marking
  read is SP3). Toolbar: **Refresh**; reply/delete buttons present but disabled
  until SP2/SP3.
- **Search:** input in the message-list header; submits to `provider.search`;
  results replace the list with a "Search: …" pill to clear. Online-only; offline
  shows a notice.

### State bridging

`view-model` exposes Svelte stores: `accounts`, `activeAccountId`, `mailboxes`,
`activeMailboxId`, `messagePage`, `openThread`. It queries `mail-cache` for
instant paint, then reflects `CacheChange` events. Direct provider calls are
limited to `getMessageBody` / `getAttachment` / `search`, all read-through
(cache hit or fetch + cache).

### Styling

`styles.css` using Obsidian CSS variables (`--background-primary`,
`--text-muted`, …). No hardcoded colors. Scoped class + CSS `contain` on the
message body container.

---

## 7. HTML sanitization & security

- **Sanitizer:** bundled **DOMPurify**. Strip `<script>`; neuter `<style>`; drop
  `<iframe>` / `<object>` / `<embed>` / `<form>`; remove all `on*` handlers and
  `javascript:` / non-image `data:` URLs. Allow structural + formatting tags,
  tables, `<img>`, links.
- **Remote content blocking (default on):** before mount, rewrite
  `img[src^="http"]`, `[style*="url("]`, `[background]` to neutralized
  placeholders; flag the message as having blocked content. The reading pane
  shows a **"Load remote images"** bar; clicking re-renders that message with
  originals restored (session-only; per-sender allow-listing deferred).
- **Links:** all `<a href>` open via `shell.openExternal` in the system browser,
  never in-app; `rel="noopener noreferrer"` forced; the real destination URL is
  shown on hover (`title`) so spoofed link text is visible.
- **Render container:** a plain scoped `div` in the Obsidian DOM (not an iframe —
  Obsidian plugins run in a trusted renderer; sanitization is the security
  boundary). CSS `contain` + a max-width wrapper handle newsletter layouts.
- **CID images:** inline `cid:` references resolved from inline attachments →
  `getAttachment` → `blob:` URL, revoked when the thread closes. Not treated as
  remote; load immediately.
- **No telemetry, no external calls** except the two provider APIs and
  user-initiated link opens.

---

## 8. Settings & account management

`PluginSettingTab` with:

- **Accounts section:** list of configured accounts (email, provider, status:
  `OK` / `Needs re-auth` / `Sync error`). Per-account: **Re-authenticate**,
  **Sign out** (best-effort token revoke, clear `secretStorage` keys + that
  account's cache stores), **Remove**.
- **Add account:** pick provider → form for **Client ID** (+ **Client secret**
  for Google) → **Connect** launches the §3 loopback flow → on success, persist
  `AccountConfig`, start initial sync.
- **Preferences:** poll interval (Manual / 1 / 5 / 15 / 30 / 60 min, default 5);
  "Load remote images automatically" (default off); attachment save location
  (Ask each time / vault folder path); sync window days (default 90); default
  account.
- **Danger zone:** "Clear local cache" (drops IndexedDB, keeps accounts/tokens,
  re-syncs).

### Persistence split

- **Non-secret** (`saveData` / `loadData` → `data.json`): accounts list
  (`id`, `email`, `provider`, `clientId`, `addedAt`), prefs. Cursors live in
  IndexedDB, not here.
- **Secret** (`app.secretStorage`): refresh token, Google client secret.
- `data.json` never contains a credential.

```ts
interface PluginSettings {
  schemaVersion: number;
  accounts: AccountConfig[];   // { id, email, provider, clientId, addedAt }
  prefs: {
    pollMinutes: number | null;      // null = manual only
    autoLoadImages: boolean;
    attachmentDir: string | null;    // null = ask each time
    syncWindowDays: number;
    defaultAccountId: string | null;
  };
}
```

---

## 9. Build, CI & release tooling

Ported from the author's `ribbon-bar` plugin, adjusted:

- **`package.json`** scripts: `dev` (esbuild watch), `build` (`tsc -noEmit
  -skipLibCheck` + esbuild production), `test` (`vitest run`), `typecheck`,
  `release` (`bash scripts/release.sh`).
  - devDeps: `esbuild`, `esbuild-svelte`, `svelte`, `typescript`, `obsidian`,
    `vitest`, `jsdom`, `fake-indexeddb`, `@tsconfig/svelte`, `tslib`,
    `@types/node`.
  - deps: `dompurify`, `idb`.
- **`esbuild.config.mjs`:** CJS, `external: ["obsidian", "electron",
  "@codemirror/*"]`, `esbuildSvelte({ compilerOptions: { css: "injected" } })`,
  inline sourcemaps in dev, `outfile: "main.js"`.
- **`manifest.json`:** `id: "obsidian-email"`, `name: "Email"`,
  `isDesktopOnly: true`, `minAppVersion: "1.11.4"` (SecretStorage API),
  `author: "Michael Filbin"`.
- **`.github/workflows/ci.yml`:** `typecheck` / `test` / `build` jobs on
  `pull_request: branches: ['**']`, Node 20, `npm ci`.
- **`.github/workflows/release.yml`:** on push to `master`/`main` touching
  `manifest.json` → build → `gh release create <version>` with `main.js`,
  `manifest.json`, `styles.css`, `--generate-notes`, skip if the release exists.
- **`scripts/release.sh`** + **`version-bump.mjs`** + **`versions.json`:** copied
  from `ribbon-bar` (bump `package.json` → sync `manifest.json` + `versions.json`
  → `npm install` → commit).
- **`tsconfig.json`:** extend `@tsconfig/svelte`, `target` ES2020,
  `moduleResolution` bundler, `strict`, `skipLibCheck`, `types: ["node"]`,
  `include: ["src/**/*.ts", "src/**/*.svelte"]`.
- **`vitest.config.ts`:** `environment: "jsdom"` (sanitizer + mapper tests touch
  the DOM), `include: ["tests/**/*.test.ts"]`.
- **`.gitignore`:** `/.idea/`, `node_modules/`, `main.js`, `*.js.map`,
  `.DS_Store`, plus the dev-vault entries in §9a.
- **`LICENSE.md`:** MIT. **`README.md`:** Google + Azure registration walkthroughs,
  install instructions, security notes, and the Development section from §9a.

---

## 9a. Dev vault & install scripts

A checked-in Obsidian vault at **`dev-vault/`** in the repo root lets the plugin
be tested with no manual setup. All scripts read `PLUGIN_ID` from `manifest.json`
(the pattern already used by `ribbon-bar`'s `uninstall.sh`), never hardcode it,
and default their vault argument to `./dev-vault`.

### Committed vault skeleton

```
dev-vault/
  .obsidian/
    community-plugins.json   # ["obsidian-email"] — plugin enabled on open
    core-plugins.json        # minimal core plugin set
    app.json                 # minimal app config
  README.md                  # what to test, sample checklist
```

Not committed (added to `.gitignore`):

```
dev-vault/.obsidian/plugins/       # built plugin artifacts land here
dev-vault/.obsidian/workspace*.json
dev-vault/.obsidian/hotkeys.json
dev-vault/*.md                     # local scratch notes, except README.md
```

`README.md` is force-added (`git add -f`) so it survives the `*.md` ignore.

### Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `install.sh [vault-path]` | Same shape as `ribbon-bar`'s. `npm run build`, then **copy** `main.js` + `manifest.json` + `styles.css` into `<vault>/.obsidian/plugins/<PLUGIN_ID>/`. Defaults to `./dev-vault`. Verifies the vault path exists. Use for a clean, release-like test. |
| `uninstall.sh [vault-path]` | Ported verbatim from `ribbon-bar` — removes the plugin dir and strips the `community-plugins.json` entry. Defaults to `./dev-vault`. |
| `link.sh [vault-path]` | **New.** Creates `<vault>/.obsidian/plugins/<PLUGIN_ID>/`, **symlinks** the three build artifacts into it (so `npm run dev` esbuild-watch output is picked up live), and `touch`es a `.hotreload` file in that dir. Defaults to `./dev-vault`. |
| `release.sh` | Unchanged (see §9). |

### Live-reload workflow

1. `npm install`
2. Install pjeby's **Hot Reload** plugin into `dev-vault/.obsidian/plugins/hot-reload/` (documented in `README.md`; the `.hotreload` marker file that `link.sh` writes is what it watches).
3. `./scripts/link.sh`
4. Open `dev-vault/` in Obsidian, enable **Email** (and **Hot Reload**).
5. `npm run dev` — edits rebuild `main.js`; Hot Reload reloads the plugin. Without Hot Reload, `Cmd/Ctrl+R` in Obsidian picks up the new build.

`README.md` "Development" section documents steps 1–5.

---

## 10. Testing strategy

Vitest, `jsdom` environment. No network in tests.

- **Provider mappers** (`gmail-mappers`, `graph-mappers`): recorded JSON
  fixtures (sanitized real API shapes) → assert normalized `MessageSummary` /
  `MessageBody` / `Mailbox`. Covers base64url decoding, MIME part selection,
  header parsing, folder→kind mapping.
- **`MailProvider` contract test:** shared suite run against an in-memory
  `FakeProvider` plus each real adapter with `requestUrl` mocked — pagination,
  cursor round-trip, `syncSince` upsert/deletion semantics.
- **`sync-engine`:** `FakeProvider` + `fake-indexeddb` — initial backfill fills
  the window, incremental applies upserts/deletions, single-flight guard, cursor
  persistence, `needs-reauth` transition on 401.
- **`html-sanitizer`:** battery of malicious inputs (script tags, `onerror`,
  `javascript:` href, CSS `url()` exfil, `<iframe>`, SVG script) → assert
  stripped; benign formatting preserved; remote-image detection + restore.
- **`token-manager`:** fake `secretStorage` + fake clock — returns cached token,
  refreshes within the 60 s window, single-flight refresh, marks the account on
  refresh failure.
- **`oauth-client`:** PKCE challenge/verifier correctness, `state` validation, URL
  construction per provider. `loopback-server`: real ephemeral port + simulated
  redirect request.
- **`mail-cache`:** `fake-indexeddb` — query indexes, retention pruning, LRU body
  eviction.
- **Svelte components:** light smoke tests (mount `App.svelte` with a fake
  `view-model`, assert list / reading-pane render). No heavy interaction coverage
  in SP1.

CI `test` job is a merge gate; all non-UI modules well covered.

---

## 11. Error handling

- **`Result<T, E>`** helper for expected failures in provider/auth code;
  exceptions reserved for programmer errors.
- **Auth:** refresh failure → account `needs-reauth`, banner in view + status in
  settings, sync skips that account. Loopback errors (port bind, timeout, `state`
  mismatch, user denies) → inline settings message, server torn down.
- **Network / API:** 429/503 → backoff + retry; surfaced only if persistent. 5xx
  on a single body fetch → reading pane "Couldn't load this message — retry".
  Offline (`navigator.onLine` + fetch failure) → offline pill, serve cache,
  disable search.
- **Cache:** IndexedDB open failure or unhandled schema-version mismatch → log,
  notify once, fall back to direct provider reads (degraded, no offline) rather
  than breaking the view. Explicit migrations for known version bumps.
- **Partial sync failure:** per-account and per-folder isolation; failed folder
  retried next tick.
- **Logging:** `util/logger.ts` with levels gated by a `debug` setting. No PII
  (subjects, addresses) at info level.

---

## 12. Out of scope for Sub-project 1

- Compose, reply, reply-all, forward, drafts, sending (SP2).
- Attachment upload / sending (SP2).
- Trash / delete / archive / move / label / mark-read / flag mutations (SP3).
- Multi-select and keyboard shortcuts (SP3).
- Unified inbox across accounts (SP3).
- New-mail notifications, "save thread to note", command-palette actions beyond
  "Open mail" (SP4).
- Per-sender remote-image allow-listing.
- Mobile support (plugin is permanently desktop-only).
- Permanent (hard) delete.
