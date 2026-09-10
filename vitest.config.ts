import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  // Under vitest+jsdom we want Svelte's browser build so the runtime
  // ($state/$effect/$props, mount/unmount) behaves like it does in Obsidian.
  resolve: {
    // Narrows Vite module resolution suite-wide to the "browser" export
    // condition (needed for Svelte's client runtime); kept green as of T24.
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
