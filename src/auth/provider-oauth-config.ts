import type { ProviderKind } from "../providers/types";

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  loopbackHost: "127.0.0.1" | "localhost";
  extraAuthParams: Record<string, string>;
}

export const OAUTH_CONFIG: Record<ProviderKind, OAuthProviderConfig> = {
  "ms-graph": {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["Mail.ReadWrite", "Mail.Send", "offline_access", "User.Read"],
    loopbackHost: "localhost",
    extraAuthParams: {},
  },
};
