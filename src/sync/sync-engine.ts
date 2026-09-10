import { AuthError } from "../providers/types";
import type { MailProvider, SyncCursor } from "../providers/types";
import type { MailCache } from "../cache/mail-cache";
import type { CursorStore } from "../cache/cursor-store";
import type { Logger } from "../util/logger";
import { Emitter } from "./emitter";

export type SyncStatus = "idle" | "syncing" | "needs-reauth" | "error";

export interface CacheChange {
  accountId: string;
  mailboxIds: string[];
  reason: "backfill" | "incremental";
}

export interface AccountState {
  accountId: string;
  status: SyncStatus;
  lastSyncMs?: number;
  lastError?: string;
}

export interface SyncEngineDeps {
  cache: MailCache;
  cursors: CursorStore;
  getProvider: (accountId: string) => MailProvider | undefined;
  listAccountIds: () => string[];
  logger: Logger;
  now?: () => number;
  backfillMailboxKinds?: string[];
}

const BACKFILL_KINDS = ["inbox", "sent", "drafts", "archive"];
const BACKFILL_PAGE_CAP = 8; // pages per mailbox during backfill

export class SyncEngine {
  readonly changes = new Emitter<CacheChange>();
  readonly states = new Emitter<AccountState>();

  private inFlight = new Map<string, Promise<void>>();
  private state = new Map<string, AccountState>();
  private timer?: ReturnType<typeof setInterval>;
  private now: () => number;

  constructor(private deps: SyncEngineDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  getState(accountId: string): AccountState {
    return this.state.get(accountId) ?? { accountId, status: "idle" };
  }

  private setState(accountId: string, patch: Partial<AccountState>): void {
    const next: AccountState = { ...this.getState(accountId), accountId, ...patch };
    this.state.set(accountId, next);
    this.states.emit(next);
  }

  setPollInterval(intervalMs: number | null): void {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    if (intervalMs && intervalMs > 0) {
      this.timer = setInterval(() => void this.syncAll(), intervalMs);
    }
  }

  start(intervalMs: number | null): void {
    void this.syncAll();
    this.setPollInterval(intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async syncAll(): Promise<void> {
    await Promise.all(this.deps.listAccountIds().map((id) => this.syncAccount(id)));
  }

  syncAccount(accountId: string): Promise<void> {
    const existing = this.inFlight.get(accountId);
    if (existing) return existing;
    const run = this.runSync(accountId).finally(() => this.inFlight.delete(accountId));
    this.inFlight.set(accountId, run);
    return run;
  }

  private async runSync(accountId: string): Promise<void> {
    const provider = this.deps.getProvider(accountId);
    if (!provider) return;
    this.setState(accountId, { status: "syncing" });
    try {
      const saved = await this.deps.cursors.get(accountId);
      if (!saved || !saved.backfillDone) {
        await this.backfill(accountId, provider);
      } else {
        await this.incremental(accountId, provider, saved.cursor);
      }
      this.setState(accountId, { status: "idle", lastSyncMs: this.now(), lastError: undefined });
    } catch (err) {
      if (err instanceof AuthError) {
        this.deps.logger.warn(`account ${accountId} needs reauth`, err.message);
        this.setState(accountId, { status: "needs-reauth", lastError: err.message });
      } else {
        this.deps.logger.error(`sync failed for ${accountId}`, (err as Error).message);
        this.setState(accountId, { status: "error", lastError: (err as Error).message });
      }
    }
  }

  private async backfill(accountId: string, provider: MailProvider): Promise<void> {
    const boxes = await provider.listMailboxes();
    await this.deps.cache.putMailboxes(accountId, boxes);
    const kinds = this.deps.backfillMailboxKinds ?? BACKFILL_KINDS;
    const target = boxes.filter((b) => kinds.includes(b.kind));
    const touched = new Set<string>();
    for (const box of target) {
      let token: string | undefined;
      for (let page = 0; page < BACKFILL_PAGE_CAP; page++) {
        const res = await provider.listMessages(box.id, token);
        if (res.items.length) {
          await this.deps.cache.upsertMessages(accountId, res.items);
          touched.add(box.id);
        }
        if (!res.nextPageToken) break;
        token = res.nextPageToken;
      }
    }
    const cursor = await provider.initialCursor();
    await this.deps.cursors.set(accountId, cursor, true);
    await this.deps.cache.pruneAccount(accountId, this.now());
    this.changes.emit({ accountId, mailboxIds: [...touched], reason: "backfill" });
  }

  private async incremental(accountId: string, provider: MailProvider, cursor: SyncCursor): Promise<void> {
    const result = await provider.syncSince(cursor);
    if (result.mailboxChanges.length) {
      await this.deps.cache.putMailboxes(accountId, result.mailboxChanges);
    }
    if (result.upserts.length) await this.deps.cache.upsertMessages(accountId, result.upserts);
    if (result.deletions.length) await this.deps.cache.deleteMessages(accountId, result.deletions);
    await this.deps.cursors.set(accountId, result.cursor, true);
    await this.deps.cache.pruneAccount(accountId, this.now());
    const mailboxIds = [
      ...new Set(result.upserts.flatMap((m) => m.mailboxIds)),
    ];
    this.changes.emit({ accountId, mailboxIds, reason: "incremental" });
  }
}
