import type { Command } from "commander"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEV_SECRET, fail, run, tryRun } from "../run.ts"
import { build } from "./app.ts"

const SECRETS = ["BETTER_AUTH_SECRET"] // must match "secrets.required" in wrangler.jsonc
const migrateRemote = ["d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.jsonc"]

export function register(program: Command): void {
  const worker = program.command("worker").description("The Cloudflare Worker (wrangler)")

  worker.command("types").description("Regenerate worker-configuration.d.ts from wrangler.jsonc")
    .action(() => run("wrangler", ["types"]))

  worker.command("deploy").description("Build and deploy from your machine (credentials and secrets from your fnox production profile)")
    .action(() => {
      build()
      run("node", ["cli/main.ts", "worker", "ci"], { secrets: { profile: "production" } })
    })

  worker.command("ci").description("Deploy step for Cloudflare Workers Builds: migrate D1, then deploy with secrets from the environment. Run after app build.")
    .action(ciDeploy)
}

/**
 * Migrate the remote database, then deploy. On the very first deploy the database doesn't exist yet,
 * so the deploy creates it (automatic provisioning) and the migration runs straight after.
 * Secrets are read from the environment (Workers Builds build secrets, or fnox) and uploaded with the deploy.
 */
function ciDeploy(): void {
  const values: Record<string, string> = {}
  for (const name of SECRETS) {
    const value = process.env[name]?.trim()
    if (!value) fail(`${name} is not set. In Workers Builds add it under Settings > Build > Variables and secrets; locally set it in your fnox production profile.`)
    if (value === DEV_SECRET) fail(`${name} is still the local dev default. Set a real value before deploying.`)
    values[name] = value
  }

  const migrated = tryRun("wrangler", migrateRemote)
  if (!migrated) console.log("Database not migrated yet (first deploy?). Deploying first so wrangler can create it, then migrating.")

  const dir = mkdtempSync(path.join(tmpdir(), "secrets-"))
  const file = path.join(dir, "secrets.json")
  try {
    writeFileSync(file, JSON.stringify(values), { mode: 0o600 })
    run("wrangler", ["deploy", "--secrets-file", file])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  if (!migrated) run("wrangler", migrateRemote)
}
