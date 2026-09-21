/**
 * Guards an IndexedDB open against the one failure mode that isn't a throw: a
 * `blocked` upgrade. When an older connection (a previous plugin instance in
 * the same renderer) still holds the database, `openDB` neither resolves nor
 * rejects — it just waits. Without a timeout that hangs `PluginContext.create`
 * and the plugin never finishes loading.
 */
export class CacheOpenTimeout extends Error {
  constructor(ms: number) {
    super(`Opening the local cache timed out after ${ms}ms (likely blocked by an older session)`);
    this.name = "CacheOpenTimeout";
  }
}

/**
 * Resolves `open()` unless it takes longer than `ms`, in which case the promise
 * rejects with `CacheOpenTimeout`. A connection that arrives *after* the
 * timeout is closed rather than leaked — a live handle would itself block the
 * next attempt at the upgrade.
 */
export function openWithTimeout<T extends { close(): void }>(
  open: () => Promise<T>,
  ms: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new CacheOpenTimeout(ms));
    }, ms);

    open().then(
      (handle) => {
        if (timedOut) {
          try {
            handle.close();
          } catch {
            // Already closed / never usable: nothing left to release.
          }
          return;
        }
        clearTimeout(timer);
        resolve(handle);
      },
      (err: unknown) => {
        if (timedOut) return;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
