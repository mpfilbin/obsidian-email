import { AuthError } from "../providers/types";
import type { ProviderKind } from "../providers/types";
import { OAUTH_CONFIG } from "./provider-oauth-config";
import { refreshAccessToken, type HttpPost, type TokenResponse } from "./oauth-client";

export interface SecretStore {
  getSecret(id: string): Promise<string | null>;
  setSecret(id: string, secret: string): Promise<void>;
}

export interface TokenManagerDeps {
  secrets: SecretStore;
  post: HttpPost;
  now: () => number;
}

const SKEW_MS = 60_000;

export class TokenManager {
  private accessToken?: string;
  private expiresAtMs = 0;
  private refreshInFlight?: Promise<string>;

  constructor(
    private accountId: string,
    private kind: ProviderKind,
    private clientId: string,
    private deps: TokenManagerDeps,
  ) {}

  private key(): string {
    // SecretStorage IDs must be lowercase alphanumeric with optional dashes
    // (Obsidian >= 1.11.4 throws on colons). `accountId` is a lowercase
    // `crypto.randomUUID()`, so a dash-joined key stays valid.
    return `obsidian-email-${this.accountId}-refresh`;
  }

  async storeInitialTokens(t: TokenResponse): Promise<void> {
    if (!t.refreshToken) {
      throw new AuthError("Provider did not return a refresh token; re-consent is required.");
    }
    await this.deps.secrets.setSecret(this.key(), t.refreshToken);
    this.accessToken = t.accessToken;
    this.expiresAtMs = this.deps.now() + t.expiresInSec * 1000;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.deps.now() < this.expiresAtMs - SKEW_MS) {
      return this.accessToken;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doRefresh().finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<string> {
    const refreshToken = await this.deps.secrets.getSecret(this.key());
    if (!refreshToken) throw new AuthError("No stored refresh token for this account.");
    const cfg = OAUTH_CONFIG[this.kind];
    const t = await refreshAccessToken(cfg, this.deps.post, {
      clientId: this.clientId,
      refreshToken,
    });
    if (t.refreshToken && t.refreshToken !== refreshToken) {
      await this.deps.secrets.setSecret(this.key(), t.refreshToken);
    }
    this.accessToken = t.accessToken;
    this.expiresAtMs = this.deps.now() + t.expiresInSec * 1000;
    return t.accessToken;
  }

  async clear(): Promise<void> {
    // secretStorage has no delete in the public API; overwrite with empty.
    try {
      await this.deps.secrets.setSecret(this.key(), "");
    } catch {
      /* best effort */
    }
    this.accessToken = undefined;
    this.expiresAtMs = 0;
  }
}
