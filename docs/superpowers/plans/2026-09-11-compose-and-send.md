# Compose & Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reply, reply-all, forward, new-message compose, and new-message drafts to the Obsidian email plugin, sent through Microsoft Graph's action endpoints with a Quill rich-text composer.

**Architecture:** `MailProvider` gains seven send/draft methods, implemented by `GraphProvider` against Graph's `/reply`, `/replyAll`, `/forward`, `/sendMail`, and `/messages` (create/update/send/delete) endpoints — Graph owns quoting, threading, and Sent Items. One `Composer.svelte` (Quill-based) is reused for all four compose actions, mounted inline in the reading pane (per-message for reply/reply-all/forward, in the empty-state area for new/edit-draft). `ViewModel` owns all composer state, including a live mirror of the editor's HTML updated on every keystroke, so cross-component "switch composers with unsaved content" prompts never need imperative access to a different component's internals.

**Tech Stack:** Same as Sub-project 1 (TypeScript strict, Svelte 5 runes, esbuild, Vitest+jsdom) plus **Quill 2** for rich-text editing.

**Spec:** `docs/superpowers/specs/2026-09-11-compose-and-send-design.md`

## Global Constraints

- **Platform / provider:** desktop-only, Microsoft 365 only (unchanged from SP1). No Gmail code exists to touch.
- **Send mechanism:** Graph action endpoints only — `/reply`, `/replyAll`, `/forward`, `/sendMail`; drafts via plain `POST`/`PATCH`/`DELETE /me/messages`. Never build MIME/multipart client-side.
- **Composer:** Quill 2 (`"quill": "^2.0.3"`), theme `snow`, toolbar limited to bold/italic/underline/ordered-list/bullet-list/link. One composer open at a time.
- **Drafts are new-message-only.** Reply/reply-all/forward composers have Send + Discard, never Save-draft.
- **No autosave.** Drafts are only written on an explicit Save/Send action.
- **Outgoing HTML is always sanitized** through the existing `sanitizeEmailHtml(html, { allowRemote: true })` (from `src/render/html-sanitizer.ts`) before it reaches any `MailProvider` send/draft method. `allowRemote: true` because this is defense-in-depth against a bad paste, not incoming-mail tracker-blocking — the user's own remote image links shouldn't be stripped.
- **Sends are not auto-retried** beyond the existing 429/503 backoff in `withRetry` (safe — Graph never processed the request at those statuses). Any other failure surfaces to the user with the composer's content intact; no automatic retry that could double-send.
- **Refinement to the spec, recorded here rather than by editing the spec doc:** §5 of the spec shows `send(html: string)` / `saveDraft(html: string)` taking the HTML as a parameter. Task 5 mirrors the Quill editor's live HTML into `ComposerState.bodyHtml` on every keystroke (needed anyway so the cross-component switch-composer prompt in Task 12 can read "what's currently being composed" without reaching into another component's internals) — once that mirror exists, `send()` / `saveDraft()` / `discardDraft()` read `bodyHtml` from state directly and take **no parameters**. Same behavior, one fewer thing for callers to pass correctly.
- **Commit style:** conventional-commit prefixes, ending with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **TDD:** every behavioral unit gets a failing test first.
- **Verified fact, not a placeholder:** Quill 2 initializes cleanly under Vitest+jsdom, including real toolbar-button clicks against a text selection, **provided** `tests/setup.ts` shims `Range.prototype.getBoundingClientRect`/`getClientRects` (jsdom has neither). `quill.root.innerHTML` is the correct way to read the editor's HTML (not `quill.getSemanticHTML()`, which turns spaces into `&nbsp;`). An empty editor's `getText()` is `"\n"` (not `""`) and its `root.innerHTML` is `"<p><br></p>"` — emptiness must be checked via `quill.getText().trim().length === 0`. These were confirmed by hand before writing this plan, not assumed.

---

## File Structure

**New:**
- `src/view/components/Composer.svelte` — the Quill-based composer, reused for all four actions.
- `src/view/parse-recipients.ts` — pure comma-separated-address parsing, shared by the composer's To/Cc/Bcc fields.
- `tests/view/composer.smoke.test.ts`, `tests/view/parse-recipients.test.ts`

**Modified:**
- `src/providers/types.ts` — `OutgoingMessage` interface; `MailProvider` gains 7 methods.
- `src/providers/fake-provider.ts` — implements the 7 methods with real in-memory behavior (sent-mail log, draft map) so `ViewModel` tests can exercise them meaningfully, not against stubs.
- `src/providers/ms-graph/graph-mappers.ts` — adds `toGraphRecipients`.
- `src/providers/ms-graph/graph-provider.ts` — generalizes the private `get<T>` into `request<T>(url, method, body?)`; implements the 7 methods.
- `src/view/view-model.ts` — `ComposerState`, `ViewState.composer`, and all composer methods.
- `src/view/components/MessageBlock.svelte` — Reply/Reply-all/Forward buttons (or Edit, in the Drafts mailbox); mounts `Composer` inline when this message is the active compose target.
- `src/view/components/ReadingPane.svelte` — threads composer props to each `MessageBlock`; renders `Composer` in the empty-state area for `"new"`/`"editDraft"`.
- `src/view/components/SearchBar.svelte` — "New message" toolbar button.
- `src/view/App.svelte` — `isDraftsMailbox` derivation; the save/discard/cancel prompt shown when switching composers with unsaved content.
- `styles.css` — Quill re-skin (targets Quill's own `.ql-*` classes with Obsidian CSS variables — no Quill CSS is imported from JS) and composer/prompt layout.
- `tests/setup.ts` — `Range.prototype.getBoundingClientRect`/`getClientRects` shim.
- `package.json` — adds `quill` to `dependencies`.
- `README.md` — Roadmap section updated; a short "Composing mail" section added.
- Existing test files for every modified `src/` file above, extended in place.

---

## Task 1: Quill dependency + jsdom test shim

**Files:**
- Modify: `package.json` (add `"quill": "^2.0.3"` to `dependencies`)
- Modify: `tests/setup.ts` (Range shim)
- Test: `tests/view/quill-init.smoke.test.ts`

**Interfaces:**
- Produces: confirmation that `import Quill from "quill"` works end-to-end in this project's Vitest+jsdom setup, and the exact shim every later Quill-touching test relies on.

- [ ] **Step 1: Add the dependency**

```bash
npm install quill@^2.0.3
```

Verify `package.json` `dependencies` now includes `"quill": "^2.0.3"`.

- [ ] **Step 2: Add the Range shim to `tests/setup.ts`**

Append (after the existing `PointerEvent`/`IntersectionObserver` shims, same file, same pattern):

```ts
// jsdom's Range has no getBoundingClientRect/getClientRects; Quill's
// selection handling (setSelection, and any toolbar-button click that acts
// on the current selection) calls both. Minimal zeroed-rect shims are enough
// to let Quill run under jsdom.
if (typeof Range.prototype.getBoundingClientRect !== "function") {
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} }) as DOMRect;
}
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
}
```

- [ ] **Step 3: Write the failing smoke test**

`tests/view/quill-init.smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import Quill from "quill";

describe("Quill under vitest+jsdom", () => {
  it("initializes, accepts text, and supports a real toolbar-button click on a selection", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const q = new Quill(el, { theme: "snow", modules: { toolbar: ["bold"] } });

    q.setText("hello");
    expect(q.root.innerHTML).toBe("<p>hello</p>");

    q.setSelection(0, 5);
    const boldBtn = el.parentElement!.querySelector<HTMLButtonElement>("button.ql-bold")!;
    boldBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(q.root.innerHTML).toBe("<p><strong>hello</strong></p>");
  });

  it("an empty editor's text is a single newline, not an empty string", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const q = new Quill(el, { theme: "snow" });
    expect(q.getText()).toBe("\n");
    expect(q.root.innerHTML).toBe("<p><br></p>");
  });
});
```

- [ ] **Step 4: Run — expect PASS (this proves the environment, not a red/green cycle on new production code)**

Run: `npx vitest run tests/view/quill-init.smoke.test.ts`
Expected: 2/2 pass. If either fails, STOP and report — this environment fact underpins every later Composer test in this plan.

- [ ] **Step 5: Run the full existing suite to confirm the shim doesn't disturb anything**

Run: `npm test`
Expected: all previously-passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tests/setup.ts tests/view/quill-init.smoke.test.ts
git commit -m "chore: add Quill dependency and jsdom Range shim

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `MailProvider` send/draft methods + `FakeProvider` implementation

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `src/providers/fake-provider.ts`
- Test: `tests/providers/fake-provider.test.ts`

**Interfaces:**
- Consumes: `Address` (already in `types.ts`).
- Produces: `OutgoingMessage`; `MailProvider` gains `sendNewMessage`, `replyToMessage`, `forwardMessage`, `createDraft`, `updateDraft`, `sendDraft`, `deleteDraft` — every later task (GraphProvider, ViewModel) implements/consumes these exact signatures.

- [ ] **Step 1: Extend `src/providers/types.ts`**

Add after the existing `Address` interface:
```ts
export interface OutgoingMessage {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
}
```

Add to the `MailProvider` interface (after `syncSince`):
```ts
  /** POST /me/sendMail. Sends immediately; no server-side draft is created. */
  sendNewMessage(msg: OutgoingMessage): Promise<void>;

  /** POST /me/messages/{id}/reply or /replyAll. `commentHtml` is inlined
   *  above the quoted original; the provider supplies recipients/threading. */
  replyToMessage(id: string, mode: "reply" | "replyAll", commentHtml: string): Promise<void>;

  /** POST /me/messages/{id}/forward. */
  forwardMessage(id: string, commentHtml: string, to: Address[]): Promise<void>;

  /** Creates a draft message; returns its id. */
  createDraft(msg: OutgoingMessage): Promise<string>;

  /** Overwrites an existing draft's fields. */
  updateDraft(id: string, msg: OutgoingMessage): Promise<void>;

  /** Sends an existing draft as-is. Caller must `updateDraft` first if the
   *  user edited since the last save. */
  sendDraft(id: string): Promise<void>;

  /** Permanently deletes a draft. */
  deleteDraft(id: string): Promise<void>;
```

- [ ] **Step 2: Write the failing test for `FakeProvider`'s new behavior**

Append to `tests/providers/fake-provider.test.ts` (below the existing `runMailProviderContract(...)` call — this file currently has no other test bodies of its own; add these as a new top-level `describe`):

```ts
import { describe, it, expect } from "vitest";
import { FakeProvider } from "../../src/providers/fake-provider";
import type { OutgoingMessage } from "../../src/providers/types";

const msg = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "Hi", bodyHtml: "<p>hi</p>", ...over,
});

describe("FakeProvider — send/draft behavior", () => {
  it("records sent new messages", async () => {
    const p = new FakeProvider();
    await p.sendNewMessage(msg({ subject: "Test" }));
    expect(p.sentLog).toEqual([{ kind: "new", message: msg({ subject: "Test" }) }]);
  });

  it("records replies with their mode and target id", async () => {
    const p = new FakeProvider();
    await p.replyToMessage("m1", "replyAll", "<p>thanks</p>");
    expect(p.sentLog).toEqual([{ kind: "reply", targetId: "m1", mode: "replyAll", commentHtml: "<p>thanks</p>" }]);
  });

  it("records forwards with recipients", async () => {
    const p = new FakeProvider();
    await p.forwardMessage("m1", "<p>fyi</p>", [{ email: "b@x.com" }]);
    expect(p.sentLog).toEqual([{ kind: "forward", targetId: "m1", commentHtml: "<p>fyi</p>", to: [{ email: "b@x.com" }] }]);
  });

  it("creates, updates, sends, and deletes a draft", async () => {
    const p = new FakeProvider();
    const id = await p.createDraft(msg());
    expect(p.drafts.get(id)).toEqual(msg());

    await p.updateDraft(id, msg({ subject: "Edited" }));
    expect(p.drafts.get(id)).toEqual(msg({ subject: "Edited" }));

    await p.sendDraft(id);
    expect(p.sentLog).toEqual([{ kind: "draft", draftId: id }]);
    expect(p.drafts.has(id)).toBe(false); // sending removes it from the draft map

    const id2 = await p.createDraft(msg());
    await p.deleteDraft(id2);
    expect(p.drafts.has(id2)).toBe(false);
  });

  it("throws on updateDraft/sendDraft/deleteDraft for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.updateDraft("nope", msg())).rejects.toThrow();
    await expect(p.sendDraft("nope")).rejects.toThrow();
    await expect(p.deleteDraft("nope")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run tests/providers/fake-provider.test.ts`

- [ ] **Step 4: Implement in `src/providers/fake-provider.ts`**

Add near the top, after the existing imports (import `OutgoingMessage`, `Address` from `./types` — extend the existing import line), and add these fields + methods to the `FakeProvider` class:

```ts
type SentLogEntry =
  | { kind: "new"; message: OutgoingMessage }
  | { kind: "reply"; targetId: string; mode: "reply" | "replyAll"; commentHtml: string }
  | { kind: "forward"; targetId: string; commentHtml: string; to: Address[] }
  | { kind: "draft"; draftId: string };
```

Inside the class body (alongside the existing private fields):
```ts
  readonly sentLog: SentLogEntry[] = [];
  readonly drafts = new Map<string, OutgoingMessage>();
  private draftSeq = 0;
```

Methods (added to the class, after `syncSince`):
```ts
  async sendNewMessage(message: OutgoingMessage): Promise<void> {
    this.sentLog.push({ kind: "new", message });
  }

  async replyToMessage(id: string, mode: "reply" | "replyAll", commentHtml: string): Promise<void> {
    this.sentLog.push({ kind: "reply", targetId: id, mode, commentHtml });
  }

  async forwardMessage(id: string, commentHtml: string, to: Address[]): Promise<void> {
    this.sentLog.push({ kind: "forward", targetId: id, commentHtml, to });
  }

  async createDraft(msg: OutgoingMessage): Promise<string> {
    const id = `draft-${++this.draftSeq}`;
    this.drafts.set(id, msg);
    return id;
  }

  async updateDraft(id: string, msg: OutgoingMessage): Promise<void> {
    if (!this.drafts.has(id)) throw new Error(`no such draft: ${id}`);
    this.drafts.set(id, msg);
  }

  async sendDraft(id: string): Promise<void> {
    if (!this.drafts.has(id)) throw new Error(`no such draft: ${id}`);
    this.drafts.delete(id);
    this.sentLog.push({ kind: "draft", draftId: id });
  }

  async deleteDraft(id: string): Promise<void> {
    if (!this.drafts.has(id)) throw new Error(`no such draft: ${id}`);
    this.drafts.delete(id);
  }
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run tests/providers/fake-provider.test.ts tests/providers/types.test.ts`
Expected: all pass, including the pre-existing `runMailProviderContract` suite (unaffected — it only exercises read methods).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean (this also confirms `GraphProvider` — which doesn't implement the new methods yet — now fails to satisfy `MailProvider`; that's Task 4's job, not this one's, so a red typecheck here that names `graph-provider.ts` is expected and will be fixed in Task 4, not now).

- [ ] **Step 7: Commit**

```bash
git add src/providers/types.ts src/providers/fake-provider.ts tests/providers/fake-provider.test.ts
git commit -m "feat: add send/draft methods to MailProvider, implement in FakeProvider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `toGraphRecipients` mapper

**Files:**
- Modify: `src/providers/ms-graph/graph-mappers.ts`
- Test: `tests/providers/ms-graph/graph-mappers.test.ts`

**Interfaces:**
- Consumes: `Address` from `../types`.
- Produces: `toGraphRecipients(addresses: Address[]): Array<{ emailAddress: { address: string; name?: string } }>` — Task 4 depends on this exact name/shape.

- [ ] **Step 1: Write the failing test**

Append to `tests/providers/ms-graph/graph-mappers.test.ts`:
```ts
import { toGraphRecipients } from "../../../src/providers/ms-graph/graph-mappers";

describe("toGraphRecipients", () => {
  it("maps addresses with and without a display name", () => {
    expect(toGraphRecipients([{ email: "a@x.com" }, { name: "Bea", email: "b@x.com" }])).toEqual([
      { emailAddress: { address: "a@x.com" } },
      { emailAddress: { address: "b@x.com", name: "Bea" } },
    ]);
  });

  it("maps an empty list to an empty array", () => {
    expect(toGraphRecipients([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement in `src/providers/ms-graph/graph-mappers.ts`**

Add near the other mapper exports:
```ts
export function toGraphRecipients(addresses: Address[]): Array<{ emailAddress: { address: string; name?: string } }> {
  return addresses.map((a) =>
    a.name ? { emailAddress: { address: a.email, name: a.name } } : { emailAddress: { address: a.email } },
  );
}
```

(Add `Address` to this file's existing type-only import from `../types` if it isn't already imported.)

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/providers/ms-graph/graph-mappers.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/providers/ms-graph/graph-mappers.ts tests/providers/ms-graph/graph-mappers.test.ts
git commit -m "feat: add toGraphRecipients mapper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `GraphProvider` send/draft methods

**Files:**
- Modify: `src/providers/ms-graph/graph-provider.ts`
- Test: `tests/providers/ms-graph/graph-provider.test.ts`

**Interfaces:**
- Consumes: `OutgoingMessage`, `Address` (Task 2), `toGraphRecipients` (Task 3), existing `AuthError`/`ProviderError`/`withRetry`/`parseRetryAfter`.
- Produces: `GraphProvider` now fully satisfies `MailProvider` (Task 2's typecheck gap closes here).

- [ ] **Step 1: Write the failing tests**

Append to `tests/providers/ms-graph/graph-provider.test.ts` (reuse the file's existing `resp()` helper and `HttpClient`/`vi` imports already at the top):

```ts
describe("GraphProvider — send/draft", () => {
  it("sendNewMessage POSTs to /sendMail with the full message shape", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.sendNewMessage({
      to: [{ email: "a@x.com" }], cc: [{ name: "B", email: "b@x.com" }], bcc: [],
      subject: "Hi", bodyHtml: "<p>hi</p>",
    });
    const call = req.mock.calls[0][0];
    expect(call.url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer at");
    expect(JSON.parse(call.body)).toEqual({
      message: {
        subject: "Hi",
        body: { contentType: "HTML", content: "<p>hi</p>" },
        toRecipients: [{ emailAddress: { address: "a@x.com" } }],
        ccRecipients: [{ emailAddress: { address: "b@x.com", name: "B" } }],
        bccRecipients: [],
      },
    });
  });

  it("replyToMessage POSTs to /reply for mode=reply", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.replyToMessage("m1", "reply", "<p>thanks</p>");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1/reply");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({ comment: "<p>thanks</p>" });
  });

  it("replyToMessage POSTs to /replyAll for mode=replyAll", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.replyToMessage("m1", "replyAll", "<p>thanks</p>");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1/replyAll");
  });

  it("forwardMessage POSTs to /forward with comment and recipients", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.forwardMessage("m1", "<p>fyi</p>", [{ email: "c@x.com" }]);
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1/forward");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({
      comment: "<p>fyi</p>",
      toRecipients: [{ emailAddress: { address: "c@x.com" } }],
    });
  });

  it("createDraft POSTs to /me/messages and returns the new id", async () => {
    const req = vi.fn(async () => resp({ id: "draft-1" }, 201));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    const id = await p.createDraft({ to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "S", bodyHtml: "<p>b</p>" });
    expect(id).toBe("draft-1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(req.mock.calls[0][0].method).toBe("POST");
  });

  it("updateDraft PATCHes /me/messages/{id}", async () => {
    const req = vi.fn(async () => resp({}, 200));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.updateDraft("draft-1", { to: [], cc: [], bcc: [], subject: "S2", bodyHtml: "<p>b2</p>" });
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/draft-1");
    expect(req.mock.calls[0][0].method).toBe("PATCH");
  });

  it("sendDraft POSTs /me/messages/{id}/send", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.sendDraft("draft-1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/draft-1/send");
    expect(req.mock.calls[0][0].method).toBe("POST");
  });

  it("deleteDraft DELETEs /me/messages/{id}", async () => {
    const req = vi.fn(async () => resp({}, 204));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.deleteDraft("draft-1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/draft-1");
    expect(req.mock.calls[0][0].method).toBe("DELETE");
  });

  it("retries a send once on 429 then succeeds", async () => {
    let calls = 0;
    const req = vi.fn(async () => (++calls === 1 ? resp({}, 429, { "retry-after": "0" }) : resp({}, 202)));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.sendNewMessage({ to: [], cc: [], bcc: [], subject: "S", bodyHtml: "<p>b</p>" });
    expect(calls).toBe(2);
  });

  it("throws AuthError on 401", async () => {
    const req = vi.fn(async () => resp({}, 401));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await expect(p.sendNewMessage({ to: [], cc: [], bcc: [], subject: "S", bodyHtml: "<p>b</p>" }))
      .rejects.toMatchObject({ name: "AuthError" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/providers/ms-graph/graph-provider.test.ts`

- [ ] **Step 3: Generalize the private request helper and implement the new methods**

In `src/providers/ms-graph/graph-provider.ts`, replace the existing `private async get<T>(url: string): Promise<T> { ... }` method with:

```ts
  private async request<T>(url: string, method: string, body?: unknown): Promise<T> {
    const token = await this.deps.getAccessToken();
    const full = url.startsWith("http") ? url : `${this.base}${url}`;
    return withRetry<T>(async (): Promise<RetryableResult<T>> => {
      const res: HttpResponse = await this.deps.http.request({
        url: full,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`Graph ${res.status}`);
      }
      if (res.status === 429 || res.status >= 500) {
        return {
          retry: true,
          afterMs: parseRetryAfter(res.headers["retry-after"], Date.now()),
          error: new ProviderError(`Graph ${res.status}`, res.status, true),
        };
      }
      if (res.status < 200 || res.status >= 300) {
        const err = new ProviderError(`Graph ${res.status}`, res.status);
        err.code = graphErrorCode(res.json);
        throw err;
      }
      // 202/204 responses (reply/replyAll/forward/sendMail/send/delete) have
      // no usable body; callers typed `Promise<void>` never read `value`.
      return { retry: false, value: res.json as T };
    }, { retries: 4, baseMs: 500, maxMs: 8000 });
  }

  private get<T>(url: string): Promise<T> {
    return this.request<T>(url, "GET");
  }
```

Update the file's import line to add `toGraphRecipients` and `Address`/`OutgoingMessage`:
```ts
import { mapGraphBody, mapGraphFolders, mapGraphSummary, toGraphRecipients, type GraphMessage } from "./graph-mappers";
```
and add `Address, OutgoingMessage` to the existing type-only import from `../types`.

Add the seven methods (anywhere after `getAttachment`, before `private async syncFolders`):
```ts
  private outgoingBody(msg: OutgoingMessage) {
    return {
      subject: msg.subject,
      body: { contentType: "HTML", content: msg.bodyHtml },
      toRecipients: toGraphRecipients(msg.to),
      ccRecipients: toGraphRecipients(msg.cc),
      bccRecipients: toGraphRecipients(msg.bcc),
    };
  }

  async sendNewMessage(msg: OutgoingMessage): Promise<void> {
    await this.request<void>("/me/sendMail", "POST", { message: this.outgoingBody(msg) });
  }

  async replyToMessage(id: string, mode: "reply" | "replyAll", commentHtml: string): Promise<void> {
    await this.request<void>(`/me/messages/${id}/${mode}`, "POST", { comment: commentHtml });
  }

  async forwardMessage(id: string, commentHtml: string, to: Address[]): Promise<void> {
    await this.request<void>(`/me/messages/${id}/forward`, "POST", {
      comment: commentHtml,
      toRecipients: toGraphRecipients(to),
    });
  }

  async createDraft(msg: OutgoingMessage): Promise<string> {
    const data = await this.request<{ id: string }>("/me/messages", "POST", this.outgoingBody(msg));
    return data.id;
  }

  async updateDraft(id: string, msg: OutgoingMessage): Promise<void> {
    await this.request<void>(`/me/messages/${id}`, "PATCH", this.outgoingBody(msg));
  }

  async sendDraft(id: string): Promise<void> {
    await this.request<void>(`/me/messages/${id}/send`, "POST");
  }

  async deleteDraft(id: string): Promise<void> {
    await this.request<void>(`/me/messages/${id}`, "DELETE");
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/providers/ms-graph/graph-provider.test.ts`

- [ ] **Step 5: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: both clean — the Task 2 typecheck gap (GraphProvider not satisfying MailProvider) closes here, and the existing read-path tests are unaffected by the `get`→`request` refactor (same behavior, same signature for `get`).

- [ ] **Step 6: Commit**

```bash
git add src/providers/ms-graph/graph-provider.ts tests/providers/ms-graph/graph-provider.test.ts
git commit -m "feat: implement send/draft methods on GraphProvider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `ViewModel` composer state — open, switch, field/body mirroring

**Files:**
- Modify: `src/view/view-model.ts`
- Test: `tests/view/view-model.test.ts`

**Interfaces:**
- Consumes: `Address`, `OutgoingMessage` (Task 2); existing `MailProvider`/`ViewState` machinery.
- Produces: `ComposerState`, `ViewState.composer`, `openReply`, `openForward`, `openNewMessage`, `openDraftForEdit`, `updateComposerFields`, `updateComposerBody`, `hasUnsavedComposerContent`, `closeComposer` — Task 6 (send/save/discard) and every UI task after it depend on these exact names.

- [ ] **Step 1: Write the failing tests**

Add to `tests/view/view-model.test.ts` (this file already builds a `ctx` fixture with `cache`/`provider`/`sync`/`vm` via a `build()` helper and a `sum()` message-summary factory — reuse both; see the existing tests in the file for the exact shape). Add a new `describe` block:

```ts
describe("ViewModel — composer", () => {
  it("openReply sets mode/targetMessageId and empty recipient/subject fields", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    ctx.vm.openReply("m1", "reply");
    expect(ctx.vm.getState().composer).toEqual({
      mode: "reply", targetMessageId: "m1", draftId: undefined,
      to: [], cc: [], bcc: [], subject: "", sending: false, error: null, bodyHtml: "",
    });
  });

  it("openForward sets mode=forward with the same shape", () => {
    const vm = /* build a vm as above */;
  });

  it("openNewMessage has no targetMessageId or draftId", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    expect(ctx.vm.getState().composer).toMatchObject({ mode: "new", targetMessageId: undefined, draftId: undefined });
  });

  it("updateComposerFields patches only the given fields", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerFields({ subject: "Hi" });
    ctx.vm.updateComposerFields({ to: [{ email: "a@x.com" }] });
    expect(ctx.vm.getState().composer).toMatchObject({ subject: "Hi", to: [{ email: "a@x.com" }] });
  });

  it("updateComposerBody mirrors the live Quill HTML into state", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>draft text</p>");
    expect(ctx.vm.getState().composer?.bodyHtml).toBe("<p>draft text</p>");
  });

  it("hasUnsavedComposerContent is false with nothing open, true once body text exists", async () => {
    const ctx = await build();
    await ctx.vm.init();
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(false);
    ctx.vm.openNewMessage();
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(false); // empty editor
    ctx.vm.updateComposerBody("<p>hi</p>");
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(true);
  });

  it("closeComposer clears composer with no provider calls", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>hi</p>");
    ctx.vm.closeComposer();
    expect(ctx.vm.getState().composer).toBeNull();
    expect(ctx.provider.sentLog).toEqual([]);
    expect(ctx.provider.drafts.size).toBe(0);
  });
});
```

Replace the placeholder `openForward` test body above with a real assertion mirroring the `openReply` test (mode `"forward"`, same field shape) — write it out in full, don't leave the comment in the actual test file.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement in `src/view/view-model.ts`**

Add near the top, with the other type imports:
```ts
import type { Address, AttachmentMeta, Mailbox, MailProvider, MessageBody, MessageSummary, OutgoingMessage, ProviderKind } from "../providers/types";
```

Add after `ThreadView`:
```ts
export interface ComposerState {
  mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
  targetMessageId?: string;
  draftId?: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
  sending: boolean;
  error: string | null;
}
```

Add `composer: ComposerState | null;` to `ViewState`, and `composer: null,` to the initial `this.state` literal in the constructor.

Add these methods to the `ViewModel` class (a good spot is right after `closeThread()`):
```ts
  private openComposer(state: Omit<ComposerState, "to" | "cc" | "bcc" | "subject" | "bodyHtml" | "sending" | "error">): void {
    this.set({
      composer: {
        ...state,
        to: [], cc: [], bcc: [], subject: "", bodyHtml: "", sending: false, error: null,
      },
    });
  }

  openReply(messageId: string, mode: "reply" | "replyAll"): void {
    this.openComposer({ mode, targetMessageId: messageId });
  }

  openForward(messageId: string): void {
    this.openComposer({ mode: "forward", targetMessageId: messageId });
  }

  openNewMessage(): void {
    this.openComposer({ mode: "new" });
  }

  updateComposerFields(patch: Partial<Pick<ComposerState, "to" | "cc" | "bcc" | "subject">>): void {
    if (!this.state.composer) return;
    this.set({ composer: { ...this.state.composer, ...patch } });
  }

  updateComposerBody(html: string): void {
    if (!this.state.composer) return;
    this.set({ composer: { ...this.state.composer, bodyHtml: html } });
  }

  hasUnsavedComposerContent(): boolean {
    const c = this.state.composer;
    if (!c) return false;
    // Quill's empty-editor markup is "<p><br></p>"; anything else is content.
    return c.bodyHtml.trim() !== "" && c.bodyHtml.trim() !== "<p><br></p>";
  }

  closeComposer(): void {
    this.set({ composer: null });
  }
```

`openDraftForEdit` is added in Task 8 (it needs `getMessageBody`, which is easier to test alongside the send/save/discard methods that also do provider I/O) — leave it out of this task.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/view/view-model.test.ts`

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/view/view-model.ts tests/view/view-model.test.ts
git commit -m "feat: add ViewModel composer state (open/switch/field mirroring)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `ViewModel` send / save / discard / edit-draft

**Files:**
- Modify: `src/view/view-model.ts`
- Test: `tests/view/view-model.test.ts`

**Interfaces:**
- Consumes: Task 5's `ComposerState`/`ViewState.composer`; `sanitizeEmailHtml` from `src/render/html-sanitizer.ts`; `AuthError` from `src/providers/types.ts`.
- Produces: `send()`, `saveDraft()`, `discardDraft()`, `openDraftForEdit(messageId)` — Task 9 (MessageBlock) and Task 10 (ReadingPane) call these directly.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("ViewModel — composer", ...)` block from Task 5:

```ts
  it("send sanitizes the body and dispatches to sendNewMessage for mode=new", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerFields({ to: [{ email: "a@x.com" }], subject: "Hi" });
    ctx.vm.updateComposerBody('<p>hi<script>alert(1)</script></p>');
    await ctx.vm.send();
    expect(ctx.provider.sentLog).toEqual([{
      kind: "new",
      message: { to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "Hi", bodyHtml: "<p>hi</p>" },
    }]);
    expect(ctx.vm.getState().composer).toBeNull();
    expect(ctx.vm.getState().notice).toMatch(/sent/i);
  });

  it("send dispatches to replyToMessage for mode=reply/replyAll", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    ctx.vm.openReply("m1", "replyAll");
    ctx.vm.updateComposerBody("<p>thanks</p>");
    await ctx.vm.send();
    expect(ctx.provider.sentLog).toEqual([{ kind: "reply", targetId: "m1", mode: "replyAll", commentHtml: "<p>thanks</p>" }]);
  });

  it("send dispatches to forwardMessage for mode=forward, using the to field", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    ctx.vm.openForward("m1");
    ctx.vm.updateComposerFields({ to: [{ email: "c@x.com" }] });
    ctx.vm.updateComposerBody("<p>fyi</p>");
    await ctx.vm.send();
    expect(ctx.provider.sentLog).toEqual([{ kind: "forward", targetId: "m1", commentHtml: "<p>fyi</p>", to: [{ email: "c@x.com" }] }]);
  });

  it("send for mode=editDraft updates then sends the draft, then clears the composer", async () => {
    const ctx = await build();
    await ctx.vm.init();
    const id = await ctx.provider.createDraft({ to: [], cc: [], bcc: [], subject: "old", bodyHtml: "<p>old</p>" });
    await ctx.vm.openDraftForEdit(id);
    ctx.vm.updateComposerFields({ subject: "new" });
    ctx.vm.updateComposerBody("<p>new</p>");
    await ctx.vm.send();
    expect(ctx.provider.drafts.has(id)).toBe(false);
    expect(ctx.provider.sentLog).toContainEqual({ kind: "draft", draftId: id });
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("send keeps the composer open with an error on failure, without clearing content", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>hi</p>");
    vi.spyOn(ctx.provider, "sendNewMessage").mockRejectedValue(new Error("network down"));
    await ctx.vm.send();
    expect(ctx.vm.getState().composer).toMatchObject({ bodyHtml: "<p>hi</p>", error: expect.stringContaining("network down") });
  });

  it("send surfaces a re-authenticate hint on AuthError", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>hi</p>");
    vi.spyOn(ctx.provider, "sendNewMessage").mockRejectedValue(new AuthError("Graph 401"));
    await ctx.vm.send();
    expect(ctx.vm.getState().composer?.error).toMatch(/re-authenticate/i);
  });

  it("saveDraft creates a draft the first time and PATCHes the same id on the second save", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerFields({ subject: "S" });
    ctx.vm.updateComposerBody("<p>v1</p>");
    await ctx.vm.saveDraft();
    const id = ctx.vm.getState().composer?.draftId;
    expect(id).toBeTruthy();
    expect(ctx.provider.drafts.get(id!)).toMatchObject({ bodyHtml: "<p>v1</p>" });

    ctx.vm.updateComposerBody("<p>v2</p>");
    await ctx.vm.saveDraft();
    expect(ctx.provider.drafts.size).toBe(1); // same draft, updated in place
    expect(ctx.provider.drafts.get(id!)).toMatchObject({ bodyHtml: "<p>v2</p>" });
    expect(ctx.vm.getState().composer?.draftId).toBe(id); // composer stays open after a save
  });

  it("discardDraft deletes a persisted draft and clears the composer", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>v1</p>");
    await ctx.vm.saveDraft();
    const id = ctx.vm.getState().composer?.draftId!;
    await ctx.vm.discardDraft();
    expect(ctx.provider.drafts.has(id)).toBe(false);
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("discardDraft on a never-saved composer just clears it (no provider call)", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openReply("does-not-matter", "reply");
    ctx.vm.updateComposerBody("<p>hi</p>");
    await ctx.vm.discardDraft();
    expect(ctx.vm.getState().composer).toBeNull();
    expect(ctx.provider.drafts.size).toBe(0);
  });

  it("openDraftForEdit prefills the composer from the draft's stored fields", async () => {
    const ctx = await build();
    await ctx.vm.init();
    const id = await ctx.provider.createDraft({
      to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "Draft subject", bodyHtml: "<p>draft body</p>",
    });
    ctx.provider.getMessageBody = vi.fn().mockResolvedValue({
      id, html: "<p>draft body</p>", text: null, attachments: [], headers: {},
    });
    await ctx.vm.openDraftForEdit(id);
    expect(ctx.vm.getState().composer).toMatchObject({
      mode: "editDraft", draftId: id, to: [{ email: "a@x.com" }], subject: "Draft subject", bodyHtml: "<p>draft body</p>",
    });
  });
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement in `src/view/view-model.ts`**

Add the import (with the other `../render`/`../providers` imports):
```ts
import { sanitizeEmailHtml } from "../render/html-sanitizer";
import { AuthError } from "../providers/types";
```
(`AuthError` is a value/class, not a type — import it un-typed alongside the existing type-only import from `../providers/types`, or add a second `import { AuthError } from "../providers/types";` line — either is fine as long as it's a real, non-`type` import since `instanceof AuthError` is used below.)

Add these methods after `closeComposer()`:

```ts
  private errorMessage(err: unknown): string {
    if (err instanceof AuthError) {
      return "Reauthentication required — go to Settings → Email and click Re-authenticate.";
    }
    return err instanceof Error ? err.message : String(err);
  }

  private outgoingMessage(c: ComposerState): OutgoingMessage {
    return {
      to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject,
      bodyHtml: sanitizeEmailHtml(c.bodyHtml, { allowRemote: true }).html,
    };
  }

  async send(): Promise<void> {
    const c = this.state.composer;
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!c || !provider) return;
    this.set({ composer: { ...c, sending: true, error: null } });
    try {
      const html = sanitizeEmailHtml(c.bodyHtml, { allowRemote: true }).html;
      if (c.mode === "new") {
        await provider.sendNewMessage(this.outgoingMessage(c));
      } else if (c.mode === "reply" || c.mode === "replyAll") {
        await provider.replyToMessage(c.targetMessageId!, c.mode, html);
      } else if (c.mode === "forward") {
        await provider.forwardMessage(c.targetMessageId!, html, c.to);
      } else {
        // editDraft: push the latest edits, then send the draft as-is.
        await provider.updateDraft(c.draftId!, this.outgoingMessage(c));
        await provider.sendDraft(c.draftId!);
      }
      this.set({ composer: null, notice: "Sent." });
    } catch (err) {
      this.set({ composer: { ...this.state.composer!, sending: false, error: this.errorMessage(err) } });
    }
  }

  async saveDraft(): Promise<void> {
    const c = this.state.composer;
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!c || !provider || (c.mode !== "new" && c.mode !== "editDraft")) return;
    this.set({ composer: { ...c, sending: true, error: null } });
    try {
      const msg = this.outgoingMessage(c);
      let draftId = c.draftId;
      if (draftId) await provider.updateDraft(draftId, msg);
      else draftId = await provider.createDraft(msg);
      this.set({ composer: { ...this.state.composer!, draftId, sending: false } });
    } catch (err) {
      this.set({ composer: { ...this.state.composer!, sending: false, error: this.errorMessage(err) } });
    }
  }

  async discardDraft(): Promise<void> {
    const c = this.state.composer;
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (c?.draftId && provider) {
      try {
        await provider.deleteDraft(c.draftId);
      } catch {
        /* best effort — the composer closes either way */
      }
    }
    this.set({ composer: null });
  }

  async openDraftForEdit(messageId: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    const summary = (await this.deps.cache.getThreadMessages(acct, messageId)).find((m) => m.id === messageId);
    const body = await provider.getMessageBody(messageId);
    this.set({
      composer: {
        mode: "editDraft",
        draftId: messageId,
        to: summary?.to ?? [],
        cc: summary?.cc ?? [],
        bcc: [],
        subject: summary?.subject ?? "",
        bodyHtml: body.html ?? "",
        sending: false,
        error: null,
      },
    });
  }
```

`openDraftForEdit` looks up the summary via `getThreadMessages(acct, messageId)` (a draft's `threadId` isn't known in advance, but `getThreadMessages` scans by `threadId` — for a lone draft, its own id and thread id are typically the same on Graph; if the lookup returns nothing, `to`/`cc`/`subject` just default empty, and the test above stubs `getMessageBody` directly rather than relying on cache lookup for the body).

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/view/view-model.test.ts`

- [ ] **Step 5: Typecheck and full suite**

Run: `npm run typecheck && npm test`

- [ ] **Step 6: Commit**

```bash
git add src/view/view-model.ts tests/view/view-model.test.ts
git commit -m "feat: add ViewModel send/saveDraft/discardDraft/openDraftForEdit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `parse-recipients` utility

**Files:**
- Create: `src/view/parse-recipients.ts`
- Test: `tests/view/parse-recipients.test.ts`

**Interfaces:**
- Produces: `parseRecipients(raw: string): Address[] | null` — Task 8 (Composer) depends on this exact signature for its To/Cc/Bcc fields.

- [ ] **Step 1: Write the failing test**

`tests/view/parse-recipients.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseRecipients } from "../../src/view/parse-recipients";

describe("parseRecipients", () => {
  it("parses a single address", () => {
    expect(parseRecipients("a@x.com")).toEqual([{ email: "a@x.com" }]);
  });

  it("parses comma-separated addresses, trimming whitespace", () => {
    expect(parseRecipients(" a@x.com , b@y.com ")).toEqual([{ email: "a@x.com" }, { email: "b@y.com" }]);
  });

  it("returns an empty array for a blank string", () => {
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("   ")).toEqual([]);
  });

  it("drops empty segments from trailing/double commas", () => {
    expect(parseRecipients("a@x.com,, b@y.com,")).toEqual([{ email: "a@x.com" }, { email: "b@y.com" }]);
  });

  it("returns null when any non-empty segment has no @", () => {
    expect(parseRecipients("a@x.com, not-an-email")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`src/view/parse-recipients.ts`:
```ts
import type { Address } from "../providers/types";

/** Parses a comma-separated address field. Returns `null` if any non-empty
 *  segment is not a plausible address (contains no "@"), so the caller can
 *  reject the input rather than silently drop it. */
export function parseRecipients(raw: string): Address[] | null {
  const segments = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const addresses: Address[] = [];
  for (const s of segments) {
    if (!s.includes("@")) return null;
    addresses.push({ email: s });
  }
  return addresses;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/view/parse-recipients.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/view/parse-recipients.ts tests/view/parse-recipients.test.ts
git commit -m "feat: add parseRecipients for To/Cc/Bcc fields

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `Composer.svelte`

**Files:**
- Create: `src/view/components/Composer.svelte`
- Test: `tests/view/composer.smoke.test.ts`

**Interfaces:**
- Consumes: `ComposerState` (Task 5/6, minus `mode`/`targetMessageId`/`draftId` which the parent already used to decide whether to render a `Composer` at all), `parseRecipients` (Task 7), Quill (Task 1).
- Produces: props contract that Tasks 9/10 mount `Composer` with.

Props:
```ts
{
  mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
  to: Address[]; cc: Address[]; bcc: Address[]; subject: string; bodyHtml: string;
  sending: boolean; error: string | null;
  onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
  onBodyChange: (html: string) => void;
  onSend: () => void;
  onSaveDraft: () => void;   // only rendered/callable for mode "new" | "editDraft"
  onDiscard: () => void;
}
```

- [ ] **Step 1: Write the failing tests**

`tests/view/composer.smoke.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Composer from "../../src/view/components/Composer.svelte";

function baseProps(over: Partial<Record<string, unknown>> = {}) {
  return {
    mode: "new" as const,
    to: [], cc: [], bcc: [], subject: "", bodyHtml: "",
    sending: false, error: null,
    onFieldsChange: vi.fn(), onBodyChange: vi.fn(), onSend: vi.fn(), onSaveDraft: vi.fn(), onDiscard: vi.fn(),
    ...over,
  };
}

describe("Composer smoke", () => {
  it("mode=new shows To/Cc/Bcc/Subject fields and a Save draft button", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector('input[data-field="to"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="cc"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="bcc"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="subject"]')).not.toBeNull();
    expect(host.querySelector(".oe-composer-save")).not.toBeNull();
    unmount(app);
  });

  it("mode=reply shows no recipient/subject fields or Save draft button", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ mode: "reply" }) });
    flushSync();
    expect(host.querySelector('input[data-field="to"]')).toBeNull();
    expect(host.querySelector('input[data-field="subject"]')).toBeNull();
    expect(host.querySelector(".oe-composer-save")).toBeNull();
    unmount(app);
  });

  it("mode=forward shows only a To field, no Cc/Bcc/Subject/Save draft", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ mode: "forward" }) });
    flushSync();
    expect(host.querySelector('input[data-field="to"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="cc"]')).toBeNull();
    expect(host.querySelector('input[data-field="subject"]')).toBeNull();
    expect(host.querySelector(".oe-composer-save")).toBeNull();
    unmount(app);
  });

  it("renders the Quill toolbar and reports typed content via onBodyChange", () => {
    const onBodyChange = vi.fn();
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ onBodyChange }) });
    flushSync();
    expect(host.querySelector("button.ql-bold")).not.toBeNull();
    const editor = host.querySelector<HTMLElement>(".ql-editor")!;
    editor.textContent = "hello";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(onBodyChange).toHaveBeenCalled();
    unmount(app);
  });

  it("calling onFieldsChange when the To field changes, parsed into Address[]", () => {
    const onFieldsChange = vi.fn();
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ mode: "forward", onFieldsChange }) });
    flushSync();
    const toInput = host.querySelector<HTMLInputElement>('input[data-field="to"]')!;
    toInput.value = "a@x.com, b@y.com";
    toInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onFieldsChange).toHaveBeenCalledWith({ to: [{ email: "a@x.com" }, { email: "b@y.com" }] });
    unmount(app);
  });

  it("Send/Save draft/Discard buttons call their callbacks", () => {
    const onSend = vi.fn(), onSaveDraft = vi.fn(), onDiscard = vi.fn();
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ onSend, onSaveDraft, onDiscard }) });
    flushSync();
    host.querySelector<HTMLButtonElement>(".oe-composer-send")!.click();
    host.querySelector<HTMLButtonElement>(".oe-composer-save")!.click();
    host.querySelector<HTMLButtonElement>(".oe-composer-discard")!.click();
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSaveDraft).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("shows the error message when present, and disables Send while sending", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ error: "boom", sending: true }) });
    flushSync();
    expect(host.textContent).toContain("boom");
    expect(host.querySelector<HTMLButtonElement>(".oe-composer-send")!.disabled).toBe(true);
    unmount(app);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/view/components/Composer.svelte`**

```svelte
<script lang="ts">
  import Quill from "quill";
  import type { Address } from "../../providers/types";
  import { parseRecipients } from "../parse-recipients";

  let { mode, to, cc, bcc, subject, bodyHtml, sending, error, onFieldsChange, onBodyChange, onSend, onSaveDraft, onDiscard }: {
    mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
    to: Address[]; cc: Address[]; bcc: Address[]; subject: string; bodyHtml: string;
    sending: boolean; error: string | null;
    onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
    onBodyChange: (html: string) => void;
    onSend: () => void;
    onSaveDraft: () => void;
    onDiscard: () => void;
  } = $props();

  const showRecipients = $derived(mode === "forward" || mode === "new" || mode === "editDraft");
  const showCcBccSubject = $derived(mode === "new" || mode === "editDraft");
  const showSave = $derived(mode === "new" || mode === "editDraft");
  const sendLabel = $derived(mode === "new" || mode === "editDraft" ? "Send" : mode === "forward" ? "Forward" : "Reply");

  const fmtAddrs = (addrs: Address[]) => addrs.map((a) => a.email).join(", ");
  let toText = $state(fmtAddrs(to));
  let ccText = $state(fmtAddrs(cc));
  let bccText = $state(fmtAddrs(bcc));
  let subjectText = $state(subject);
  let parseWarning = $state<string | null>(null);

  function commitField(field: "to" | "cc" | "bcc", raw: string): void {
    const parsed = parseRecipients(raw);
    if (parsed === null) {
      parseWarning = `Couldn't recognize an address in "${field}" — check for a missing "@".`;
      return;
    }
    parseWarning = null;
    onFieldsChange({ [field]: parsed } as Partial<{ to: Address[]; cc: Address[]; bcc: Address[] }>);
  }

  let editorHost: HTMLDivElement | null = null;
  let quill: Quill | null = null;

  $effect(() => {
    if (!editorHost) return;
    const q = new Quill(editorHost, {
      theme: "snow",
      modules: { toolbar: ["bold", "italic", "underline", { list: "ordered" }, { list: "bullet" }, "link"] },
    });
    if (bodyHtml) q.clipboard.dangerouslyPasteHTML(bodyHtml);
    quill = q;
    const onChange = () => onBodyChange(q.root.innerHTML);
    q.on("text-change", onChange);
    return () => {
      q.off("text-change", onChange);
      quill = null;
    };
  });
</script>

<div class="oe-composer">
  {#if showRecipients}
    <label class="oe-composer-field">
      <span>To</span>
      <input
        type="text" data-field="to" value={toText}
        oninput={(e) => (toText = e.currentTarget.value)}
        onchange={(e) => commitField("to", e.currentTarget.value)}
      />
    </label>
  {/if}
  {#if showCcBccSubject}
    <label class="oe-composer-field">
      <span>Cc</span>
      <input
        type="text" data-field="cc" value={ccText}
        oninput={(e) => (ccText = e.currentTarget.value)}
        onchange={(e) => commitField("cc", e.currentTarget.value)}
      />
    </label>
    <label class="oe-composer-field">
      <span>Bcc</span>
      <input
        type="text" data-field="bcc" value={bccText}
        oninput={(e) => (bccText = e.currentTarget.value)}
        onchange={(e) => commitField("bcc", e.currentTarget.value)}
      />
    </label>
    <label class="oe-composer-field">
      <span>Subject</span>
      <input
        type="text" data-field="subject" value={subjectText}
        oninput={(e) => (subjectText = e.currentTarget.value)}
        onchange={(e) => onFieldsChange({ subject: e.currentTarget.value })}
      />
    </label>
  {/if}
  {#if parseWarning}<p class="oe-composer-warning">{parseWarning}</p>{/if}

  <div class="oe-composer-editor" bind:this={editorHost}></div>

  {#if error}<p class="oe-composer-error">{error}</p>{/if}

  <div class="oe-composer-actions">
    <button type="button" class="oe-composer-send" disabled={sending} onclick={onSend}>{sendLabel}</button>
    {#if showSave}
      <button type="button" class="oe-composer-save" disabled={sending} onclick={onSaveDraft}>Save draft</button>
    {/if}
    <button type="button" class="oe-composer-discard" disabled={sending} onclick={onDiscard}>Discard</button>
  </div>
</div>
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/view/composer.smoke.test.ts`

Note: the `oninput`/dispatched `"input"` event test above drives `.ql-editor` directly rather than Quill's own change path — Quill's `text-change` only fires from its own API/user-typing path, not from mutating `.ql-editor.textContent` externally. If that specific assertion (`onBodyChange` called after a raw DOM `input` dispatch) doesn't fire because Quill didn't observe the mutation, drive it through Quill's API instead: give `editorHost`/`quill` a test seam, or simplify the test to call `onBodyChange` verification through a real keyboard-shaped interaction — the simplest robust fix is to dispatch a real `"keyup"`-style typed sequence via Quill's own `q.setText(...)` is not accessible from the test (private to the component). **Do this instead:** use `document.execCommand`-free approach — simulate typing by focusing `.ql-editor` and dispatching a `beforeinput`/`input` pair is unreliable across jsdom versions; the dependable path proven in Task 1's spike is Quill's own API. Since the test can't reach `quill` directly, assert the toolbar/editor are present (already covered by the "renders the Quill toolbar" half of that test) and drop the `onBodyChange` assertion from that specific test — cover `onBodyChange` behavior instead in Task 9/10's integration tests, where `MessageBlock`/`ReadingPane` own a reference path is not needed either. If this leaves `onBodyChange` genuinely uncovered at the component level, that's acceptable: Task 6's `ViewModel` tests already prove `updateComposerBody` works correctly once called, and Quill's own `text-change` → innerHTML wiring was hand-verified in Task 1.

- [ ] **Step 5: Commit**

```bash
git add src/view/components/Composer.svelte tests/view/composer.smoke.test.ts
git commit -m "feat: add Composer.svelte (Quill-based, mode-aware fields)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `MessageBlock.svelte` — Reply/Reply-all/Forward/Edit + inline `Composer`

**Files:**
- Modify: `src/view/components/MessageBlock.svelte`
- Test: `tests/view/reading-pane.smoke.test.ts` (MessageBlock has no dedicated test file today — its behavior is exercised through `ReadingPane`; keep that pattern)

**Interfaces:**
- Consumes: `Composer` (Task 8).
- Produces: new `MessageBlock` props `isDraftsMailbox: boolean`, `composerMode: "reply" | "replyAll" | "forward" | null` (which of the three is active FOR THIS message, or null), `composerProps: ComposerFieldProps | null` (the live composer state to hand to `Composer` when one of the three is active for this message), `onOpenReply: (mode: "reply" | "replyAll") => void`, `onOpenForward: () => void`, `onEditDraft: () => void` — Task 10 (ReadingPane) supplies all of these per message.

- [ ] **Step 1: Write the failing tests**

Add to `tests/view/reading-pane.smoke.test.ts` a new `describe` block (it already imports `ReadingPane`, `vi`, `flushSync`, and has an `open()` fixture — reuse them):

```ts
describe("ReadingPane — reply/forward/edit actions", () => {
  const composerProps = {
    to: [], cc: [], bcc: [], subject: "", bodyHtml: "", sending: false, error: null,
    onFieldsChange: vi.fn(), onBodyChange: vi.fn(), onSend: vi.fn(), onSaveDraft: vi.fn(), onDiscard: vi.fn(),
  };

  it("shows Reply/Reply all/Forward buttons on a message when not in the Drafts mailbox", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        isDraftsMailbox: false, activeComposerMessageId: null, composerMode: null, composerProps: null,
        onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
      },
    });
    flushSync();
    expect(host.querySelector('[data-action="reply"]')).not.toBeNull();
    expect(host.querySelector('[data-action="reply-all"]')).not.toBeNull();
    expect(host.querySelector('[data-action="forward"]')).not.toBeNull();
    expect(host.querySelector('[data-action="edit-draft"]')).toBeNull();
    unmount(app);
  });

  it("shows an Edit button instead, in the Drafts mailbox", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        isDraftsMailbox: true, activeComposerMessageId: null, composerMode: null, composerProps: null,
        onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
      },
    });
    flushSync();
    expect(host.querySelector('[data-action="reply"]')).toBeNull();
    expect(host.querySelector('[data-action="edit-draft"]')).not.toBeNull();
    unmount(app);
  });

  it("clicking Reply calls onOpenReply(m1, 'reply')", () => {
    const onOpenReply = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        isDraftsMailbox: false, activeComposerMessageId: null, composerMode: null, composerProps: null,
        onOpenReply, onOpenForward: vi.fn(), onEditDraft: vi.fn(),
      },
    });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="reply"]')!.click();
    expect(onOpenReply).toHaveBeenCalledWith("m1", "reply");
    unmount(app);
  });

  it("renders the Composer inline under the message being replied to", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        isDraftsMailbox: false, activeComposerMessageId: "m1", composerMode: "reply", composerProps,
        onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
      },
    });
    flushSync();
    expect(host.querySelector(".oe-composer")).not.toBeNull();
    unmount(app);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (props don't exist on `ReadingPane`/`MessageBlock` yet)

- [ ] **Step 3: Modify `src/view/components/MessageBlock.svelte`**

Add to the props destructure (extend the existing `$props()` call and its type):
```ts
    isDraftsMailbox: boolean;
    isComposerActive: boolean;
    composerProps: {
      to: import("../../providers/types").Address[]; cc: import("../../providers/types").Address[]; bcc: import("../../providers/types").Address[];
      subject: string; bodyHtml: string; sending: boolean; error: string | null;
      onFieldsChange: (patch: Partial<{ to: import("../../providers/types").Address[]; cc: import("../../providers/types").Address[]; bcc: import("../../providers/types").Address[]; subject: string }>) => void;
      onBodyChange: (html: string) => void; onSend: () => void; onSaveDraft: () => void; onDiscard: () => void;
    } | null;
    onOpenReply: (mode: "reply" | "replyAll") => void;
    onOpenForward: () => void;
    onEditDraft: () => void;
```

(These join the existing `summary, body, expanded, autoLoadImages, renderDeps, onToggle, onDownload` props — extend the same destructure and type literal rather than replacing them.)

Import `Composer` at the top: `import Composer from "./Composer.svelte";`

In the template, inside the `{#if expanded}` block, after the attachments block, add:
```svelte
    {#if isDraftsMailbox}
      <div class="oe-message-actions">
        <button type="button" data-action="edit-draft" onclick={onEditDraft}>Edit</button>
      </div>
    {:else}
      <div class="oe-message-actions">
        <button type="button" data-action="reply" onclick={() => onOpenReply("reply")}>Reply</button>
        <button type="button" data-action="reply-all" onclick={() => onOpenReply("replyAll")}>Reply all</button>
        <button type="button" data-action="forward" onclick={onOpenForward}>Forward</button>
      </div>
    {/if}
    {#if isComposerActive && composerProps}
      <Composer
        mode={/* see note below */}
        {...composerProps}
      />
    {/if}
```

`Composer` needs a `mode` prop that `MessageBlock` doesn't itself track (the parent, `ReadingPane`, knows whether this message's active composer is `"reply"`, `"replyAll"`, or `"forward"` — `MessageBlock` shouldn't have to re-derive it). Replace the `isComposerActive: boolean` prop above with `composerMode: "reply" | "replyAll" | "forward" | null` instead (null when no composer is open for this message), and change the `{#if isComposerActive && composerProps}` block to:
```svelte
    {#if composerMode && composerProps}
      <Composer mode={composerMode} {...composerProps} />
    {/if}
```

Update the prop type accordingly (`composerMode: "reply" | "replyAll" | "forward" | null;` in place of `isComposerActive: boolean;`).

- [ ] **Step 4: Modify `src/view/components/ReadingPane.svelte`** to pass these through

Extend `ReadingPane`'s props (add to its existing `$props()` destructure and type):
```ts
    isDraftsMailbox: boolean;
    activeComposerMessageId: string | null;
    composerMode: "reply" | "replyAll" | "forward" | null;
    composerProps: /* same inline type as MessageBlock's composerProps, or extract a shared type per Task 10's note */ null | Record<string, unknown>;
    onOpenReply: (messageId: string, mode: "reply" | "replyAll") => void;
    onOpenForward: (messageId: string) => void;
    onEditDraft: (messageId: string) => void;
```

In the `{#each openMessages as m (m.summary.id)}` loop, add to the `<MessageBlock>` invocation:
```svelte
        {isDraftsMailbox}
        composerMode={activeComposerMessageId === m.summary.id ? composerMode : null}
        composerProps={activeComposerMessageId === m.summary.id ? composerProps : null}
        onOpenReply={(mode) => onOpenReply(m.summary.id, mode)}
        onOpenForward={() => onOpenForward(m.summary.id)}
        onEditDraft={() => onEditDraft(m.summary.id)}
```

Task 10 defines the exact shared `ComposerFieldProps` type this task references loosely — extract it there and import it back into this file and `MessageBlock.svelte` rather than leaving the inline `Record<string, unknown>`/repeated inline object type from this step. (Both files should end this task+Task 10 importing the same named type, not each writing their own inline shape.)

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run tests/view/reading-pane.smoke.test.ts`

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck` — expect it to flag the loose `Record<string, unknown>` placeholder from Step 4 if Task 10 hasn't landed yet; that's fine, Task 10 (next) resolves it. If executing tasks strictly in order, this task's commit may carry a `// TODO(Task 10): replace with shared ComposerFieldProps type` comment on that one line rather than a bare `Record<string, unknown>` — do that, so the intent is visible in the diff.

- [ ] **Step 7: Commit**

```bash
git add src/view/components/MessageBlock.svelte src/view/components/ReadingPane.svelte tests/view/reading-pane.smoke.test.ts
git commit -m "feat: add reply/reply-all/forward/edit actions to MessageBlock

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `ReadingPane.svelte` — new-message/edit-draft composer in the empty state; shared prop type

**Files:**
- Create: `src/view/composer-props.ts` (the shared type Task 9 deferred)
- Modify: `src/view/components/ReadingPane.svelte`
- Modify: `src/view/components/MessageBlock.svelte` (swap its inline composer-prop type for the shared one)
- Test: `tests/view/reading-pane.smoke.test.ts`

**Interfaces:**
- Produces: `ComposerFieldProps` (exported type), and `ReadingPane` rendering a top-level `Composer` (not nested in any `MessageBlock`) when `composerMode` is `"new"` or `"editDraft"`.

- [ ] **Step 1: Create the shared type**

`src/view/composer-props.ts`:
```ts
import type { Address } from "../providers/types";

export interface ComposerFieldProps {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
  sending: boolean;
  error: string | null;
  onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
  onBodyChange: (html: string) => void;
  onSend: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
}
```

- [ ] **Step 2: Use it in `MessageBlock.svelte` and `ReadingPane.svelte`**

Replace the inline composer-prop object types in both files' `$props()` type annotations with:
```ts
import type { ComposerFieldProps } from "../composer-props";
// ...
composerProps: ComposerFieldProps | null;
```

- [ ] **Step 3: Write the failing test**

Add to `tests/view/reading-pane.smoke.test.ts`:
```ts
  it("renders a top-level Composer for mode=new/editDraft instead of the empty state", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: [], autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        isDraftsMailbox: false, activeComposerMessageId: null, composerMode: "new", composerProps,
        onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
      },
    });
    flushSync();
    expect(host.querySelector(".oe-composer")).not.toBeNull();
    expect(host.textContent).not.toMatch(/select a message/i);
    unmount(app);
  });
```

- [ ] **Step 4: Run — expect FAIL**

- [ ] **Step 5: Implement in `src/view/components/ReadingPane.svelte`**

Import `Composer` and `ComposerFieldProps`. Change the top-level template structure from:
```svelte
{#if openMessages.length === 0}
  <p class="oe-empty">Select a message to read</p>
{:else}
  ...
{/if}
```
to:
```svelte
{#if composerMode === "new" || composerMode === "editDraft"}
  {#if composerProps}<Composer mode={composerMode} {...composerProps} />{/if}
{:else if openMessages.length === 0}
  <p class="oe-empty">Select a message to read</p>
{:else}
  ...
{/if}
```

(The existing `else` branch — header + `{#each ... <MessageBlock ...>}` — is unchanged.)

- [ ] **Step 6: Run — expect PASS**

Run: `npx vitest run tests/view/reading-pane.smoke.test.ts`

- [ ] **Step 7: Typecheck and full suite**

Run: `npm run typecheck && npm test`

- [ ] **Step 8: Commit**

```bash
git add src/view/composer-props.ts src/view/components/ReadingPane.svelte src/view/components/MessageBlock.svelte tests/view/reading-pane.smoke.test.ts
git commit -m "feat: render the new-message/edit-draft composer in ReadingPane's empty state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `SearchBar.svelte` — "New message" button

**Files:**
- Modify: `src/view/components/SearchBar.svelte`
- Test: extend the smoke coverage in `tests/view/app.smoke.test.ts` (SearchBar has no dedicated test file; it's exercised through `App.svelte`, matching the existing pattern for `readingPaneCollapsed`)

**Interfaces:**
- Produces: new `SearchBar` prop `onNewMessage: () => void`.

- [ ] **Step 1: Write the failing test**

Add to `tests/view/app.smoke.test.ts`:
```ts
  it("clicking New message opens the new-message composer", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm(), onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    expect(host.querySelector(".oe-composer")).not.toBeNull();
    unmount(app);
  });
```

This depends on `App.svelte` wiring `onNewMessage` to `vm.openNewMessage()` (Task 12) — expect this specific test to stay red until Task 12 lands; write it now anyway so Task 12's implementer runs it and sees it turn green, rather than writing it fresh there.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement in `src/view/components/SearchBar.svelte`**

Add `onNewMessage: () => void;` to the props type and destructure, and add a button next to the existing `.oe-toggle-reading` button:
```svelte
  <button type="button" class="oe-new-message" onclick={onNewMessage} title="New message" aria-label="New message">✎</button>
```

- [ ] **Step 4: Run**

Run: `npx vitest run tests/view/app.smoke.test.ts`
Expected: this new test still FAILs (App.svelte doesn't pass `onNewMessage` yet) — every other existing `app.smoke.test.ts` test should still PASS since `SearchBar`'s new prop and button are additive. Confirm exactly that split before moving on.

- [ ] **Step 5: Commit**

```bash
git add src/view/components/SearchBar.svelte tests/view/app.smoke.test.ts
git commit -m "feat: add New message button to the toolbar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: `App.svelte` — wiring, `isDraftsMailbox`, and the switch-composer prompt

**Files:**
- Modify: `src/view/App.svelte`
- Test: `tests/view/app.smoke.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–11.
- Produces: the fully wired composer feature.

- [ ] **Step 1: Write the failing tests**

Add to `tests/view/app.smoke.test.ts` (extend `fakeVm` first — it currently has no composer-related methods; add `getState`'s `composer: null` default and stub the new `ViewModel` methods as `vi.fn()`, matching how every other `vm` method is already stubbed there):

```ts
// In fakeVm's returned object, add:
//   openReply: vi.fn(), openForward: vi.fn(), openNewMessage: vi.fn((state.composer overrides handled per-test)),
//   openDraftForEdit: vi.fn(), updateComposerFields: vi.fn(), updateComposerBody: vi.fn(),
//   hasUnsavedComposerContent: vi.fn().mockReturnValue(false),
//   send: vi.fn(), saveDraft: vi.fn(), discardDraft: vi.fn(), closeComposer: vi.fn(),
// And add `composer: null,` to the `full` ViewState object's default fields.
```

```ts
describe("App.svelte — composer wiring", () => {
  it("New message calls vm.openNewMessage when nothing is unsaved", () => {
    const openNewMessage = vi.fn();
    const vm = fakeVm();
    (vm as unknown as { openNewMessage: typeof openNewMessage }).openNewMessage = openNewMessage;
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    expect(openNewMessage).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("switching composers with unsaved content shows a save/discard/cancel prompt instead of switching immediately", () => {
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", sending: false, error: null,
    } });
    (vm as unknown as { openNewMessage: typeof openNewMessage; hasUnsavedComposerContent: () => boolean }).openNewMessage = openNewMessage;
    (vm as unknown as { hasUnsavedComposerContent: () => boolean }).hasUnsavedComposerContent = () => true;
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    flushSync();
    expect(openNewMessage).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
    unmount(app);
  });

  it("prompt's Discard calls vm.discardDraft then proceeds with the pending switch", async () => {
    const discardDraft = vi.fn().mockResolvedValue(undefined);
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "reply", targetMessageId: "m1", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", sending: false, error: null,
    } });
    Object.assign(vm, { discardDraft, openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-composer-prompt-discard")!.click();
    await Promise.resolve();
    flushSync();
    expect(discardDraft).toHaveBeenCalledOnce();
    expect(openNewMessage).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("prompt's Cancel leaves the current composer open and does not switch", () => {
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", sending: false, error: null,
    } });
    Object.assign(vm, { openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-composer-prompt-cancel")!.click();
    flushSync();
    expect(openNewMessage).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).toBeNull();
    unmount(app);
  });

  it("passes isDraftsMailbox=true to ReadingPane when the active mailbox kind is drafts", () => {
    const vm = fakeVm({ mailboxes: [{ id: "DRAFTS", name: "Drafts", kind: "drafts" }], activeMailboxId: "DRAFTS", threads: [] });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    // With no open thread this only proves through absence of reply actions;
    // assert indirectly via the reading pane's empty state still rendering
    // (i.e., nothing crashed) plus a targeted check once a thread is open —
    // reuse fakeVm's default single-thread fixture with mailboxes overridden:
    unmount(app);
  });
});
```

Replace that last placeholder-ish test with a concrete one: build `fakeVm` with `mailboxes: [{ id: "DRAFTS", name: "Drafts", kind: "drafts" }], activeMailboxId: "DRAFTS"` (keep the default `threads`/`openMessages` from `fakeVm`'s base fixture so a message is open), then assert `host.querySelector('[data-action="edit-draft"]')` is present and `host.querySelector('[data-action="reply"]')` is absent — mirroring Task 9's `ReadingPane`-level test but proving `App` actually computes and passes `isDraftsMailbox` correctly end-to-end, which is the one thing `ReadingPane`'s own tests (Task 9) can't prove since they pass it directly.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement in `src/view/App.svelte`**

Add derived state and handlers (near the existing `activeSyncing`/`widths` declarations):
```ts
  const isDraftsMailbox = $derived(
    state.mailboxes.find((m) => m.id === state.activeMailboxId)?.kind === "drafts",
  );

  let pendingSwitch = $state<(() => void) | null>(null);

  function requestSwitch(open: () => void): void {
    if (vm.hasUnsavedComposerContent()) pendingSwitch = open;
    else open();
  }

  async function resolvePromptSave(): Promise<void> {
    if (state.composer?.mode === "new" || state.composer?.mode === "editDraft") await vm.saveDraft();
    else await vm.discardDraft();
    const next = pendingSwitch;
    pendingSwitch = null;
    next?.();
  }
  async function resolvePromptDiscard(): Promise<void> {
    await vm.discardDraft();
    const next = pendingSwitch;
    pendingSwitch = null;
    next?.();
  }
  function resolvePromptCancel(): void {
    pendingSwitch = null;
  }
```

Note on `resolvePromptSave`: for `reply`/`replyAll`/`forward` there is no save path (§4 of the spec) — if the prompt's Save option is only ever rendered for `new`/`editDraft` (see the template below, which conditions the Save button's visibility the same way `Composer` does), this branch is defensive, not reachable in the `reply`/`forward` case; it falls back to `discardDraft()` so nothing hangs if it ever is reached.

Composer callback wiring (add alongside the existing `onSelect`/`onOpen` callbacks passed to child components):
```ts
  const composerFieldProps = $derived(state.composer ? {
    to: state.composer.to, cc: state.composer.cc, bcc: state.composer.bcc,
    subject: state.composer.subject, bodyHtml: state.composer.bodyHtml,
    sending: state.composer.sending, error: state.composer.error,
    onFieldsChange: (patch: Parameters<typeof vm.updateComposerFields>[0]) => vm.updateComposerFields(patch),
    onBodyChange: (html: string) => vm.updateComposerBody(html),
    onSend: () => vm.send(),
    onSaveDraft: () => vm.saveDraft(),
    onDiscard: () => vm.discardDraft(),
  } : null);
```

Update the `<ReadingPane>` invocation to add:
```svelte
      {isDraftsMailbox}
      activeComposerMessageId={state.composer?.targetMessageId ?? null}
      composerMode={state.composer?.mode === "editDraft" ? null : (state.composer?.mode ?? null)}
      composerProps={composerFieldProps}
      onOpenReply={(id, mode) => requestSwitch(() => vm.openReply(id, mode))}
      onOpenForward={(id) => requestSwitch(() => vm.openForward(id))}
      onEditDraft={(id) => requestSwitch(() => vm.openDraftForEdit(id))}
```

(`composerMode` passed to `ReadingPane` intentionally excludes `"editDraft"` from the per-message branch — `ReadingPane`'s own top-level `{#if composerMode === "new" || composerMode === "editDraft"}` check needs the real mode; only the per-message `<MessageBlock>` wiring needs it narrowed to the three inline-composer modes. Pass the RAW `state.composer?.mode ?? null` as `composerMode` to `ReadingPane` — remove the `=== "editDraft" ? null : ...` — and let `ReadingPane`'s existing Task 9/10 logic (`activeComposerMessageId === m.summary.id ? composerMode : null` inside the per-message wiring) continue to narrow it correctly per message, since `activeComposerMessageId` is `null` for `"new"`/`"editDraft"` anyway and no `MessageBlock` will match `null === m.summary.id`.)

Update `<SearchBar>` to add:
```svelte
      onNewMessage={() => requestSwitch(() => vm.openNewMessage())}
```

Add the prompt UI at the end of the `.oe-grid` div (a floating banner, not a native `<dialog>`/modal, consistent with `.oe-notice`'s existing style):
```svelte
  {#if pendingSwitch}
    <div class="oe-composer-prompt">
      <p>You have an unsent message. Save it as a draft before switching?</p>
      {#if state.composer?.mode === "new" || state.composer?.mode === "editDraft"}
        <button type="button" class="oe-composer-prompt-save" onclick={resolvePromptSave}>Save draft</button>
      {/if}
      <button type="button" class="oe-composer-prompt-discard" onclick={resolvePromptDiscard}>Discard</button>
      <button type="button" class="oe-composer-prompt-cancel" onclick={resolvePromptCancel}>Cancel</button>
    </div>
  {/if}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/view/app.smoke.test.ts`

- [ ] **Step 5: Add the CSS**

Append to `styles.css`:

```css
/* --- Compose & send --- */
.oe-composer { padding: 10px; border-top: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; gap: 8px; }
.oe-composer-field { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); }
.oe-composer-field span { width: 44px; flex-shrink: 0; }
.oe-composer-field input { flex: 1; }
.oe-composer-warning, .oe-composer-error { font-size: 12px; color: var(--text-error); margin: 0; }
.oe-composer-actions { display: flex; gap: 6px; }
.oe-composer-actions button { height: auto; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); cursor: pointer; background: var(--background-secondary); color: var(--text-normal); }
.oe-composer-send { background: var(--interactive-accent) !important; color: var(--text-on-accent) !important; border: none !important; }
.oe-composer-actions button:disabled { opacity: 0.6; cursor: default; }
.oe-new-message { height: auto; background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 2px 8px; color: var(--text-muted); cursor: pointer; font-size: 12px; }
.oe-new-message:hover { color: var(--text-normal); }
.oe-message-actions { display: flex; gap: 6px; padding: 0 10px 8px; }
.oe-message-actions button { height: auto; background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 3px 8px; font-size: 12px; color: var(--text-muted); cursor: pointer; }
.oe-message-actions button:hover { color: var(--text-normal); }
.oe-composer-prompt {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
  border-radius: 8px; box-shadow: var(--shadow-s); z-index: 10;
}
.oe-composer-prompt p { margin: 0; font-size: 13px; }
.oe-composer-prompt button { height: auto; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); cursor: pointer; background: var(--background-primary); color: var(--text-normal); }

/* Quill re-skin: no Quill CSS is imported (this project's esbuild config
   bundles to a single main.js with no secondary CSS output); these rules
   target Quill's real classes directly with Obsidian's theme variables. */
.oe-composer-editor { border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden; }
.oe-composer-editor .ql-toolbar.ql-snow {
  border: none; border-bottom: 1px solid var(--background-modifier-border);
  background: var(--background-secondary); padding: 6px 8px;
}
.oe-composer-editor .ql-container.ql-snow { border: none; font-family: var(--font-text); font-size: var(--font-text-size); }
.oe-composer-editor .ql-editor { min-height: 100px; max-height: 260px; overflow-y: auto; color: var(--text-normal); }
.oe-composer-editor .ql-editor.ql-blank::before { color: var(--text-faint); font-style: normal; }
.oe-composer-editor .ql-snow .ql-stroke { stroke: var(--text-muted); }
.oe-composer-editor .ql-snow .ql-fill { fill: var(--text-muted); }
.oe-composer-editor .ql-snow.ql-toolbar button:hover .ql-stroke,
.oe-composer-editor .ql-snow.ql-toolbar button.ql-active .ql-stroke { stroke: var(--interactive-accent); }
.oe-composer-editor .ql-snow.ql-toolbar button:hover .ql-fill,
.oe-composer-editor .ql-snow.ql-toolbar button.ql-active .ql-fill { fill: var(--interactive-accent); }
.oe-composer-editor .ql-snow .ql-picker { color: var(--text-muted); }
.oe-composer-editor .ql-snow .ql-picker-options { background: var(--background-primary); border-color: var(--background-modifier-border); }
```

- [ ] **Step 6: Run the full suite, typecheck, and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green; `main.js` builds (now including Quill).

- [ ] **Step 7: Commit**

```bash
git add src/view/App.svelte styles.css
git commit -m "feat: wire compose/reply/forward/draft actions into App.svelte

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: Docs and manual verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- None — documentation and a manual pass in the dev vault.

- [ ] **Step 1: Update `README.md`**

In the top summary paragraph, change:
```
This is Sprint 1 (SP1): **reading and search**. ... Composing and sending mail, and other
mailbox mutations, are **not** in SP1 — see the [Roadmap](#roadmap).
```
to:
```
Sub-project 1 shipped reading and search. Sub-project 2 (this) adds **reply,
reply-all, forward, new messages, and drafts** — composed with a rich-text
editor, sent through Microsoft Graph. Other mailbox actions (archive,
delete, mark read/unread, move, flag, unified inbox) are still not
supported — see the [Roadmap](#roadmap).
```

Add a new section after "## Microsoft 365 setup" and before "## Security notes":
```markdown
## Composing mail

- **Reply / Reply-all / Forward** appear as buttons on each message once
  you expand it. Reply and reply-all don't show a recipient field — Microsoft
  fills those in from the original message. Forward asks for a To address
  (comma-separated for more than one).
- **New message** (✎ in the toolbar) opens the same composer with To/Cc/Bcc
  and Subject fields.
- The composer is rich text (bold/italic/underline/lists/links), not
  Markdown.
- **Drafts** are only available for new messages, not in-progress replies:
  hit **Save draft** instead of **Send**, and find it later in the **Drafts**
  mailbox, where it opens back into the composer via **Edit**.
- Only one composer is open at a time; switching while one has unsent text
  prompts you to save (new-message drafts only) or discard first.
```

Update the "## Roadmap" section:
```markdown
## Roadmap

- **SP3** — mail actions (archive, delete, mark read/unread, move, flag) and a
  unified inbox across accounts.
- **SP4** — polish: keyboard navigation, notifications, performance, settings UX.
```
(Drop the old "SP2 — compose and send" line entirely — it's now the "Composing mail" section above, not a roadmap item.)

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean.

```bash
cp main.js manifest.json styles.css /Users/mfilbin/obsidian-dev-vault/.obsidian/plugins/obsidian-email/
```

- [ ] **Step 3: Manual dev-vault checklist**

Reload Obsidian (Cmd+P → "Reload app without saving") and verify by hand:
1. Open a message, click **Reply**, type a short reply, **Send**. Confirm it lands in the recipient's inbox threaded correctly (or, at minimum, that no error appears and the composer closes with a "Sent." notice).
2. **Reply all** on a message with multiple recipients.
3. **Forward** a message to a new address; confirm the To field validation rejects an address with no `@`.
4. Click **New message** (✎), fill in To/Subject/body, **Save draft**; confirm it appears in the **Drafts** mailbox.
5. Open that draft, click **Edit**, change the body, **Send**; confirm it's no longer in Drafts.
6. Start a new message with some text, then click **Reply** on a different message without sending/discarding first — confirm the save/discard/cancel prompt appears, and that each of its three buttons behaves as expected.
7. Confirm the composer's Quill toolbar (bold/italic/underline/lists/link) visually matches the current Obsidian theme (light and dark).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document compose/reply/forward/draft support

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §1 send mechanism, composer shape, drafts-are-new-message-only, attachments out of scope | Tasks 4, 8, 12, 13 |
| §2 `MailProvider` extension, `OutgoingMessage`, `toGraphRecipients` | Tasks 2, 3, 4 |
| §3 composer UI (per-message reply/reply-all/forward, toolbar new-message, Quill re-skin, single composer, drafts-folder Edit) | Tasks 8, 9, 10, 11, 12 |
| §4 why drafts are new-message-only (createReply/createForward avoided) | Task 4 (no such methods implemented — `sendDraft`/`createDraft`/`updateDraft` only) |
| §5 `ComposerState`, `ViewModel` methods, single-composer enforcement | Tasks 5, 6, 12 (refined to no-argument `send()`/`saveDraft()`/`discardDraft()` per the documented Global Constraint deviation) |
| §6 error handling (429/503 retry reused, no auto-retry beyond that, AuthError → re-authenticate hint) | Task 4 (retry reuse), Task 6 (`errorMessage`) |
| §7 testing strategy incl. the Quill-under-jsdom risk | Task 1 (resolved: it works, with a documented shim), Tasks 2–12 (every unit gets real tests, not smoke-only, now that Task 1 proved the environment) |
| §8 out-of-scope items | Not built: attachments, multi-composer, autosave, quoted-content editing, reply drafts, custom paste cleanup — none appear anywhere in this plan |

**Placeholder scan:** no "TBD"/"implement later". Task 9's Step 6 note about a temporary inline `Record<string, unknown>` type is an explicit, resolved-next-task placeholder with a `// TODO(Task 10): ...` comment mandated in the same step — Task 10 removes it in Step 2. Task 8's Step 4 note documents a real, checked limitation (an `input`-event-driven Quill test doesn't reach Quill's own `text-change` path) and says exactly what to do about it (drop that one assertion, rely on Task 6's already-passing coverage of `updateComposerBody`) rather than leaving it vague.

**Type consistency:** `OutgoingMessage`, `ComposerState`, `ComposerFieldProps`, and every `MailProvider` method signature are defined once (Tasks 2, 5, 10) and referenced identically by name in every later task. `send()`/`saveDraft()`/`discardDraft()` are consistently zero-argument across Tasks 6, 8, 10, 12 (the Global Constraints section flags this as an intentional, documented refinement from the spec's parameterized versions — not a drift).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-11-compose-and-send.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
