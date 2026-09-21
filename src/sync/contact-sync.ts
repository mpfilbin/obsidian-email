import { AuthError, ContactsConsentRequired, supportsContacts } from "../providers/types";
import type { MailProvider } from "../providers/types";
import type { ContactStore } from "../cache/contact-cache";
import type { Logger } from "../util/logger";
import { Emitter } from "./emitter";

export type ContactsStatus = "idle" | "syncing" | "needs-consent" | "needs-reauth" | "error";

export interface ContactsState {
  accountId: string;
  status: ContactsStatus;
  lastSyncMs?: number;
  lastError?: string;
}

export interface ContactsChange {
  accountId: string;
}

export interface ContactSyncDeps {
  store: ContactStore;
  getProvider: (accountId: string) => MailProvider | undefined;
  listAccountIds: () => string[];
  logger: Logger;
  now?: () => number;
  /** Minimum gap between non-forced syncs of one account. */
  minIntervalMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 10 * 60_000;

/**
 * Keeps the local contact cache in step with the provider by re-pulling the
 * whole address book and reconciling (see the spec's "Why not delta").
 * Deliberately separate from `SyncEngine`: a contacts failure — most often a
 * missing `Contacts.ReadWrite` grant — must never change a mail account's status.
 */
export class ContactSync {
  readonly changes = new Emitter<ContactsChange>();
  readonly states = new Emitter<ContactsState>();

  private inFlight = new Map<string, Promise<void>>();
  private state = new Map<string, ContactsState>();
  /** Bumped by `forget`; a run whose captured epoch is stale discards itself. */
  private epoch = new Map<string, number>();
  private now: () => number;
  private minIntervalMs: number;

  constructor(private deps: ContactSyncDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  getState(accountId: string): ContactsState {
    return this.state.get(accountId) ?? { accountId, status: "idle" };
  }

  private setState(accountId: string, patch: Partial<ContactsState>): void {
    const next: ContactsState = { ...this.getState(accountId), accountId, ...patch };
    this.state.set(accountId, next);
    this.states.emit(next);
  }

  /** Called by the view-model when a contacts write is refused with a 403. */
  markNeedsConsent(accountId: string): void {
    this.setState(accountId, { status: "needs-consent" });
  }

  /**
   * Drops everything this engine knows about an account — called when the
   * account is removed. A `run` that is already past `await listContacts()`
   * would otherwise write the removed account's contacts back into the store
   * moments after `removeAccountFlow` cleared it; bumping the epoch makes that
   * run discard its result instead. The account may be re-added under the same
   * id afterwards and syncs normally.
   */
  forget(accountId: string): void {
    this.epoch.set(accountId, (this.epoch.get(accountId) ?? 0) + 1);
    this.state.delete(accountId);
    this.inFlight.delete(accountId);
  }

  syncAll(): Promise<void> {
    return Promise.all(this.deps.listAccountIds().map((id) => this.syncAccount(id))).then(() => undefined);
  }

  syncAccount(accountId: string, opts: { force?: boolean } = {}): Promise<void> {
    const existing = this.inFlight.get(accountId);
    if (existing) return existing;
    if (!opts.force && !this.due(accountId)) return Promise.resolve();
    // Identity-checked so a run that outlived a `forget` can't clear the
    // marker belonging to a later run for the same (re-added) id.
    const run: Promise<void> = this.run(accountId).finally(() => {
      if (this.inFlight.get(accountId) === run) this.inFlight.delete(accountId);
    });
    this.inFlight.set(accountId, run);
    return run;
  }

  /** A blocked account (no grant / bad token) isn't retried by the poll — only
   *  a forced sync (after "Grant contacts access") tries again. */
  private due(accountId: string): boolean {
    const s = this.getState(accountId);
    if (s.status === "needs-consent" || s.status === "needs-reauth") return false;
    return s.lastSyncMs === undefined || this.now() - s.lastSyncMs >= this.minIntervalMs;
  }

  private async run(accountId: string): Promise<void> {
    const provider = this.deps.getProvider(accountId);
    if (!supportsContacts(provider)) return;
    const epoch = this.epoch.get(accountId) ?? 0;
    const forgotten = () => (this.epoch.get(accountId) ?? 0) !== epoch;
    this.setState(accountId, { status: "syncing" });
    try {
      const contacts = await provider.listContacts();
      // The account was removed while we were waiting: writing now would
      // resurrect its contacts in a store that has just been cleared.
      if (forgotten()) return;
      await this.deps.store.replace(accountId, contacts);
      this.setState(accountId, { status: "idle", lastSyncMs: this.now(), lastError: undefined });
      this.changes.emit({ accountId });
    } catch (err) {
      if (forgotten()) return;
      if (err instanceof ContactsConsentRequired) {
        this.setState(accountId, { status: "needs-consent", lastError: err.message });
      } else if (err instanceof AuthError) {
        this.deps.logger.warn(`contacts for ${accountId} need reauth`, err.message);
        this.setState(accountId, { status: "needs-reauth", lastError: err.message });
      } else {
        this.deps.logger.error(`contact sync failed for ${accountId}`, (err as Error).message);
        this.setState(accountId, { status: "error", lastError: (err as Error).message });
      }
    }
  }
}
