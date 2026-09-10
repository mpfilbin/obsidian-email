function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomUrlSafe(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toBase64Url(buf);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(digest));
}

export async function newPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlSafe(32); // 43 chars, within RFC 7636's 43-128
  const challenge = await pkceChallenge(verifier);
  return { verifier, challenge };
}

export function newState(): string {
  return randomUrlSafe(16);
}
