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

  async listen(): Promise<{ redirectUri: string }> {
    return { redirectUri: AUTH_REDIRECT_URI };
  }

  waitForCode(opts: { timeoutMs?: number } = {}): Promise<RedirectResult> {
    const timeoutMs = opts.timeoutMs ?? 300_000;
    return new Promise<RedirectResult>((resolve, reject) => {
      this.settle = { resolve, reject };
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

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.settle = undefined;
  }
}
