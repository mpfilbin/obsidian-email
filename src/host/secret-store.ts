import type { SecretStore } from "../auth/token-manager";

/** Obsidian's `app.secretStorage` (>= 1.11.4) is synchronous; adapt it to the
 *  async `SecretStore` shape the token manager expects. */
export function makeSecretStore(storage: {
  getSecret(id: string): string | null;
  setSecret(id: string, value: string): void;
}): SecretStore {
  return {
    getSecret: async (id) => storage.getSecret(id),
    setSecret: async (id, value) => {
      storage.setSecret(id, value);
    },
  };
}
