import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const scripts = ["install.sh", "uninstall.sh", "link.sh"];

describe("scripts", () => {
  it.each(scripts)("%s parses as valid bash", (s) => {
    expect(() => execFileSync("bash", ["-n", `scripts/${s}`])).not.toThrow();
  });

  it.each(scripts)("%s does not hardcode the plugin id", (s) => {
    const body = readFileSync(`scripts/${s}`, "utf8");
    expect(body).toContain("manifest.json').id");
    expect(body).not.toMatch(/plugins\/obsidian-email/);
  });
});
