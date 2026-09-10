import type { HttpClient, HttpResponse } from "./http";

export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}
export type RequestUrlFn = (p: RequestUrlParam) => Promise<{
  status: number;
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
  headers: Record<string, string>;
}>;

export function makeObsidianHttp(requestUrl: RequestUrlFn): HttpClient {
  return {
    async request(opts): Promise<HttpResponse> {
      const res = await requestUrl({ ...opts, throw: false });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers ?? {})) headers[k.toLowerCase()] = v;
      let json: unknown = undefined;
      try { json = res.json; } catch { json = undefined; }
      return { status: res.status, json, text: res.text, arrayBuffer: res.arrayBuffer, headers };
    },
  };
}
