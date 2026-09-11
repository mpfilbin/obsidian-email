# Email

A full email client for **Gmail** and **Microsoft 365** inside an Obsidian view. Desktop only.

This is Sprint 1 (SP1): **reading and search**. You can connect one or more
accounts, browse mailboxes and threads, read sanitized message bodies, open
attachments, and run server-side searches. Composing and sending mail, and other
mailbox mutations, are **not** in SP1 — see the [Roadmap](#roadmap).

## What it is

- A four-column mail client (accounts, mailboxes, message list, reading pane)
  that lives in a normal Obsidian leaf.
- Works against the Gmail API and the Microsoft Graph API using your own OAuth
  client credentials — there is no shared backend or proxy.
- Offline-friendly: synced mail is cached locally (IndexedDB) so the inbox opens
  instantly, then a background sync refreshes it.
- Message bodies are sanitized before rendering; remote images are blocked by
  default.

## Install

From a release:

1. Download `main.js`, `manifest.json`, and `styles.css` from the release.
2. Copy all three into `<vault>/.obsidian/plugins/obsidian-email/`
   (create the folder if it does not exist).
3. In Obsidian: **Settings → Community plugins**, then enable **Email**.

## Google (Gmail) setup

You need a Google Cloud OAuth **Desktop app** client. Once, per Google account:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   **create a new project** (or pick an existing one).
2. **APIs & Services → Library →** search for **Gmail API** and click **Enable**.
3. **APIs & Services → OAuth consent screen:**
   - User type: **External**.
   - Fill in the required app name / support email fields.
   - **Test users:** add your own Google address.
   - **Scopes:** add `https://www.googleapis.com/auth/gmail.modify`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Desktop app**.
   - Create, then copy the **Client ID** and **Client secret**.
5. In Obsidian: **Settings → Email → Add account:**
   - Provider: **Google (Gmail)**.
   - Paste the **Client ID** and **Client secret**.
   - Click **Connect** and approve access in the browser window that opens.
   - When the loopback page says authentication is complete, return to Obsidian.

## Microsoft 365 setup

You need a Microsoft Entra (Azure AD) app registration. Once, per Microsoft account:

1. Go to the [Azure Portal](https://portal.azure.com/) →
   **Microsoft Entra ID → App registrations → New registration.**
   - Name it.
   - Under **Supported account types**, choose **"Accounts in any organizational
     directory (Any Microsoft Entra ID tenant – Multitenant)"** — or the
     "...and personal Microsoft accounts" variant if you also want to sign in
     with a personal `@outlook.com`/`@hotmail.com` account. **Do not** choose
     "Accounts in this organizational directory only (Single tenant)": this
     plugin authenticates through Microsoft's shared `/common` endpoint (it has
     no way to know your tenant ID in advance), which single-tenant apps
     reject with `AADSTS50194`. A single-tenant registration doesn't add any
     real protection here anyway — your Client ID and this loopback flow are
     already the only way to use the app, so multi-tenant costs you nothing.
   - Register.
2. **Authentication → Add a platform → Mobile and desktop applications:**
   - Check the `http://localhost` redirect URI.
   - Save.
3. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions**, add:
   - `Mail.ReadWrite`
   - `Mail.Send`
   - `offline_access`
   - `User.Read`
4. From the app's **Overview**, copy the **Application (client) ID**.
5. In Obsidian: **Settings → Email → Add account:**
   - Provider: **Microsoft 365**.
   - Paste the **Application (client) ID** (no secret needed).
   - Click **Connect** and approve access in the browser.

**Troubleshooting:** the browser tab always says "Authentication complete" once
the redirect reaches Obsidian, whether or not the sign-in actually succeeded —
check the Notice that appears in Obsidian for the real result. If it says
`AADSTS50194`, your app registration was created as single-tenant: go to the
app's **Authentication** page, change **Supported account types** to
multitenant (see step 1), save, and click **Connect** again — no need to
re-create the app or change the Client ID.

## Security notes

- **Tokens** (refresh tokens, and the Google client secret) are stored in
  Obsidian's `secretStorage`, which is backed by the OS keychain on desktop.
  They are **never** written to `data.json`. `data.json` holds only account
  metadata (id, email, provider, client ID) and your preferences.
- **Remote images are blocked by default.** Each message with remote content
  shows a "Load remote images" button; there is also a global opt-in toggle in
  settings.
- **Links open in your system browser**, not inside Obsidian.
- Message HTML is sanitized (scripts, iframes, event handlers, and
  `javascript:` URLs are stripped) before it is rendered.
- **No telemetry.** The plugin talks only to Google's and Microsoft's APIs and
  to a loopback address (`127.0.0.1` for Google, `localhost` for Microsoft) for
  the OAuth loopback.

## Development

**Prerequisites:** Node.js **24+** and npm **11+**. The pinned version lives in
`.tool-versions` (`asdf install` picks it up); `npm install` enforces it via
`engine-strict`. CI reads the same `.tool-versions` file.

Live-reload workflow using the `dev-vault/` in this repo:

1. `npm install`
2. Install the Hot Reload plugin into the dev vault:
   `git clone https://github.com/pjeby/hot-reload dev-vault/.obsidian/plugins/hot-reload`
3. `./scripts/link.sh` — symlinks the build output into the dev vault.
4. Open `dev-vault/` in Obsidian and enable **Email** and **Hot Reload**.
5. `npm run dev` — edits rebuild `main.js`; Hot Reload reloads the plugin.

Other commands:

- `npm test` — run the vitest suite.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` — typecheck + production bundle (`main.js`).

Design spec and implementation plan:

- Spec: `docs/superpowers/specs/2026-09-10-obsidian-email-foundation-design.md`
- Plan: `docs/superpowers/plans/2026-09-10-obsidian-email-foundation.md`

## Roadmap

- **SP2** — compose and send (new mail, reply, reply-all, forward, drafts).
- **SP3** — mail actions (archive, delete, mark read/unread, move, flag) and a
  unified inbox across accounts.
- **SP4** — polish: keyboard navigation, notifications, performance, settings UX.
