# Obsidian Email Plugin — Sub-project 2: Compose & Send

**Status:** Design approved, pending spec review
**Date:** 2026-09-11
**Scope:** Sub-project 2 of the plugin (per the roadmap in
`docs/superpowers/specs/2026-09-10-obsidian-email-foundation-design.md` and
`README.md`): new message, reply, reply-all, forward, and new-message drafts.
Builds on Sub-project 1 (foundation + reading), which is implemented and
shipped — see that spec and
`docs/superpowers/plans/2026-09-10-obsidian-email-foundation.md`.

---

## 1. Overview

SP1 is read-only. This sub-project adds the ability to reply to, reply-all
to, and forward a message, compose a brand-new message, and save/edit/send
new-message drafts — all against **Microsoft 365 only** (Gmail support was
removed after SP1 shipped; see `docs/superpowers/sp1-followups.md`).

The plugin leans on Microsoft Graph's own reply/reply-all/forward/send-mail
**action endpoints** rather than building MIME messages itself: Graph quotes
the original message, sets threading headers, and delivers the mail — the
plugin only ever supplies the *new* content the user wrote. Composing uses a
**rich-text (WYSIWYG) editor** ([Quill](https://quilljs.com/)), not Markdown;
the editor's own HTML output is sanitized through the existing SP1
`sanitizeEmailHtml` before it's ever sent, then handed to Graph as-is.

### Approved decisions

- **Send mechanism:** Graph action endpoints (`/reply`, `/replyAll`,
  `/forward`, `/sendMail`) for immediate sends — one call each, Graph owns
  quoting/threading/Sent-Items. New messages use `/sendMail` directly
  (no server-side draft created for an immediate send).
- **Composer:** one inline Quill rich-text editor, reused for all four
  actions, embedded in the reading pane — **no Markdown**, no separate
  compose window/modal. **One composer open at a time**; opening a second
  compose action while one holds unsent content prompts save/discard.
- **Drafts are new-message-only.** Reply/reply-all/forward get Send and
  Discard, not Save-draft (see §4 for why). New-message drafts are plain
  Graph messages (`POST`/`PATCH /me/messages`), editable from the existing
  read-only "Drafts" mailbox, sendable via `PATCH` then `POST .../send`,
  deletable via `DELETE`.
- **No autosave.** Manual "Save draft" only, for new messages.
- **Recipients:** reply/reply-all use whatever Graph fills in (sender /
  sender+original recipients) — no editable To/Cc for those two. Forward and
  new-message get an editable To/Cc/Bcc field.
- **Attachments on send are out of scope** for this sub-project (see §8).
- **Outgoing HTML is sanitized** through the same `sanitizeEmailHtml` module
  SP1 already built for incoming mail, as defense-in-depth against anything
  a paste into Quill might carry in. This is reuse, not a new security
  surface.
- **Sends are not auto-retried** beyond the existing 429/503 backoff (safe —
  those mean Graph never processed the request). Any other failure surfaces
  to the user with their text intact, rather than risking a silent
  double-send via automatic retry.

---

## 2. Provider abstraction

`MailProvider` (currently read-only) gets seven new methods, directly on the
interface rather than via a second parallel interface — there is exactly one
provider (`GraphProvider`) and no near-term second one, so interface
segregation here would be speculative:

```ts
// src/providers/types.ts

export interface Address {
  name?: string;
  email: string;
}

export interface OutgoingMessage {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string; // already sanitized by the caller (ViewModel)
}

export interface MailProvider {
  // ...existing read methods (unchanged)...

  /** POST /me/sendMail. Sends immediately; no draft is created. */
  sendNewMessage(msg: OutgoingMessage): Promise<void>;

  /** POST /me/messages/{id}/reply or /replyAll. `commentHtml` is inlined
   *  above the quoted original; Graph supplies recipients and threading. */
  replyToMessage(id: string, mode: "reply" | "replyAll", commentHtml: string): Promise<void>;

  /** POST /me/messages/{id}/forward. */
  forwardMessage(id: string, commentHtml: string, to: Address[]): Promise<void>;

  /** POST /me/messages (a message body with no `/send` call is a draft).
   *  Returns the new draft's id. */
  createDraft(msg: OutgoingMessage): Promise<string>;

  /** PATCH /me/messages/{id}. */
  updateDraft(id: string, msg: OutgoingMessage): Promise<void>;

  /** POST /me/messages/{id}/send. Caller must `updateDraft` first if the
   *  user made edits since the last save. */
  sendDraft(id: string): Promise<void>;

  /** DELETE /me/messages/{id}. */
  deleteDraft(id: string): Promise<void>;
}
```

`GraphProvider` implements all seven against `https://graph.microsoft.com/v1.0`,
reusing the existing `get<T>`-style retry/auth wrapper (bearer token via
`getAccessToken()`, 429/503 backoff) for these write calls the same way reads
already do. A small mapper, `toGraphRecipients(addresses: Address[])`, turns
`Address[]` into Graph's `[{ emailAddress: { address, name? } }]` shape and is
shared by `sendNewMessage`/`forwardMessage`/`createDraft`/`updateDraft`.

`createDraft`/`updateDraft` POST/PATCH a message body of
`{ subject, body: { contentType: "HTML", content: bodyHtml }, toRecipients, ccRecipients, bccRecipients }`.
`sendNewMessage` posts the same message shape wrapped as `{ message: {...} }`
to `/sendMail`. `replyToMessage`/`forwardMessage` post
`{ comment: commentHtml }` (forward adds `toRecipients`).

---

## 3. Composer UI

One `Composer.svelte` component, reused for all four actions, mounted inline
— never a modal or separate view.

- **Reply / Reply-all / Forward buttons live on each `MessageBlock`**, not
  on the thread-level header — Graph's reply/forward endpoints operate on a
  specific message id, so replying is inherently a per-message action (you
  can reply to any message in a thread, not just the newest). Clicking one
  opens the `Composer` directly below that message block.
  - Reply/Reply-all: Quill editor + Send/Discard. No recipient fields.
  - Forward: Quill editor + a "To" field only (no Cc/Bcc — comma-separated
    addresses, minimal validation: each parsed address is non-empty and
    contains `@`) + Send/Discard.
- **New message:** a "New message" button in the toolbar (`SearchBar.svelte`,
  next to Search/Refresh) opens the same `Composer` in the reading-pane area,
  replacing the "Select a message to read" empty state. Adds To/Cc/Bcc +
  Subject fields above the editor, and a **Save draft** button alongside
  Send/Discard.
- **Quill setup:** `snow` theme, toolbar limited to bold/italic/underline/
  ordered-list/bullet-list/link. Re-skinned with Obsidian CSS variables
  (background/text/border/accent) so it matches light/dark, consistent with
  every other component's styling.
- **Single composer at a time:** opening a new compose action while one is
  open checks `ViewModel.hasUnsavedComposerContent()` first; if true, the UI
  shows a confirm prompt — **Save draft/Discard/Cancel** for a "new message"
  composer, **Discard/Cancel** for reply/reply-all/forward (no draft path
  for those, per §4).
- **Editing a draft:** opening a message in the "Drafts" mailbox shows an
  **Edit** action (instead of the normal read-only view) that loads it into
  the new-message `Composer`, prefilled via the existing `getMessageBody`
  read-through, with `composer.draftId` set so Send/Save reuse `PATCH`
  instead of creating a second draft.

---

## 4. Why drafts are new-message-only

Saving an in-progress **reply** as a draft would require Graph's
`createReply`/`createReplyAll`/`createForward` actions, which return a full
draft message whose `body` already contains the quoted original inlined by
Graph. Editing that draft means the plugin reading and rewriting a quoted
HTML body directly — exactly the complexity the action-endpoint choice
(§1) was meant to avoid. New-message drafts don't have this problem: a draft
is just the user's own `OutgoingMessage`, no quoting involved, so
`createDraft`/`updateDraft`/`sendDraft` stay simple.

Reply/reply-all/forward composers therefore only offer **Send** and
**Discard**. Navigating away with unsent reply text loses it — acceptable
for a first cut; most inline-reply UIs (this now included) treat a reply box
as transient. Revisit if that proves annoying in practice.

---

## 5. `ViewModel` & state

```ts
export interface ComposerState {
  mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
  targetMessageId?: string;  // the message being replied to/forwarded (not set for "new")
  draftId?: string;          // set once a new-message draft has been saved at least once
  to: Address[];
  cc: Address[];   // only ever populated/editable in "new" and "editDraft" modes
  bcc: Address[];  // same
  subject: string; // only shown in "new" and "editDraft" modes; empty otherwise
  sending: boolean;
  error: string | null;
}

// ViewState gains:
//   composer: ComposerState | null
```

New `ViewModel` methods:

- `openReply(messageId: string, mode: "reply" | "replyAll"): void`
- `openForward(messageId: string): void`
- `openNewMessage(): void`
- `openDraftForEdit(messageId: string): Promise<void>` — read-through body
  load, prefills `composer` with `draftId` set to `messageId`.
- `updateComposerFields(patch: Partial<Pick<ComposerState, "to" | "cc" | "bcc" | "subject">>): void`
- `hasUnsavedComposerContent(): boolean` — pure; true whenever `composer` is
  open and holds content that would be lost by closing it: for `reply` /
  `replyAll` / `forward` (no save path at all) that means any non-empty
  editor content; for `new` / `editDraft` it means content that differs from
  the last `createDraft`/`updateDraft`/load snapshot. The save/discard
  prompt (UI-level) calls this before switching composers, and if true,
  its "Discard" option calls `discardDraft()` (never `closeComposer()`
  directly) so the not-yet-saved-vs-already-saved distinction in §5 below
  is handled in one place.
- `send(html: string): Promise<void>` — dispatches on `composer.mode` to the
  matching `MailProvider` method; sanitizes `html` first; on success closes
  the composer and sets a "Sent." notice (reusing the existing `notice`
  field); on failure sets `composer.error` and leaves the composer open with
  its content untouched.
- `saveDraft(html: string): Promise<void>` — `new`/`editDraft` modes only;
  `createDraft` the first time (stores the returned id into
  `composer.draftId`), `updateDraft` on subsequent saves.
- `discardDraft(): Promise<void>` — the general "throw away what's open"
  action for every mode: for `reply`/`replyAll`/`forward` and a
  not-yet-saved `new` composer (no `draftId` yet), nothing was ever
  persisted, so it just clears `composer`; for `editDraft` or a `new`
  composer that already has a `draftId`, it additionally calls
  `deleteDraft(composer.draftId)` first.
- `closeComposer(): void` — clears `composer` with no side effects at all
  (no delete call, ever). Reserved for the case `hasUnsavedComposerContent()`
  is already false, so there is nothing to prompt about; the save/discard
  prompt otherwise always resolves to either a save action or
  `discardDraft()`.

---

## 6. Error handling

- All seven new `GraphProvider` methods go through the same auth
  (`getAccessToken()`) and 429/503 backoff wrapper as the read methods —
  those statuses mean Graph never processed the request, so retrying is
  safe.
- Any other failure (network drop, other 4xx, timeout) is **not**
  auto-retried. `composer.error` is set to a message describing the
  failure; the composer stays open with the user's text intact so they can
  confirm (e.g. check Sent Items) and retry manually rather than risk an
  automatic double-send on an ambiguous failure.
- A `403` is inspected the same way SP1's Gmail-quota fix inspected Graph
  403s: if it looks like a missing-scope/consent issue, the error message
  points at **Re-authenticate** (reusing the existing `reauthAccount` flow)
  instead of a generic failure string.

---

## 7. Testing strategy

- **`GraphProvider`:** unit tests (mocked `HttpClient`, matching the
  existing test style in `tests/providers/ms-graph/graph-provider.test.ts`)
  for each of the seven methods — exact endpoint, method, and body shape;
  bearer header present; 429 triggers one retry then succeeds, matching the
  existing read-method tests.
- **Sanitization:** a `ViewModel` test proving outgoing HTML always passes
  through `sanitizeEmailHtml` before reaching the (mocked) provider call —
  e.g. a `<script>` typed into the composer never appears in the call
  arguments.
- **`ViewModel`:** composer open/close/mode transitions for all five modes;
  `hasUnsavedComposerContent` truth table (nothing open → false; open with
  content matching last save → false; open with unsaved edits → true); send
  success closes the composer and sets the notice; send failure keeps
  `composer` open with `error` set and fields untouched; draft
  create → update (second save PATCHes the same `draftId`, not a second
  POST) → send → delete.
- **`Composer.svelte`:** smoke test only (mounts without throwing, expected
  toolbar buttons and fields present per mode) rather than deep Quill
  interaction tests. Quill needs a real `contenteditable`/Range-API-capable
  DOM; jsdom's fidelity there varies by version. **Verify early in
  implementation** whether Quill initializes cleanly under vitest+jsdom at
  all — if it doesn't, component behavior gets verified manually in the dev
  vault instead, and automated coverage concentrates on `ViewModel`/
  `GraphProvider` (already most of the actual logic).

---

## 8. Out of scope for this sub-project

- Attachments on send (reply, forward, or new message) — needs a file
  picker, size limits, and Graph's separate large-attachment upload API.
- Multiple simultaneous open composers.
- Autosave.
- Editing the quoted content of a reply/forward.
- Draft-saving for replies/reply-all/forward (§4).
- Custom paste-cleanup beyond Quill's defaults + the existing sanitizer pass.
- Gmail — not applicable; Gmail support was removed (see
  `docs/superpowers/sp1-followups.md`).
