import { AuthError } from "../providers/types";
import type { ProviderKind } from "../providers/types";
import type { AccountConfig } from "../providers/provider-factory";
import type { HttpClient } from "../providers/http";
import { newPkcePair, newState } from "./pkce";
import { OAUTH_CONFIG } from "./provider-oauth-config";
import { buildAuthorizeUrl, exchangeCode, type HttpPost } from "./oauth-client";
import { LoopbackServer } from "./loopback-server";
import { TokenManager, type SecretStore } from "./token-manager";

export interface LoopbackLike {
  listen(): Promise<{ port: number; redirectUri: string }>;
  waitForCode(o?: { timeoutMs?: number }): Promise<{ code: string; state: string }>;
  close(): void;
}

export interface AddAccountDeps {
  post: HttpPost;
  secrets: SecretStore;
  openBrowser: (url: string) => void;
  now: () => number;
  fetchProfileEmail: (kind: ProviderKind, accessToken: string, post: HttpPost) => Promise<string>;
  genId: () => string;
  makeLoopback?: (host: "127.0.0.1" | "localhost") => LoopbackLike;
}

export async function addAccount(
  input: { kind: ProviderKind; clientId: string; clientSecret?: string },
  deps: AddAccountDeps,
): Promise<{ account: AccountConfig; token: TokenManager }> {
  const cfg = OAUTH_CONFIG[input.kind];
  const make = deps.makeLoopback ?? ((host) => new LoopbackServer(host));
  const loopback = make(cfg.loopbackHost);
  try {
    const { redirectUri } = await loopback.listen();
    const { verifier, challenge } = await newPkcePair();
    const state = newState();
    const authorizeUrl = buildAuthorizeUrl(cfg, {
      clientId: input.clientId, redirectUri, challenge, state,
    });
    deps.openBrowser(authorizeUrl);
    const { code, state: returnedState } = await loopback.waitForCode();
    if (returnedState !== state) throw new AuthError("OAuth state mismatch; aborting.");

    const tokens = await exchangeCode(cfg, deps.post, {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      code,
      verifier,
      redirectUri,
    });

    const id = deps.genId();
    const token = new TokenManager(id, input.kind, input.clientId, {
      secrets: deps.secrets, post: deps.post, now: deps.now,
    });
    await token.storeInitialTokens(tokens, cfg.usesClientSecret ? input.clientSecret : undefined);

    const email = await deps.fetchProfileEmail(input.kind, tokens.accessToken, deps.post);
    const account: AccountConfig = {
      id, email, provider: input.kind, clientId: input.clientId, addedAt: deps.now(),
    };
    return { account, token };
  } finally {
    loopback.close();
  }
}

export function defaultFetchProfileEmail(http: HttpClient) {
  return async (kind: ProviderKind, accessToken: string): Promise<string> => {
    const auth = { Authorization: `Bearer ${accessToken}` };
    if (kind === "gmail") {
      const res = await http.request({
        url: "https://gmail.googleapis.com/gmail/v1/users/me/profile", method: "GET", headers: auth,
      });
      const j = (res.json ?? {}) as { emailAddress?: string };
      if (!j.emailAddress) throw new AuthError("Could not read the Gmail profile email.");
      return j.emailAddress;
    }
    const res = await http.request({
      url: "https://graph.microsoft.com/v1.0/me", method: "GET", headers: auth,
    });
    const j = (res.json ?? {}) as { mail?: string; userPrincipalName?: string };
    const email = j.mail ?? j.userPrincipalName;
    if (!email) throw new AuthError("Could not read the Microsoft profile email.");
    return email;
  };
}
