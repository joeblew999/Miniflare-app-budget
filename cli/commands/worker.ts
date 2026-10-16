import type { Command } from "commander"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEV_SECRET, fail, run, tryRun } from "../run.ts"
import * as cloud from "../cloud.ts"

const SECRETS = ["BETTER_AUTH_SECRET"] // must match "secrets.required" in wrangler.jsonc
const migrateRemote = ["d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.jsonc"]

export function register(program: Command): void {
  const worker = program.command("worker").description("The Cloudflare Worker (wrangler)")

  worker.command("types").description("Regenerate worker-configuration.d.ts from wrangler.jsonc")
    .action(() => run("wrangler", ["types", "--strict-vars=false"])) // vars typed as string, since Previews override them

  worker.command("deploy").description("Deploy the build in dist/ from your machine (credentials and secrets from your fnox production profile)")
    .action(() => run("node", ["cli/main.ts", "worker", "ci"], { secrets: { profile: "production" } }))

  worker.command("ci").description("Deploy step for Cloudflare Workers Builds: migrate D1, then deploy with secrets from the environment. Run after app build.")
    .action(ciDeploy)

  worker.command("preview").description("Preview step for Workers Builds (one Preview per branch): migrate the staging D1, then deploy a Preview. Run after app build.")
    .action(previewDeploy)

  worker.command("setup").description("Create or update everything on Cloudflare: Worker, staging DB, Workers Builds, Previews, secrets (safe to re-run)")
    .option("--rotate-secrets", "generate new values for the Worker's secrets")
    .action((opts: { rotateSecrets?: boolean }) => withCloudflare(() => cloud.setup(opts)))

  worker.command("build").description("Start a Workers Build, wait for it and print the URL (production by default)")
    .option("--branch <branch>", "build this branch's Preview instead of production")
    .action((opts: { branch?: string }) => withCloudflare(() => cloud.build(opts)))

  worker.command("status").description("Show the production and Preview URLs and the latest builds")
    .action(() => withCloudflare(() => cloud.status()))

  worker.command("logs").description("Print a build's log (the latest build by default)")
    .argument("[build-uuid]", "build id from worker status")
    .action((uuid?: string) => withCloudflare(() => cloud.logs(uuid)))
}

/** Cloudflare API commands need credentials: re-run this command under the fnox production profile if they're not set. */
function withCloudflare(fn: () => Promise<void>): void {
  if (!process.env.CLOUDFLARE_API_TOKEN && !process.env.BUDGET_CLI_FNOX) {
    run("node", [process.argv[1], ...process.argv.slice(2)], { secrets: { profile: "production" }, env: { BUDGET_CLI_FNOX: "1" } })
    return
  }
  fn().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
}

/** Read the required secrets from the environment, refusing missing or dev-default values. */
function secretsFromEnv(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const name of SECRETS) {
    const value = process.env[name]?.trim()
    if (!value) fail(`${name} is not set. In Workers Builds add it under Settings > Build > Variables and secrets; locally set it in your fnox production profile.`)
    if (value === DEV_SECRET) fail(`${name} is still the local dev default. Set a real value before deploying.`)
    values[name] = value
  }
  return values
}

/** Write secrets to a private temp file for wrangler's --secrets-file, and always delete it afterwards. */
function withSecretsFile(values: Record<string, string>, fn: (file: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "secrets-"))
  const file = path.join(dir, "secrets.json")
  try {
    writeFileSync(file, JSON.stringify(values), { mode: 0o600 })
    fn(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Previews share the staging database in wrangler.preview-migrations.jsonc; production data is never touched. */
function previewDeploy(): void {
  const values = secretsFromEnv()
  run("wrangler", ["d1", "migrations", "apply", "PREVIEW_DB", "--remote", "--config", "wrangler.preview-migrations.jsonc"])
  withSecretsFile(values, (file) => run("wrangler", ["preview", "--secrets-file", file]))
}

/**
 * Migrate the remote database, then deploy. On the very first deploy the database doesn't exist yet,
 * so the deploy creates it (automatic provisioning) and the migration runs straight after.
 * Secrets are read from the environment (Workers Builds build secrets, or fnox) and uploaded with the deploy.
 */
function ciDeploy(): void {
  const values = secretsFromEnv()

  const migrated = tryRun("wrangler", migrateRemote)
  if (!migrated) console.log("Database not migrated yet (first deploy?). Deploying first so wrangler can create it, then migrating.")

  withSecretsFile(values, (file) => run("wrangler", ["deploy", "--secrets-file", file]))

  if (!migrated) run("wrangler", migrateRemote)
}
