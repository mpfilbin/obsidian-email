import { AuthError, ContactsConsentRequired, CursorExpiredError, ProviderError } from "../types";
import type { Address, Contact, ContactDraft, ContactPatch, ContactsProvider, MailProvider, Mailbox, MessageBody, MessageSummary, MessageSummaryPatch, OutgoingMessage, Page, SyncCursor, SyncResult } from "../types";
import type { HttpClient, HttpResponse } from "../http";
import { withRetry, parseRetryAfter, type RetryableResult } from "../../util/backoff";
import { CONTACT_SELECT, mapGraphBody, mapGraphContact, mapGraphFolders, mapGraphSummary, mapGraphSummaryPatch, toGraphContact, toGraphRecipients, type GraphContact, type GraphMessage } from "./graph-mappers";

export interface GraphProviderDeps {
  http: HttpClient;
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  syncFolderIds?: string[];
}

const DEFAULT_BASE = "https://graph.microsoft.com/v1.0";
const SUMMARY_SELECT =
  "id,conversationId,subject,bodyPreview,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,hasAttachments,flag";
// Flagged results are upserted into the cache, so unlike search they need the
// message's real folder id.
const FLAGGED_SELECT = `${SUMMARY_SELECT},parentFolderId`;
const TOP = 25;
const CONTACT_PAGE = 100;
const MAX_CONTACT_PAGES = 500;

/** Pull `error.code` out of a Graph error body, e.g. "resyncRequired". */
function graphErrorCode(json: unknown): string | undefined {
  const code = (json as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === "string" ? code : undefined;
}

/** Pull Graph's human-readable `error.message` out of an error body — the
 *  bare status code alone ("Graph 400") gives no clue why a request was
 *  rejected, and this is the only place that detail is available. */
function graphErrorMessage(json: unknown): string | undefined {
  const message = (json as { error?: { message?: unknown } } | undefined)?.error?.message;
  return typeof message === "string" ? message : undefined;
}

export class GraphProvider implements MailProvider, ContactsProvider {
  readonly kind = "ms-graph" as const;
  private base: string;

  constructor(private deps: GraphProviderDeps) {
    this.base = deps.baseUrl ?? DEFAULT_BASE;
  }

  private async request<T>(url: string, method: string, body?: unknown, opts?: { contacts?: boolean }): Promise<T> {
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
        // A contacts 403 means "token lacks Contacts.ReadWrite", not "sign in
        // again" — keep it from flagging the whole mail account.
        if (opts?.contacts && res.status === 403) throw new ContactsConsentRequired();
        throw new AuthError(`Graph ${res.status}`);
      }
      if (res.status === 429 || res.status >= 500) {
        const retryDetail = graphErrorMessage(res.json);
        return {
          retry: true,
          afterMs: parseRetryAfter(res.headers["retry-after"], Date.now()),
          error: new ProviderError(
            retryDetail ? `Graph ${res.status}: ${retryDetail}` : `Graph ${res.status}`, res.status, true,
          ),
        };
      }
      if (res.status < 200 || res.status >= 300) {
        const detail = graphErrorMessage(res.json);
        const err = new ProviderError(detail ? `Graph ${res.status}: ${detail}` : `Graph ${res.status}`, res.status);
        // Carried so `syncSince` can recognize a `resyncRequired` delta link.
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

  async listMailboxes(): Promise<Mailbox[]> {
    const data = await this.get<{ value?: Parameters<typeof mapGraphFolders>[0] }>(
      "/me/mailFolders?$top=100",
    );
    return mapGraphFolders(data.value ?? []);
  }

  async createMailbox(name: string): Promise<Mailbox> {
    const created = await this.request<Parameters<typeof mapGraphFolders>[0][number]>(
      "/me/mailFolders", "POST", { displayName: name },
    );
    return mapGraphFolders([created])[0];
  }

  async renameMailbox(id: string, name: string): Promise<Mailbox> {
    const updated = await this.request<Parameters<typeof mapGraphFolders>[0][number]>(
      `/me/mailFolders/${id}`, "PATCH", { displayName: name },
    );
    return mapGraphFolders([updated])[0];
  }

  async deleteMailbox(id: string): Promise<void> {
    await this.request<void>(`/me/mailFolders/${id}`, "DELETE");
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

  private outgoingBody(msg: OutgoingMessage) {
    return {
      subject: msg.subject,
      body: { contentType: "HTML", content: msg.bodyHtml },
      toRecipients: toGraphRecipients(msg.to),
      ccRecipients: toGraphRecipients(msg.cc),
      bccRecipients: toGraphRecipients(msg.bcc),
    };
  }

  /** Graph only accepts attachments inline at creation time (sendMail / a new
   *  draft) — `updateDraft` never calls this, since its PATCH endpoint has no
   *  way to replace a message's attachments. */
  private graphAttachments(msg: OutgoingMessage): Record<string, unknown>[] | undefined {
    return msg.attachments?.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.filename,
      contentType: a.mimeType,
      contentBytes: a.contentBytes,
    }));
  }

  async sendNewMessage(msg: OutgoingMessage): Promise<void> {
    const attachments = this.graphAttachments(msg);
    await this.request<void>("/me/sendMail", "POST", {
      message: { ...this.outgoingBody(msg), ...(attachments ? { attachments } : {}) },
    });
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
    const attachments = this.graphAttachments(msg);
    const data = await this.request<{ id: string }>("/me/messages", "POST", {
      ...this.outgoingBody(msg), ...(attachments ? { attachments } : {}),
    });
    return data.id;
  }

  async updateDraft(id: string, msg: OutgoingMessage): Promise<void> {
    await this.request<void>(`/me/messages/${id}`, "PATCH", this.outgoingBody(msg));
  }

  async sendDraft(id: string): Promise<void> {
    await this.request<void>(`/me/messages/${id}/send`, "POST");
  }

  async deleteDraft(id: string): Promise<void> {
    await this.deleteMessage(id);
  }

  async deleteMessage(id: string): Promise<void> {
    await this.request<void>(`/me/messages/${id}`, "DELETE");
  }

  async archiveMessage(id: string): Promise<void> {
    await this.request<void>(`/me/messages/${id}/move`, "POST", { destinationId: "archive" });
  }

  async moveMessage(id: string, destinationMailboxId: string): Promise<void> {
    await this.request<void>(`/me/messages/${id}/move`, "POST", { destinationId: destinationMailboxId });
  }

  async setMessageFlag(id: string, flagged: boolean): Promise<void> {
    await this.request<void>(`/me/messages/${id}`, "PATCH", {
      flag: { flagStatus: flagged ? "flagged" : "notFlagged" },
    });
  }

  async listFlaggedMessages(pageToken?: string): Promise<Page<MessageSummary>> {
    const url = pageToken
      ? pageToken
      : `/me/messages?$filter=flag/flagStatus%20eq%20'flagged'&$select=${FLAGGED_SELECT}&$top=${TOP}`;
    const data = await this.get<{ value?: GraphMessage[]; "@odata.nextLink"?: string }>(url);
    return {
      items: (data.value ?? []).map((m) => mapGraphSummary(m, m.parentFolderId ?? "")),
      nextPageToken: data["@odata.nextLink"],
    };
  }

  async listContacts(): Promise<Contact[]> {
    const out: Contact[] = [];
    let url: string | undefined = `/me/contacts?$select=${CONTACT_SELECT}&$top=${CONTACT_PAGE}`;
    // Bounded so a misbehaving nextLink can't loop forever.
    for (let i = 0; url && i < MAX_CONTACT_PAGES; i++) {
      const data: { value?: GraphContact[]; "@odata.nextLink"?: string } =
        await this.request(url, "GET", undefined, { contacts: true });
      out.push(...(data.value ?? []).map(mapGraphContact));
      url = data["@odata.nextLink"];
    }
    // Still more to fetch after the cap: fail rather than hand back a partial
    // list — ContactSync.replace would otherwise silently delete every contact
    // past the cutoff from the cache.
    if (url) {
      throw new ProviderError(`Contacts listing aborted: too many pages (over ${MAX_CONTACT_PAGES}).`);
    }
    return out;
  }

  async createContact(draft: ContactDraft): Promise<Contact> {
    const created = await this.request<GraphContact>("/me/contacts", "POST", toGraphContact(draft), { contacts: true });
    return mapGraphContact(created);
  }

  async updateContact(id: string, patch: ContactPatch): Promise<Contact> {
    const updated = await this.request<GraphContact>(`/me/contacts/${id}`, "PATCH", toGraphContact(patch), { contacts: true });
    return mapGraphContact(updated);
  }

  async deleteContact(id: string): Promise<void> {
    try {
      await this.request<void>(`/me/contacts/${id}`, "DELETE", undefined, { contacts: true });
    } catch (err) {
      // Already deleted elsewhere — the caller's goal is met.
      if (err instanceof ProviderError && err.status === 404) return;
      throw err;
    }
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
    const upserts: MessageSummaryPatch[] = [];
    const deletions: string[] = [];
    const newDeltaLinks: Record<string, string> = { ...cursor.deltaLinks };

    for (const [folderId, deltaLink] of Object.entries(cursor.deltaLinks)) {
      let url: string = deltaLink;
      for (let i = 0; i < 1000; i++) {
        // Graph answers 410 Gone / `resyncRequired` when a delta token is too
        // old. That is recoverable via a fresh backfill, not a sync failure.
        const data = await this.get<{
          value?: Array<GraphMessage & { "@removed"?: unknown }>;
          "@odata.nextLink"?: string;
          "@odata.deltaLink"?: string;
        }>(url).catch((err: unknown) => {
          if (err instanceof ProviderError && (err.status === 410 || err.code === "resyncRequired")) {
            throw new CursorExpiredError(`Graph delta token for ${folderId} expired`, err);
          }
          throw err;
        });
        for (const item of data.value ?? []) {
          if (item["@removed"]) deletions.push(item.id);
          else upserts.push(mapGraphSummaryPatch(item, folderId));
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
