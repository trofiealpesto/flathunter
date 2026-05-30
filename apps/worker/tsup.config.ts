import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/dev.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  external: ["pg", "drizzle-orm"],
  noExternal: ["@flathunter/db", "@flathunter/shared"]
});
