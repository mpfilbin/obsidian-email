# SP1 — deferred follow-ups & plan deviations

Captured at the end of Sub-project 1 (foundation + reading). None of these block SP1;
they are inputs to SP2 planning. The task-by-task and whole-branch reviews are the
source; this is the durable digest.

## Plan → code deviations (deliberate, made during implementation)

- **secretStorage key format:** the plan's Global Constraints specify
  `obsidian-email:<accountId>:refresh` / `:secret`. Obsidian's `SecretStorage`
  (1.11.4+) rejects colons in IDs (`@throws Error if ID is invalid`), so the code
  uses **`obsidian-email-<accountId>-<suffix>`** (dashes). `TokenManager.key()` owns
  the format; `PluginContext.reauthAccount` currently re-derives it as a literal —
  see "secret key helper" below.
- **Error model at provider boundaries:** the plan's §11 says "exceptions only for
  programmer errors". The adapters instead throw **typed exceptions**
  (`AuthError` / `ProviderError` / `CursorExpiredError`) that `SyncEngine` catches at
  one boundary. `Result<T,E>` exists (`src/util/result.ts`) and is available; the
  provider layer just doesn't use it. The plan's own Self-Review flags this as an
  accepted relaxation.
- **`obsidian-augment.d.ts` not created** (plan Task 27): the installed `obsidian`
  types already declare `App.secretStorage` (as a **synchronous** `SecretStorage`
  class). `PluginContext` adapts it to the async `SecretStore` interface with a thin
  wrapper.
- **Svelte test transform** (Ruling I): `@sveltejs/vite-plugin-svelte@4` +
  `svelte.config.js` + `resolve.conditions: ["browser"]` + `src/svelte-shims.d.ts`.
  Plugin v5 needs Vite 6; the installed stack is Vite 5.4 / Svelte 5.57. The esbuild
  production path is untouched.

## Security hardening (SP2)

- **CSS-comment bypass of the style neutralizer.** `<div style='background:url(/*c*/"https://tracker/x")'>`
  is not rewritten (the `REMOTE_CSS_REF` regex is comment-naive). The Rec3
  fail-closed output scan now *flags* it (`blockedRemoteContent` → true, banner
  shows), but it is not stripped. A real fix needs a CSS-aware pass over `style`
  values.
- **`<feImage>` in `<svg><filter>`.** A remote `href` on `<feImage>` survives and is
  **not flagged** (the blocking hook and the `SURVIVING_REMOTE` scan are anchored to
  `<image>` / `<use>`). The `xlink:href` variant survives but *is* flagged. Add
  `feimage` to both. Pre-existing, not a regression.
- **Graph 403 → `AuthError`.** `GraphProvider` still maps every 403 to `needs-reauth`.
  Microsoft returns 403 for some throttling/quota conditions. Apply the same
  error-`reason` inspection that `GmailProvider` got (I6) to Graph.
- **`prefs.attachmentDir` not normalized against `..`.** User-typed (not
  attacker-controlled), but `normalizePath` doesn't resolve `..`, so a folder path
  with `../` segments would write attachments outside the vault. Reject `..`
  segments on the settings field. (The attachment *filename* itself is fully
  sanitized — `src/util/safe-filename.ts`.)
- **`data:` allowlist is partly illusory.** DOMPurify's built-in `DATA_URI_TAGS`
  permits any `data:` URI on media elements regardless of `ALLOWED_URI_REGEXP`.
  Nothing executable (SVG-in-`<img>` is script-disabled), no network egress. The
  test asserting the allowlist works gives false confidence — either tighten with a
  post-sanitize pass or relabel the test.
- **`ADD_ATTR: ["xlink:href", …]`** in the sanitizer is a no-op (DOMPurify allows it
  by default); the real C3 fix is the hook match. Add a comment.

## Provider / sync

- **Gmail list rows never show attachments.** `hydrate()` uses `format=metadata`,
  which omits `payload.parts`, so `hasAttachments` is always `false` for Gmail
  (Graph gets it right via `$select=hasAttachments`). Decide: `format=full` in
  hydrate (cost), or infer from a metadata header. Confirm against a live account.
- **`cid:` angle-bracket asymmetry.** `gmail-mappers` strips `<>` from `contentId`;
  `graph-mappers` does not. Graph returns bare ids in practice, so latent. Normalize
  in both.
- **RFC 2047 encoded-words** (`=?UTF-8?Q?…?=`) in subjects / display names render
  raw for Gmail (Graph pre-decodes). Add a decoder in the Gmail mapper.
- **`RETENTION.summaryPerMailbox` is a trigger, not a cap.** Being over 2000 only
  *enables* the 90-day sweep, and the sweep is account-wide. An account with 5000
  recent messages prunes nothing. Plan weakness — revisit the retention model.
- **`@odata.nextLink` host not origin-checked.** The Bearer token rides along to
  whatever host the response names. Add a cheap `this.base` origin check.
- **Two IndexedDB connections to one DB** (`MailCache` and `CursorStore` each
  `openMailDb()`). Harmless at `DB_VERSION: 1`; on a bump the first blocks the
  second's `upgradeneeded` with no `blocked` handler. Have `MailCache` own the
  connection and hand `CursorStore` its `db`.

## View / UX

- **`autoLoadImages` applies on next refresh, not immediately.** `ViewModel.syncPrefs()`
  runs on `init` / `selectAccount` / `refresh` only. Wire a settings-change signal.
- **`removeAccountFlow` leaves ViewModel state stale** if the removed account was
  active (`activeAccountId` still points at it, `getProvider` → `undefined`).
- **`openThread` fetches bodies serially** — N round-trips for an N-message thread.
  `GmailProvider.mapPool` is the existing bounded-concurrency pattern to reuse.
- **`reloadList` full-account scan.** `listMailboxMessages` does `getAllFromIndex`
  over every cached summary for the account (~8k objects at retention limits) then
  filters in JS to return ~200, on every sync-change event. Use an index cursor
  with early stop.
- **"Blank = ask each time"** for the attachment folder actually triggers an
  `<a download>` click, not a prompt.

## Structural / process

- **secret key helper:** export `secretKey(accountId, suffix)` from `token-manager`
  and use it in `PluginContext.reauthAccount` instead of the duplicated literal.
- **`src/providers/provider-contract.ts` imports `vitest`** — a production directory
  depending on the test framework (not reachable from the esbuild entry, so the
  bundle is fine). Move to `tests/`. Related: `tsconfig.json` `include` is `src/**`
  only, so test files are never typechecked in CI.
- **`main.ts` / `EmailSettingTab.display()` coverage.** The C1 (path traversal) and
  C4 (M365 dropdown) bugs both lived in the untested Obsidian-facing shell. `saveBlob`
  path logic is now extracted and tested (`safe-filename`); `display()` re-entrancy
  now has a test. Broader shell coverage still thin.
- **`withRetry` / `Retry-After`:** now clamped to `maxMs` (was: a `Retry-After: 86400`
  parked the sync for a day holding `SyncEngine`'s in-flight promise).
- **CI runs only on `pull_request`.** A direct push to `main` is unverified;
  `release.yml` publishes without running the suite.
- **`eslint-disable-next-line` comments with no ESLint** in the repo — add ESLint or
  drop the directives.
- **OAuth scopes exceed SP1's read-only remit** (`gmail.modify`, `Mail.ReadWrite`,
  `Mail.Send`) — deliberate, to avoid a re-consent prompt in SP2. Revisit if SP2
  slips.
