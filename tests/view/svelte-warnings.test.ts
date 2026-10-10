import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compile } from "svelte/compiler";

// The production build compiles every component and merely PRINTS the Svelte
// compiler's warnings (accessibility, unused CSS, state referenced locally…),
// so a bad one reaches the user's terminal instead of failing CI. Compile them
// all here, the same way the build does, and fail on any warning.
function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? svelteFiles(join(dir, e.name)) : e.name.endsWith(".svelte") ? [join(dir, e.name)] : [],
  );
}

describe("Svelte components compile without warnings", () => {
  const files = svelteFiles("src");

  it("finds the components", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s", (file) => {
    const { warnings } = compile(readFileSync(file, "utf8"), { filename: file, generate: "client", css: "injected" });
    expect(warnings.map((w) => `${w.code}: ${w.message} (line ${w.start?.line})`)).toEqual([]);
  });
});
