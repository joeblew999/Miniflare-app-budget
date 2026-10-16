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
      ? run("wrangler", ["d1", "migrations", "apply", DB, "--remote"], { secrets: production })
      : migrateLocal())

  db.command("create").description("Create the Cloudflare D1 database; put the printed id in wrangler.jsonc")
    .action(() => run("wrangler", ["d1", "create", "baht-dollar-budget"], { secrets: production }))
}

export function migrateLocal(): void {
  run("wrangler", ["d1", "migrations", "apply", DB, "--local"], { env: { CI: "1" } })
}
