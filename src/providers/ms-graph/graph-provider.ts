import { AuthError, CursorExpiredError, ProviderError } from "../types";
import type { Address, MailProvider, Mailbox, MessageBody, MessageSummary, OutgoingMessage, Page, SyncCursor, SyncResult } from "../types";
import type { HttpClient, HttpResponse } from "../http";
import { withRetry, parseRetryAfter, type RetryableResult } from "../../util/backoff";
import { mapGraphBody, mapGraphFolders, mapGraphSummary, toGraphRecipients, type GraphMessage } from "./graph-mappers";

export interface GraphProviderDeps {
  http: HttpClient;
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  syncFolderIds?: string[];
}

const DEFAULT_BASE = "https://graph.microsoft.com/v1.0";
const SUMMARY_SELECT =
  "id,conversationId,subject,bodyPreview,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,hasAttachments,flag";
const TOP = 25;

/** Pull `error.code` out of a Graph error body, e.g. "resyncRequired". */
function graphErrorCode(json: unknown): string | undefined {
  const code = (json as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === "string" ? code : undefined;
}

export class GraphProvider implements MailProvider {
  readonly kind = "ms-graph" as const;
  private base: string;

  constructor(private deps: GraphProviderDeps) {
    this.base = deps.baseUrl ?? DEFAULT_BASE;
  }

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
