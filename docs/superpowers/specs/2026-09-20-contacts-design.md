# Contacts (M365 Address Book) — Design

## Goal

Integrate the user's Microsoft 365 / Outlook address book. Users can create,
read, update and delete contacts from inside the mail view, and pick contacts
via autocomplete when addressing new messages and forwards.

## Decisions (agreed with the user)

- **UI:** a *Contacts mode* inside the existing mail view (not a separate
  Obsidian view, not modals). The ribbon toggles it; the three content panes
  swap to address book / contact list / contact detail-or-form.
- **Data:** contacts are **cached in IndexedDB** for instant, offline-capable
  autocomplete and list browsing.
- **Sync:** the cache is refreshed by **full reconcile**, not Graph delta (see
  "Why not delta").
- **Composer:** **autocomplete on the existing To/Cc/Bcc text inputs**. No
  recipient-chip rewrite.
- **Fields:** the **core set** — display name, given name, surname, emails,
  mobile/business/home phones, company, job title, notes. Unmodelled Graph
  fields are never touched.
- **Permission:** `Contacts.ReadWrite` (delegated; no admin consent required,
  works for work/school and personal accounts). Existing accounts are
  **prompted on first Contacts use**, not force-logged-out.
- **Scope:** the account's **default Contacts folder only**.

## Why not delta

Graph's contact delta only exists per folder
(`/me/contactFolders/{id}/contacts/delta`); there is no account-wide
`/me/contacts/delta`. The default Contacts folder's id has no documented
well-known alias, and `GET /me/contactFolders` lists *child* folders only, so
delta would need a fragile id lookup (e.g. probing `parentFolderId` of a
contact — which fails for an empty address book). Address books are small, so
a full paged `GET /me/contacts` with a lean `$select`, reconciled wholesale
into the cache, is simpler and robust. It mirrors how folders are already
reconciled (`MailCache.replaceMailboxes`).

## Architecture

### Model (`src/providers/types.ts`)

```ts
interface Contact {
  id: string;
  displayName: string;
  givenName?: string;
  surname?: string;
  emails: Address[];
  mobilePhone?: string;
  businessPhones: string[];
  homePhones: string[];
  companyName?: string;
  jobTitle?: string;
  notes?: string;
}
type ContactDraft = Omit<Contact, "id">;
type ContactPatch = Partial<ContactDraft>;
```

Validation (form + view-model): a contact needs a name (display, given or
surname) or at least one email.

### Provider

```ts
interface ContactsProvider {
  listContacts(): Promise<Contact[]>;              // pages /me/contacts
  createContact(draft: ContactDraft): Promise<Contact>;
  updateContact(id: string, patch: ContactPatch): Promise<Contact>; // PATCH, only edited fields
  deleteContact(id: string): Promise<void>;
}
function supportsContacts(p: MailProvider): p is MailProvider & ContactsProvider;
```

- `GraphProvider` implements both interfaces and reuses `request()`.
- **403 handling:** `request()` currently maps 401/403 to `AuthError`, which
  the sync engine turns into `needs-reauth`. Contacts calls opt into a variant
  where **403 → `ContactsConsentRequired`** (new error class in
  `providers/types.ts`); 401 stays `AuthError`. A mail 403 is unchanged.
- `FakeProvider` implements `ContactsProvider` and a shared contract suite runs
  against it (as `provider-contract.ts` does for mail).
- New mapper functions in `graph-mappers.ts`: `mapGraphContact`,
  `toGraphContactBody` (full, for create) and `toGraphContactPatch` (only
  present fields, for update).

### Cache

- `DB_VERSION` 1 → 2. `openMailDb`'s `upgrade` currently creates every store
  unconditionally; it must be guarded by `oldVersion` so an existing v1 DB
  gains only the new `contacts` store.
- `contacts` store: `keyPath: "key"` = `${accountId}/${id}`, `by-account`
  index. `StoredContact = Contact & { key; accountId }`.
- `ContactCache` (new, `src/cache/contact-cache.ts`): `list(accountId)`,
  `put(accountId, contact)`, `remove(accountId, id)`,
  `replace(accountId, contacts)` (upsert all, delete missing), `clear(accountId)`.
- `MailCache.clearAccount` / `clearAll` also clear contacts (or `ContactCache`
  is called alongside them in `PluginContext`). Degraded mode gets a no-op
  `DEGRADED_CONTACT_CACHE`; contacts then load provider → memory per session.

### Sync (`src/sync/contact-sync.ts`)

`ContactSync` is separate from `SyncEngine` so contact failures can never
change a mail account's status.

- `syncAccount(accountId, { force?: boolean })` pulls `listContacts()` and
  `ContactCache.replace`s. Throttled to once per ~15 min per account unless
  `force`.
- Triggers: plugin start, a slow interval (piggybacking the poll timer or its
  own), entering Contacts mode, and after each create/update/delete.
- Per-account state: `idle | syncing | needs-consent | error` with `lastError`;
  `states` and `changes` emitters like `SyncEngine`.
- `ContactsConsentRequired` → `needs-consent`. `AuthError` → surfaced as the
  existing needs-reauth affordance. Anything else → `error`; cache untouched.
- Account removal calls `ContactCache.clear`.

### Auth / consent

- `OAUTH_CONFIG["ms-graph"].scopes` gains `Contacts.ReadWrite`. New accounts
  consent up front.
- Token refresh sends no `scope`, so existing accounts' mail is unaffected;
  their access tokens simply lack the contacts scope until re-consent.
- "Grant contacts access" runs the existing `PluginContext.reauthAccount`
  (which now requests the full scope list), then force-syncs contacts.

### View-model (`src/view/view-model.ts`)

Adds a `contacts` slice to `ViewState`:
`mode: "mail" | "contacts"`, `contacts: Contact[]` (active account, sorted by
display name), `contactsStatus`, `contactSearch`, `selectedContactId`,
`contactEdit: { mode: "new" | "edit"; draft: ContactDraft; error: string | null; saving: boolean } | null`.

Methods: `setMode`, `selectContact`, `searchContacts`, `newContact`,
`editContact`, `updateContactDraft`, `saveContact`, `cancelContactEdit`,
`deleteContact`, `emailContact(id, email?)`, `grantContactsAccess`,
`suggestRecipients(query): RecipientSuggestion[]`, `hasUnsavedContactEdit`.

- Writes are server-first: call the provider, then update the cache/state on
  success. No optimistic updates. Failure → toast, form stays open with the
  user's input. Delete returning 404 counts as success.
- `ViewModelDeps` gains `getContactsProvider`-style access (via
  `supportsContacts`), the `ContactCache`, and `ContactSync`.
- `hasUnsavedContactEdit` (dirty form) feeds `App`'s `requestSwitch` guard.

## UI

### Entering the mode

- Home tab: a pressed-style **Contacts** toggle (like Search) in a "View" group.
- Palette command: **Email: Open contacts**.
- In Contacts mode the ribbon's new **Contacts** tab auto-selects (same
  mechanism as the contextual Message tab). Commands: New contact, Edit,
  Delete, Email contact, Refresh. Mail-only commands disable via new
  `RibbonContext` facts (`mode`, `hasSelectedContact`, `contactEditing`, …);
  new `RibbonActions` entries carry the contact actions.

### Panes (grid, resizers and account rail unchanged)

- **Column 2 — address book:** "All contacts" with a count; the "Grant
  contacts access" button when `needs-consent`. Slot for future groups.
- **Column 3 — `ContactList.svelte`:** search field (name/email/company match)
  above contacts sorted by display name; row = name + primary email.
- **Column 4:** `ContactDetail.svelte` (read-only card; each email is a link
  that opens a new composer addressed to it) or `ContactForm.svelte`
  (New/Edit; inline Save and Cancel so it works with the ribbon disabled).
- Dirty form + (select other contact | leave mode | switch account) →
  existing confirm guard. Delete → existing confirm pattern.
- `.svelte` files and `view-model.ts` never import `obsidian`.

### Composer autocomplete

- `Composer.svelte` gains one prop `suggest: (query: string) => RecipientSuggestion[]`
  and a dropdown on To, Cc, Bcc (New/Edit draft) and To (Forward). Reply/Reply
  all have no recipient fields.
- Token: text after the last comma in the focused input. Matches name,
  given/surname or email, case-insensitive; prefix matches rank first; max 8;
  one row per email address; addresses already in the field are skipped.
- Keys: ↑/↓ highlight, Enter/Tab accept, Esc closes; mouse uses `mousedown`
  so the input doesn't blur first. Accepting replaces the token with the plain
  address + `", "` (matches `fmtAddrs` / `parseRecipients`, which store bare
  addresses).
- Pure helpers `currentToken()` and `rankSuggestions()` live in
  `src/view/recipient-suggest.ts` (unit-tested); `Composer` stays unaware of
  the cache. Suggestions come from the active account's contacts only.

## Error handling

| Situation | Behaviour |
| --- | --- |
| 403 on a contacts call | `needs-consent`: "Grant contacts access" button; composer suggestions empty; mail unaffected |
| 401 | `AuthError` → existing needs-reauth |
| Network / 5xx | existing `withRetry`; on failure cache untouched, state `error`, toast only if user-triggered |
| Create/update/delete failure | toast; form stays open with input |
| IndexedDB unavailable | degraded shim; contacts in memory per session |
| Account removed | contacts cleared with the account |

## Testing (vitest + jsdom, existing conventions)

- Mappers: Graph↔Contact round-trip; patch contains only edited fields.
- `GraphProvider` contacts: paging; 403 → `ContactsConsentRequired`; a *mail*
  403 still → `AuthError`.
- Provider contract suite for `ContactsProvider` against `FakeProvider`.
- `ContactCache`: `replace` removes remotely-deleted contacts; per-account
  isolation. **DB v1 → v2 migration test with a pre-existing v1 database.**
- `ContactSync`: reconcile, throttle/force, `needs-consent`, error leaves cache.
- View-model: mode switch, select, create/update/delete (server-first, failure
  keeps form), dirty guard, `suggestRecipients`.
- `recipient-suggest` pure functions: token extraction, ranking, exclusion.
- Components: `ContactList`, `ContactForm`, `ContactDetail` smoke tests;
  composer dropdown (keyboard, mousedown accept, Forward, no dropdown in reply).
- Ribbon registry visibility/enablement per mode.
- Thin Obsidian wrappers untested, per repo convention.

## Open items to verify during implementation

- Exchange/Graph's cap on `emailAddresses` per contact (believed to be 3);
  the form should enforce whatever the API allows.
- Max `$top` for `/me/contacts` and the lean `$select` list.
- Whether the default-folder-only `/me/contacts` returns contacts in
  sub-folders (docs say default folder only — confirm).

## Out of scope (separate follow-ups)

Contact sub-folders/groups; org directory / People API (GAL); photos; postal
addresses; vCard import/export; merged multi-account suggestions; recipient
chips.

## Release

New feature → minor bump, **0.5.0**.
