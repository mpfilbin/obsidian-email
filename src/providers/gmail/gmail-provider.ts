import { AuthError, CursorExpiredError, ProviderError } from "../types";
import type { MailProvider, Mailbox, MessageBody, MessageSummary, Page, SyncCursor, SyncResult } from "../types";
import type { HttpClient, HttpResponse } from "../http";
import { withRetry, parseRetryAfter, type RetryableResult } from "../../util/backoff";
import {
  GMAIL_ARCHIVE_MAILBOX, decodeBase64UrlBytes, mapGmailBody, mapGmailLabels, mapGmailSummary,
  type GmailMessage,
} from "./gmail-mappers";

export interface GmailProviderDeps {
  http: HttpClient;
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  concurrency?: number;
}

const DEFAULT_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PAGE_SIZE = 25;

// Gmail overloads HTTP 403 for both "you may not do this" and "you are going
// too fast". Only the former is an auth problem; treating quota exhaustion as
// one flips a perfectly healthy account to `needs-reauth`.
const AUTH_403_REASONS = new Set([
  "insufficientpermissions",
  "forbidden",
  "accessnotconfigured",
  "authorizationerror",
  "domainpolicy",
]);

interface GmailErrorBody {
  error?: {
    status?: string;
    errors?: Array<{ reason?: string; domain?: string }>;
  };
}

/**
 * Decide whether a Gmail 403 is a genuine permission failure. Unknown or
 * missing reasons are treated as retryable quota — the safe default, since a
 * needless retry costs a backoff while a needless re-auth prompt costs the
 * user their session.
 */
export function isGmailAuthForbidden(json: unknown): boolean {
  const err = (json as GmailErrorBody | undefined)?.error;
  if (!err) return false;
  const reasons = (err.errors ?? []).map((e) => (e.reason ?? "").toLowerCase());
  return reasons.some((r) => AUTH_403_REASONS.has(r));
}

export class GmailProvider implements MailProvider {
  readonly kind = "gmail" as const;
  private base: string;
  private concurrency: number;

  constructor(private deps: GmailProviderDeps) {
    this.base = deps.baseUrl ?? DEFAULT_BASE;
    this.concurrency = deps.concurrency ?? 4;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.deps.getAccessToken();
    return withRetry<T>(async (): Promise<RetryableResult<T>> => {
      const res: HttpResponse = await this.deps.http.request({
        url: `${this.base}${path}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) throw new AuthError("Gmail 401");
      if (res.status === 403 && isGmailAuthForbidden(res.json)) {
        throw new AuthError("Gmail 403 (insufficient permissions)");
      }
      // 403 without an auth reason is rateLimitExceeded / userRateLimitExceeded
      // / dailyLimitExceeded — retryable quota, not a credential problem.
      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        return {
          retry: true,
          afterMs: parseRetryAfter(res.headers["retry-after"], Date.now()),
          error: new ProviderError(`Gmail ${res.status}`, res.status, true),
        };
      }
      if (res.status < 200 || res.status >= 300) {
        throw new ProviderError(`Gmail ${res.status}`, res.status);
      }
      return { retry: false, value: res.json as T };
    }, { retries: 4, baseMs: 500, maxMs: 8000 });
  }

  private async mapPool<A, B>(items: A[], fn: (a: A) => Promise<B>): Promise<B[]> {
    const out: B[] = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    });
    await Promise.all(workers);
    return out;
  }

  async listMailboxes(): Promise<Mailbox[]> {
    const data = await this.get<{ labels?: Array<{ id: string; name: string; type?: string }> }>("/labels");
    return mapGmailLabels(data.labels ?? []);
  }

  private async hydrate(ids: string[]): Promise<MessageSummary[]> {
    const msgs = await this.mapPool(ids, (id) =>
      this.get<GmailMessage>(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`),
    );
    return msgs.filter((m) => m.id).map(mapGmailSummary);
  }

  private listQuery(mailboxId: string, pageToken?: string): string {
    const params = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    if (mailboxId === GMAIL_ARCHIVE_MAILBOX.id) params.set("q", "-in:inbox -in:trash -in:spam");
    else params.set("labelIds", mailboxId);
    return params.toString();
  }

  /** Fetch a `/messages` list page for the given query string and hydrate summaries. */
  private async fetchPage(query: string): Promise<Page<MessageSummary>> {
    const data = await this.get<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      `/messages?${query}`,
    );
    const items = await this.hydrate((data.messages ?? []).map((m) => m.id));
    return { items, nextPageToken: data.nextPageToken };
  }

  async listMessages(mailboxId: string, pageToken?: string): Promise<Page<MessageSummary>> {
    return this.fetchPage(this.listQuery(mailboxId, pageToken));
  }

  async search(query: string, pageToken?: string): Promise<Page<MessageSummary>> {
    const params = new URLSearchParams({ maxResults: String(PAGE_SIZE), q: query });
    if (pageToken) params.set("pageToken", pageToken);
    return this.fetchPage(params.toString());
  }

  async getMessageBody(id: string): Promise<MessageBody> {
    return mapGmailBody(await this.get<GmailMessage>(`/messages/${id}?format=full`));
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer> {
    const data = await this.get<{ data?: string }>(`/messages/${messageId}/attachments/${attachmentId}`);
    return decodeBase64UrlBytes(data.data ?? "").buffer as ArrayBuffer;
  }

  async initialCursor(): Promise<SyncCursor> {
    const p = await this.get<{ historyId: string }>("/profile");
    return { kind: "gmail", historyId: p.historyId };
  }

  async syncSince(cursor: SyncCursor): Promise<SyncResult> {
    if (cursor.kind !== "gmail") throw new ProviderError("wrong cursor kind for Gmail");
    const addedIds = new Set<string>();
    const deletions = new Set<string>();
    let pageToken: string | undefined;
    let latestHistoryId = cursor.historyId;
    do {
      const params = new URLSearchParams({ startHistoryId: cursor.historyId });
      for (const t of ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]) {
        params.append("historyTypes", t);
      }
      if (pageToken) params.set("pageToken", pageToken);
      // Gmail answers 404 when `startHistoryId` has aged out of the history
      // window. That is recoverable via a fresh backfill, not a sync failure.
      const data = await this.get<{
        history?: Array<Record<string, unknown>>;
        historyId?: string;
        nextPageToken?: string;
      }>(`/history?${params.toString()}`).catch((err: unknown) => {
        if (err instanceof ProviderError && err.status === 404) {
          throw new CursorExpiredError(`Gmail history ${cursor.historyId} expired`, err);
        }
        throw err;
      });
      for (const h of data.history ?? []) {
        if (typeof h.id === "string") latestHistoryId = h.id;
        for (const a of (h.messagesAdded as Array<{ message: { id: string } }>) ?? []) addedIds.add(a.message.id);
        for (const d of (h.messagesDeleted as Array<{ message: { id: string } }>) ?? []) deletions.add(d.message.id);
        for (const key of ["labelsAdded", "labelsRemoved"]) {
          for (const l of (h[key] as Array<{ message: { id: string } }>) ?? []) addedIds.add(l.message.id);
        }
      }
      if (data.historyId) latestHistoryId = data.historyId;
      pageToken = data.nextPageToken;
    } while (pageToken);

    for (const id of deletions) addedIds.delete(id);
    const upserts = await this.hydrate([...addedIds]);
    return {
      upserts,
      deletions: [...deletions],
      mailboxChanges: [],
      cursor: { kind: "gmail", historyId: latestHistoryId },
    };
  }
}
