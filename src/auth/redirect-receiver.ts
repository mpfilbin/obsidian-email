import { AuthError } from "../providers/types";

export interface RedirectResult {
  code: string;
  state: string;
}

/** The `obsidian://<action>` handler name the OAuth provider redirects to. */
export const AUTH_REDIRECT_ACTION = "obsidian-email-auth";
export const AUTH_REDIRECT_URI = `obsidian://${AUTH_REDIRECT_ACTION}`;

/**
 * Receives the OAuth redirect. Obsidian owns the `obsidian://` scheme, so
 * instead of listening on a local port the plugin registers a protocol handler
 * that forwards its params to `handle()`.
 */
export class AuthRedirectReceiver {
  private settle?: {
    resolve: (r: RedirectResult) => void;
    reject: (e: Error) => void;
  };
  private timer?: ReturnType<typeof setTimeout>;
  private expectedState?: string;

  async listen(): Promise<{ redirectUri: string }> {
    return { redirectUri: AUTH_REDIRECT_URI };
  }

  /**
   * `expectedState`, when given, makes the receiver ignore any redirect whose
   * `state` differs, so a forged link can't abort the pending sign-in.
   */
  waitForCode(opts: { timeoutMs?: number; expectedState?: string } = {}): Promise<RedirectResult> {
    const timeoutMs = opts.timeoutMs ?? 300_000;
    return new Promise<RedirectResult>((resolve, reject) => {
      // One sign-in at a time: a newer flow supersedes (and fails) a pending one
      // so a redirect can't be delivered to the wrong flow.
      if (this.timer) clearTimeout(this.timer);
      this.settle?.reject(new AuthError("Superseded by a newer sign-in attempt."));
      this.settle = { resolve, reject };
      this.expectedState = opts.expectedState;
      this.timer = setTimeout(() => {
        this.settle = undefined;
        reject(new AuthError("Timed out waiting for the authentication redirect."));
      }, timeoutMs);
    });
  }

  /** Called by the protocol handler. Ignored when no sign-in is in flight. */
  handle(params: Record<string, string | undefined>): void {
    if (!this.settle) return;
    const { error, error_description: errorDescription, code } = params;
    const state = params.state ?? "";
    // Ignore stray links that carry neither a code nor an error.
    if (!error && !code) return;
    if (this.expectedState !== undefined && state !== this.expectedState) return;
    if (this.timer) clearTimeout(this.timer);
    const settle = this.settle;
    this.settle = undefined;
    if (error) {
      const detail = errorDescription ? `${error}: ${errorDescription}` : error;
      settle.reject(new AuthError(`Authorization failed: ${detail}`));
    } else {
      settle.resolve({ code: code!, state });
    }
  }

  /**
   * No-op by design: the receiver is shared, and a superseded flow's `finally`
   * runs after its successor has registered, so clearing here would cancel the
   * successor. A pending wait is cleaned up by `handle()`, the timeout, or the
   * next `waitForCode()`.
   */
  close(): void {}
}
