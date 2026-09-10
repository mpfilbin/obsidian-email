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
        throw new ProviderError(`Graph ${res.status}`, res.status);
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
