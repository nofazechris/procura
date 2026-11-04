import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@procura/shared": src("./packages/shared/src/index.ts"),
      "@procura/policies/core": src("./packages/policies/src/core.ts"),
      "@procura/policies": src("./packages/policies/src/index.ts"),
      "@procura/database/schema": src("./packages/database/src/schema.ts"),
      "@procura/database": src("./packages/database/src/index.ts"),
      "@procura/procurement/core": src("./packages/procurement/src/core.ts"),
      "@procura/procurement": src("./packages/procurement/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    // PGlite boots a Postgres and applies every migration in beforeAll; that can be slow on a busy machine.
    hookTimeout: 90_000,
  },
});
