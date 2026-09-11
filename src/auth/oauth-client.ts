import { AuthError } from "../providers/types";
import type { OAuthProviderConfig } from "./provider-oauth-config";

export interface HttpPost {
  (url: string, form: Record<string, string>): Promise<{ status: number; json: unknown }>;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresInSec: number;
}

export function buildAuthorizeUrl(
  cfg: OAuthProviderConfig,
  args: { clientId: string; redirectUri: string; challenge: string; state: string },
): string {
  const url = new URL(cfg.authorizeUrl);
  const p = url.searchParams;
  p.set("client_id", args.clientId);
  p.set("redirect_uri", args.redirectUri);
  p.set("response_type", "code");
  p.set("scope", cfg.scopes.join(" "));
  p.set("code_challenge", args.challenge);
  p.set("code_challenge_method", "S256");
  p.set("state", args.state);
  for (const [k, v] of Object.entries(cfg.extraAuthParams)) p.set(k, v);
  return url.toString();
}

function mapToken(json: Record<string, unknown>): TokenResponse {
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresInSec: Number(json.expires_in ?? 3600),
  };
}

function assertOk(status: number, json: unknown): asserts json is Record<string, unknown> {
  const body = (json ?? {}) as Record<string, unknown>;
  if (status < 200 || status >= 300 || typeof body.access_token !== "string") {
    const parts = [body.error, body.error_description].filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
    const detail = parts.length > 0 ? parts.join(": ") : `HTTP ${status}`;
    throw new AuthError(`OAuth token request failed: ${detail}`, body);
  }
}

export async function exchangeCode(
  cfg: OAuthProviderConfig,
  post: HttpPost,
  args: { clientId: string; code: string; verifier: string; redirectUri: string },
): Promise<TokenResponse> {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: args.clientId,
    code: args.code,
    code_verifier: args.verifier,
    redirect_uri: args.redirectUri,
  };
  const { status, json } = await post(cfg.tokenUrl, form);
  assertOk(status, json);
  return mapToken(json);
}

export async function refreshAccessToken(
  cfg: OAuthProviderConfig,
  post: HttpPost,
  args: { clientId: string; refreshToken: string },
): Promise<TokenResponse> {
  const form: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: args.clientId,
    refresh_token: args.refreshToken,
  };
  const { status, json } = await post(cfg.tokenUrl, form);
  assertOk(status, json);
  return mapToken(json);
}
