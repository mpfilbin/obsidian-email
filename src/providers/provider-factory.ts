import type { MailProvider, ProviderKind } from "./types";
import type { HttpClient } from "./http";
import type { TokenManager } from "../auth/token-manager";
import { GraphProvider } from "./ms-graph/graph-provider";

export interface AccountConfig {
  id: string;
  email: string;
  provider: ProviderKind;
  clientId: string;
  addedAt: number;
}

export function createProvider(
  account: AccountConfig,
  token: TokenManager,
  http: HttpClient,
): MailProvider {
  const getAccessToken = () => token.getAccessToken();
  return new GraphProvider({ http, getAccessToken });
}
