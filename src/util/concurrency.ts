/**
 * Like `Promise.allSettled(items.map(fn))`, but keeps at most `limit` calls in
 * flight at once. Bulk actions on a big selection would otherwise fire hundreds
 * of simultaneous requests at Graph and trip its throttling.
 *
 * Results are in input order; a rejection never stops the remaining items.
 */
export async function mapSettledLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
