import type { Command } from "commander"
import { run } from "../lib/run.ts"

/** Secrets from fnox reach the Worker under test the same way as in app:dev. */
const opts = { secrets: true, env: { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" } }

export function register(program: Command): void {
  const test = program.command("test").description("Tests (Vitest, running inside workerd)")

  test.command("run").description("Run all tests once")
    .action(() => run("vitest", ["run"], opts))

  test.command("watch").description("Re-run tests on change")
    .action(() => run("vitest", [], opts))
}
