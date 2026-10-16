import type { Command } from "commander"
import { run } from "../run.ts"

const DB = "DB" // binding name in wrangler.jsonc
const production = { profile: "production" }

export function register(program: Command): void {
  const db = program.command("db").description("The D1 database (Drizzle schema in worker/db/schema.ts)")

  db.command("gen").description("Write a SQL migration for changes to worker/db/schema.ts")
    .argument("<name>", "short migration name, e.g. add-notes")
    .action((name: string) => run("drizzle-kit", ["generate", "--name", name]))

  db.command("migrate").description("Apply pending migrations (local by default)")
    .option("--remote", "apply to the Cloudflare database (uses your fnox production profile)")
    .action((opts: { remote?: boolean }) => opts.remote
      ? run("wrangler", ["d1", "migrations", "apply", DB, "--remote", "--config", "wrangler.jsonc"], { secrets: production })
      : migrateLocal())

}

function migrateLocal(): void {
  run("wrangler", ["d1", "migrations", "apply", DB, "--local"], { env: { CI: "1" } })
}
