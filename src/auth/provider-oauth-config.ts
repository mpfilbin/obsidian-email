import type { ProviderKind } from "../providers/types";

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  loopbackHost: "127.0.0.1" | "localhost";
  extraAuthParams: Record<string, string>;
  usesClientSecret: boolean;
}

export const OAUTH_CONFIG: Record<ProviderKind, OAuthProviderConfig> = {
  gmail: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    loopbackHost: "127.0.0.1",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    usesClientSecret: true,
  },
  "ms-graph": {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["Mail.ReadWrite", "Mail.Send", "offline_access", "User.Read"],
    loopbackHost: "localhost",
    extraAuthParams: {},
    usesClientSecret: false,
  },
};
