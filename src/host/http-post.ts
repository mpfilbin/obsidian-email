import type { HttpPost } from "../auth/oauth-client";

/** The slice of Obsidian's `requestUrl` the OAuth token calls use. */
export type RequestUrlFn = (params: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  throw: boolean;
}) => Promise<{ status: number; json: unknown }>;

/** Form-url-encoded POST for OAuth token endpoints. Never throws on a non-2xx
 *  status (the caller inspects `status`), and tolerates a body that isn't JSON:
 *  Obsidian's `json` is a getter that throws on one. */
export function makeFormPost(requestUrl: RequestUrlFn): HttpPost {
  return async (url, form) => {
    const body = new URLSearchParams(form).toString();
    const res = await requestUrl({
      url,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      throw: false,
    });
    let json: unknown;
    try {
      json = res.json;
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  };
}
