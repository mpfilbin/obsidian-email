type Level = "debug" | "info" | "warn" | "error";

export class Logger {
  constructor(
    private scope: string,
    private opts: { debug: () => boolean },
  ) {}

  private prefix(): string {
    return `[obsidian-email-${this.scope}]`;
  }

  private emit(level: Level, msg: string, args: unknown[]): void {
    if (level === "debug" && !this.opts.debug()) return;
    const line = `${this.prefix()} ${msg}`;
    // eslint-disable-next-line no-console
    if (args.length > 0) console[level](line, ...args);
    // eslint-disable-next-line no-console
    else console[level](line);
  }

  debug(msg: string, ...args: unknown[]): void {
    this.emit("debug", msg, args);
  }
  info(msg: string, ...args: unknown[]): void {
    this.emit("info", msg, args);
  }
  warn(msg: string, ...args: unknown[]): void {
    this.emit("warn", msg, args);
  }
  error(msg: string, ...args: unknown[]): void {
    this.emit("error", msg, args);
  }
}
