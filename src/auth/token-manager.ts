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

  private key(suffix: "refresh" | "secret"): string {
    return `obsidian-email:${this.accountId}:${suffix}`;
  }

  async storeInitialTokens(t: TokenResponse, clientSecret?: string): Promise<void> {
    if (!t.refreshToken) {
      throw new AuthError("Provider did not return a refresh token; re-consent is required.");
    }
    await this.deps.secrets.setSecret(this.key("refresh"), t.refreshToken);
    if (clientSecret) await this.deps.secrets.setSecret(this.key("secret"), clientSecret);
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
    const refreshToken = await this.deps.secrets.getSecret(this.key("refresh"));
    if (!refreshToken) throw new AuthError("No stored refresh token for this account.");
    const cfg = OAUTH_CONFIG[this.kind];
    const clientSecret = cfg.usesClientSecret
      ? (await this.deps.secrets.getSecret(this.key("secret"))) ?? undefined
      : undefined;
    const t = await refreshAccessToken(cfg, this.deps.post, {
      clientId: this.clientId,
      clientSecret,
      refreshToken,
    });
    if (t.refreshToken && t.refreshToken !== refreshToken) {
      await this.deps.secrets.setSecret(this.key("refresh"), t.refreshToken);
    }
    this.accessToken = t.accessToken;
    this.expiresAtMs = this.deps.now() + t.expiresInSec * 1000;
    return t.accessToken;
  }

  async clear(): Promise<void> {
    // secretStorage has no delete in the public API; overwrite with empty.
    try {
      await this.deps.secrets.setSecret(this.key("refresh"), "");
      await this.deps.secrets.setSecret(this.key("secret"), "");
    } catch {
      /* best effort */
    }
    this.accessToken = undefined;
    this.expiresAtMs = 0;
  }
}
