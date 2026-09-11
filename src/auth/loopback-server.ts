import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { AuthError } from "../providers/types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const http = require("node:http") as typeof import("node:http");

export interface LoopbackResult {
  code: string;
  state: string;
}

const DONE_HTML =
  "<!doctype html><meta charset=utf-8><title>Obsidian Email</title>" +
  "<body style=\"font-family:system-ui;padding:2rem\">" +
  "<h2>Authentication complete</h2><p>You can close this tab and return to Obsidian.</p>";

export class LoopbackServer {
  private server?: Server;
  private port = 0;
  private settle?: {
    resolve: (r: LoopbackResult) => void;
    reject: (e: Error) => void;
  };
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private host: "127.0.0.1" | "localhost") {}

  listen(): Promise<{ port: number; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.on("error", reject);
      this.server.listen(0, this.host, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") this.port = addr.port;
        resolve({ port: this.port, redirectUri: `http://${this.host}:${this.port}` });
      });
    });
  }

  waitForCode(opts: { timeoutMs?: number } = {}): Promise<LoopbackResult> {
    const timeoutMs = opts.timeoutMs ?? 300_000;
    return new Promise<LoopbackResult>((resolve, reject) => {
      this.settle = { resolve, reject };
      this.timer = setTimeout(() => {
        this.settle = undefined;
        reject(new AuthError("Timed out waiting for the authentication redirect."));
        this.close();
      }, timeoutMs);
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${this.host}:${this.port}`);
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(DONE_HTML);
    if (!this.settle) return;
    if (this.timer) clearTimeout(this.timer);
    const settle = this.settle;
    this.settle = undefined;
    if (error) {
      const detail = errorDescription ? `${error}: ${errorDescription}` : error;
      settle.reject(new AuthError(`Authorization failed: ${detail}`));
    } else if (code) settle.resolve({ code, state });
    else settle.reject(new AuthError("Redirect had neither code nor error."));
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.server?.close();
    this.server = undefined;
  }
}
