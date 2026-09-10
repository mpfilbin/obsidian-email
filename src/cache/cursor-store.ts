import type { IDBPDatabase } from "idb";
import type { SyncCursor } from "../providers/types";
import { openMailDb, type MailDb } from "./schema";

export class CursorStore {
  private constructor(private db: IDBPDatabase<MailDb>) {}

  static async open(name?: string): Promise<CursorStore> {
    return new CursorStore(await openMailDb(name));
  }

  async get(accountId: string): Promise<{ cursor: SyncCursor; backfillDone: boolean } | undefined> {
    const row = await this.db.get("cursors", accountId);
    return row ? { cursor: row.cursor, backfillDone: row.backfillDone } : undefined;
  }

  async set(accountId: string, cursor: SyncCursor, backfillDone: boolean): Promise<void> {
    await this.db.put("cursors", { accountId, cursor, backfillDone });
  }

  async delete(accountId: string): Promise<void> {
    await this.db.delete("cursors", accountId);
  }
}
