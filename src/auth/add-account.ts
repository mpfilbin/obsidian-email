import { AuthError } from "../providers/types";
import type { ProviderKind } from "../providers/types";
import type { AccountConfig } from "../providers/provider-factory";
import type { HttpClient } from "../providers/http";
import { newPkcePair, newState } from "./pkce";
import { OAUTH_CONFIG } from "./provider-oauth-config";
import { buildAuthorizeUrl, exchangeCode, type HttpPost } from "./oauth-client";
import { AuthRedirectReceiver } from "./redirect-receiver";
import { TokenManager, type SecretStore } from "./token-manager";

export interface RedirectReceiver {
  listen(): Promise<{ redirectUri: string }>;
  waitForCode(o?: { timeoutMs?: number }): Promise<{ code: string; state: string }>;
  close(): void;
}

export interface AddAccountDeps {
  post: HttpPost;
  secrets: SecretStore;
  openBrowser: (url: string) => void;
  now: () => number;
  fetchProfileEmail: (accessToken: string, post: HttpPost) => Promise<string>;
  genId: () => string;
  /** The receiver the protocol handler feeds; a fresh one if omitted (tests). */
  redirect?: RedirectReceiver;
}

export async function addAccount(
  input: { kind: ProviderKind; clientId: string },
  deps: AddAccountDeps,
): Promise<{ account: AccountConfig; token: TokenManager }> {
  const cfg = OAUTH_CONFIG[input.kind];
  const redirect = deps.redirect ?? new AuthRedirectReceiver();
  try {
    const { redirectUri } = await redirect.listen();
    const { verifier, challenge } = await newPkcePair();
    const state = newState();
    const authorizeUrl = buildAuthorizeUrl(cfg, {
      clientId: input.clientId, redirectUri, challenge, state,
    });
    deps.openBrowser(authorizeUrl);
    const { code, state: returnedState } = await redirect.waitForCode();
    if (returnedState !== state) throw new AuthError("OAuth state mismatch; aborting.");

    const tokens = await exchangeCode(cfg, deps.post, {
      clientId: input.clientId,
      code,
      verifier,
      redirectUri,
    });

    const id = deps.genId();
    const token = new TokenManager(id, input.kind, input.clientId, {
      secrets: deps.secrets, post: deps.post, now: deps.now,
    });
    await token.storeInitialTokens(tokens);

    const email = await deps.fetchProfileEmail(tokens.accessToken, deps.post);
    const account: AccountConfig = {
      id, email, provider: input.kind, clientId: input.clientId, addedAt: deps.now(),
    };
    return { account, token };
  } finally {
    redirect.close();
  }
}

export function defaultFetchProfileEmail(http: HttpClient) {
  return async (accessToken: string): Promise<string> => {
    const res = await http.request({
      url: "https://graph.microsoft.com/v1.0/me",
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const j = (res.json ?? {}) as { mail?: string; userPrincipalName?: string };
    const email = j.mail ?? j.userPrincipalName;
    if (!email) throw new AuthError("Could not read the Microsoft profile email.");
    return email;
  };
}
