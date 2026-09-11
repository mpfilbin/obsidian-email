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
- Add a Microsoft 365 account via Settings → Email → Add account.
- Inbox lists messages; opening one shows the sanitized body.
- Remote images are blocked until "Load remote images" is clicked.
- Search returns server results; clearing restores the list.
- Restarting Obsidian keeps accounts and shows cached mail immediately.
