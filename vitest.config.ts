import path from "node:path"
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Tests run inside workerd with the real bindings from wrangler.jsonc and a fresh local D1
// with migrations/ applied (worker/test/setup.ts). Secrets come from fnox via the test:run step (npm run app:verify).
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"))
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Guest sign-in off, so the tests cover the switch; the localhost test covers it on.
          bindings: { TEST_MIGRATIONS: migrations, GUEST_SIGN_IN: "false" },
        },
      }),
    ],
    resolve: { alias: { "@shared": path.join(import.meta.dirname, "shared") } },
    test: {
      include: ["worker/**/*.test.ts", "shared/**/*.test.ts"],
      setupFiles: ["./worker/test/setup.ts"],
    },
  }
})
