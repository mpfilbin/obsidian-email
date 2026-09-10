export type RetryableResult<T> =
  | { retry: false; value: T }
  | { retry: true; afterMs?: number; error: Error };

export interface RetryOptions {
  retries: number;
  baseMs: number;
  maxMs: number;
  jitter?: () => number; // 0..1, default Math.random
}

export function parseRetryAfter(
  headerValue: string | undefined,
  nowMs: number,
): number | undefined {
  if (!headerValue) return undefined;
  const secs = Number(headerValue);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(headerValue);
  if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  return undefined;
}

export async function withRetry<T>(
  fn: () => Promise<RetryableResult<T>>,
  opts: RetryOptions,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  const jitter = opts.jitter ?? Math.random;
  let lastError = new Error("withRetry: no attempts made");
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const result = await fn();
    if (!result.retry) return result.value;
    lastError = result.error;
    if (attempt === opts.retries) break;
    const expo = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
    const delay = result.afterMs ?? expo * (0.5 + 0.5 * jitter());
    await sleep(delay);
  }
  throw lastError;
}
