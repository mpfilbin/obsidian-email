import { describe, it, expect, vi } from "vitest";
import { makeFormPost } from "../../src/host/http-post";

describe("makeFormPost", () => {
  it("POSTs the form url-encoded, without throwing on non-2xx, and returns status + json", async () => {
    const requestUrl = vi.fn(async () => ({ status: 200, json: { access_token: "at" } }));
    const post = makeFormPost(requestUrl);
    const res = await post("https://login.example/token", { grant_type: "refresh_token", refresh_token: "a b&c" });
    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://login.example/token",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=a+b%26c",
      throw: false,
    });
    expect(res).toEqual({ status: 200, json: { access_token: "at" } });
  });

  it("passes an error status through for the caller to inspect", async () => {
    const post = makeFormPost(async () => ({ status: 400, json: { error: "invalid_grant" } }));
    expect(await post("u", {})).toEqual({ status: 400, json: { error: "invalid_grant" } });
  });

  it("tolerates a response whose json getter throws (a non-JSON body)", async () => {
    const res = { status: 502, get json(): unknown { throw new Error("not json"); } };
    const post = makeFormPost(async () => res);
    expect(await post("u", {})).toEqual({ status: 502, json: undefined });
  });
});
