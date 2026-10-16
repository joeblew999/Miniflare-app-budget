import type { Command } from "commander"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cf, cfMaybe, credentials, randomSecret, scriptTag, sleep, withCloudflare, type BuildConfig, type EnvVar } from "../lib/cloudflare.ts"
import { BUILD, githubRepo, requiredSecrets, stagingDatabase, workerName, writeStagingDatabaseId } from "../lib/project.ts"
import { capture, DEV_SECRET, fail, run, tryRun } from "../lib/run.ts"

const SECRETS = ["BETTER_AUTH_SECRET"] // must match "secrets.required" in wrangler.jsonc
const migrateRemote = ["d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.jsonc"]

export function register(program: Command): void {
  const worker = program.command("worker").description("The Cloudflare Worker (wrangler)")

  worker.command("types").description("Regenerate worker-configuration.d.ts from wrangler.jsonc")
    .action(() => run("wrangler", ["types", "--strict-vars=false"])) // vars typed as string, since Previews override them

  worker.command("deploy").description("Deploy the build in dist/ to production from your machine (credentials from your fnox production profile; the Worker keeps its secrets)")
    .action(() => withCloudflare(ciDeploy))

  worker.command("ci").description("Workers Builds' deploy command (after its app:build): migrate D1, then deploy with secrets from the environment")
    .action(() => withCloudflare(ciDeploy))

  worker.command("preview").description("Deploy this branch's Preview (Workers Builds' preview command, and how agents deploy): migrate the staging D1, then deploy a Preview")
    .action(() => withCloudflare(previewDeploy))

  worker.command("setup").description("Create or update everything on Cloudflare: Worker, staging DB, Workers Builds, Previews, secrets (safe to re-run)")
    .option("--rotate-secrets", "generate new values for the Worker's secrets")
    .action((opts: { rotateSecrets?: boolean }) => withCloudflare(() => setup(opts)))

  worker.command("build").description("Start a Workers Build, wait for it and print the URL (production by default)")
    .option("--branch <branch>", "build this branch's Preview instead of production")
    .action((opts: { branch?: string }) => withCloudflare(() => build(opts)))

  worker.command("status").description("Show the production and Preview URLs and the latest builds")
    .action(() => withCloudflare(() => status()))

  worker.command("logs").description("Print a build's log (the latest build by default)")
    .argument("[build-uuid]", "build id from worker status")
    .action((uuid?: string) => withCloudflare(() => logs(uuid)))
}

/**
 * The required secrets that are set in the environment (Workers Builds' build variables). One that isn't set keeps
 * the value the Worker already has, so deploying from a machine or a cloud session needs no secrets; wrangler's
 * secrets.required check still fails a Worker that has none. The local dev default is always refused.
 */
function secretsFromEnv(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const name of SECRETS) {
    const value = process.env[name]?.trim()
    if (value === DEV_SECRET) fail(`${name} is the local dev default. It must never reach Cloudflare.`)
    if (value) values[name] = value
    else console.log(`${name} isn't set here, so the Worker keeps the value it has.`)
  }
  return values
}

/** wrangler's --secrets-file for the given secrets, in a private temp file that is always deleted afterwards. */
function withSecretsFile(values: Record<string, string>, fn: (args: string[]) => void): void {
  if (!Object.keys(values).length) return fn([])
  const dir = mkdtempSync(path.join(tmpdir(), "secrets-"))
  const file = path.join(dir, "secrets.json")
  try {
    writeFileSync(file, JSON.stringify(values), { mode: 0o600 })
    fn(["--secrets-file", file])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Previews share the staging database in wrangler.preview-migrations.jsonc; production data is never touched. */
function previewDeploy(): void {
  const values = secretsFromEnv()
  run("wrangler", ["d1", "migrations", "apply", "PREVIEW_DB", "--remote", "--config", "wrangler.preview-migrations.jsonc"])
  withSecretsFile(values, (args) => run("wrangler", ["preview", ...args]))
}

/**
 * Migrate the remote database, then deploy. On the very first deploy the database doesn't exist yet,
 * so the deploy creates it (automatic provisioning) and the migration runs straight after.
 * Secrets set in the environment (Workers Builds build secrets) are uploaded with the deploy.
 */
function ciDeploy(): void {
  const values = secretsFromEnv()

  const migrated = tryRun("wrangler", migrateRemote)
  if (!migrated) console.log("Database not migrated yet (first deploy?). Deploying first so wrangler can create it, then migrating.")

  withSecretsFile(values, (args) => run("wrangler", ["deploy", ...args]))

  if (!migrated) run("wrangler", migrateRemote)
}

// Cloudflare setup and builds, through the REST API (worker setup / build / status / logs).

interface Script { id: string; tag: string }
interface BuildToken { build_token_uuid: string; build_token_name: string }
interface Trigger { trigger_uuid: string; deploy_command: string }
interface Preview { preview_id: string; branch: string }
interface Build {
  build_uuid: string
  status: string
  build_outcome: string | null
  created_on: string
  build_trigger_metadata?: { branch?: string; deploy_command?: string; commit_message?: string }
}

const log = (msg: string) => console.log(`  ${msg}`)

async function requireTag(): Promise<string> {
  const tag = await scriptTag(workerName())
  if (!tag) fail(`Worker ${workerName()} doesn't exist yet. Run \`npm run worker:setup\` first.`)
  return tag
}

async function subdomain(): Promise<string> {
  return (await cf<{ subdomain: string }>("GET", "/accounts/:account/workers/subdomain")).subdomain
}

/** A placeholder Worker, so Workers Builds has something to attach to. The first build replaces it. */
async function createPlaceholder(name: string): Promise<string> {
  const code = `export default { fetch() { return new Response("${name} is being deployed by Workers Builds.") } }`
  const boundary = `----cli${Date.now()}`
  const body = [
    `--${boundary}`, 'Content-Disposition: form-data; name="metadata"', "Content-Type: application/json", "",
    JSON.stringify({ main_module: "index.js", compatibility_date: "2026-10-01" }),
    `--${boundary}`, 'Content-Disposition: form-data; name="index.js"; filename="index.js"', "Content-Type: application/javascript+module", "",
    code, `--${boundary}--`,
  ].join("\r\n")
  const r = await cf<Script>("PUT", `/accounts/:account/workers/scripts/${name}`, undefined, { raw: body, contentType: `multipart/form-data; boundary=${boundary}` })
  return r.tag
}

/** A build token backed by your own CLOUDFLARE_API_TOKEN, named after the Worker. */
async function ensureBuildToken(name: string): Promise<string> {
  const tokenName = `${name} build token`
  const tokens = await cf<BuildToken[]>("GET", "/accounts/:account/builds/tokens")
  const existing = tokens.find((t) => t.build_token_name === tokenName)
  if (existing) return existing.build_token_uuid
  const { token } = credentials()
  // The everyday token is a user token (the Workers Builds API needs one); an account token answers the other endpoint.
  const verified = (await cf<{ id: string; expires_on?: string }>("GET", "/user/tokens/verify").catch(() => null))
    ?? (await cf<{ id: string; expires_on?: string }>("GET", "/accounts/:account/tokens/verify"))
  // A short-lived token (an agent's lease) would break every build once it expires.
  if (verified.expires_on && Date.parse(verified.expires_on) < Date.now() + 30 * 86_400_000)
    fail(`This Cloudflare token expires on ${verified.expires_on}, too soon to become the Workers Builds build token. Use your everyday token (npm run env:setup).`)
  const created = await cf<BuildToken>("POST", "/accounts/:account/builds/tokens", {
    build_token_name: tokenName, build_token_secret: token, cloudflare_token_id: verified.id,
  })
  log(`created build token "${tokenName}"`)
  return created.build_token_uuid
}

/** Secrets that are missing from a build's variables get a fresh random value (or all of them, with rotate). */
function secretVars(current: Record<string, EnvVar> | undefined, rotate: boolean): Record<string, EnvVar> | undefined {
  const out: Record<string, EnvVar> = {}
  for (const name of requiredSecrets()) if (rotate || !current?.[name]) out[name] = { is_secret: true, value: randomSecret() }
  return Object.keys(out).length ? out : undefined
}

async function setup(opts: { rotateSecrets?: boolean }): Promise<void> {
  const name = workerName()
  const { accountId } = credentials()
  console.log(`Setting up ${name} on Cloudflare account ${accountId}`)

  // 1. The Worker and its workers.dev URL
  let tag = await scriptTag(name)
  if (tag) log(`Worker ${name} exists`)
  else { tag = await createPlaceholder(name); log(`created placeholder Worker ${name}`) }
  await cf("POST", `/accounts/:account/workers/scripts/${name}/subdomain`, { enabled: true, previews_enabled: true })

  // 2. Staging database for Previews; its id lives in the repo
  const staging = stagingDatabase()
  const found = await cf<{ uuid: string; name: string }[]>("GET", "/accounts/:account/d1/database", undefined)
    .then((dbs) => dbs.find((d) => d.name === staging.name))
  const stagingId = found?.uuid ?? (await cf<{ uuid: string }>("POST", "/accounts/:account/d1/database", { name: staging.name })).uuid
  log(found ? `staging database ${staging.name} exists` : `created staging database ${staging.name}`)
  if (writeStagingDatabaseId(stagingId)) log(`wrote staging database id to wrangler.jsonc and wrangler.preview-migrations.jsonc. Commit these.`)

  // 3. Build token, repo and build settings
  const buildToken = await ensureBuildToken(name)
  const repo = await githubRepo()
  const production = { build_command: BUILD.buildCommand, deploy_command: BUILD.deployCommand, root_directory: "/", build_token_uuid: buildToken, build_caching_enabled: true }
  const previews = { build_command: BUILD.buildCommand, deploy_command: BUILD.previewCommand, root_directory: "/", build_token_uuid: buildToken, build_caching_enabled: true }
  const config = await cfMaybe<BuildConfig>("GET", `/accounts/:account/builds/workers/${tag}`)

  if (!config) {
    await cf("POST", "/accounts/:account/builds/workers", {
      script_tag: tag,
      git_repository: { provider_type: "github", provider_account_id: repo.ownerId, provider_account_name: repo.owner, repo_id: repo.repoId, repo_name: repo.repo, branch: BUILD.productionBranch },
      production_settings: { ...production, environment_variables: secretVars(undefined, true) },
      previews_enabled: false,
      previews_base_config: { ...previews, environment_variables: secretVars(undefined, true) },
    })
    log(`connected ${repo.owner}/${repo.repo} (production branch ${BUILD.productionBranch})`)
  } else {
    await cf("PATCH", `/accounts/:account/builds/workers/${tag}`, {
      production_settings: { ...production, environment_variables: secretVars(config.production_settings.environment_variables, !!opts.rotateSecrets) },
      previews_base_config: { ...previews, environment_variables: secretVars(config.previews_base_config?.environment_variables, !!opts.rotateSecrets) },
    })
    log("updated build settings")
  }

  // 4. Previews: one per branch
  const now = await cf<BuildConfig>("GET", `/accounts/:account/builds/workers/${tag}`)
  if (!now.previews_enabled) {
    await cf("POST", `/accounts/:account/builds/workers/${tag}/migrate_to_previews`, { deploy_command: BUILD.previewCommand })
    log("turned on Previews")
  } else log("Previews are on")

  // Previews deployed outside Workers Builds (worker:preview from a machine or a cloud session) take their secrets
  // from the Previews base config. Each one is set once; an existing value is left alone unless rotating.
  let base = ""
  try { base = capture("wrangler", ["preview", "base-config", "secret", "list"]) } catch { /* no base config secrets yet */ }
  for (const name of requiredSecrets()) {
    if (base.includes(name) && !opts.rotateSecrets) continue
    run("wrangler", ["preview", "base-config", "secret", "put", name], { input: randomSecret() })
    log(`set ${name} in the Previews base config`)
  }

  const sub = await subdomain()
  console.log(`\nDone. Production: https://${name}.${sub}.workers.dev (builds on push to ${BUILD.productionBranch})`)
  console.log(`Previews: https://<branch>-${name}.${sub}.workers.dev (builds on push to any other branch)`)
}

async function waitFor(uuid: string): Promise<Build> {
  process.stdout.write("  building")
  for (;;) {
    const b = await cf<Build>("GET", `/accounts/:account/builds/builds/${uuid}`)
    if (b.status === "stopped") { process.stdout.write("\n"); return b }
    process.stdout.write(".")
    await sleep(5000)
  }
}

async function logLines(uuid: string): Promise<string[]> {
  const lines: string[] = []
  let cursor: string | undefined
  do {
    const page = await cf<{ lines: [number, string][]; cursor?: string; truncated?: boolean }>(
      "GET", `/accounts/:account/builds/builds/${uuid}/logs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
    lines.push(...page.lines.map(([, msg]) => msg))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return lines
}

async function build(opts: { branch?: string }): Promise<void> {
  const tag = await requireTag()
  const branch = opts.branch ?? BUILD.productionBranch
  let started: Build
  if (branch === BUILD.productionBranch) {
    const triggers = await cf<Trigger[]>("GET", `/accounts/:account/builds/workers/${tag}/triggers`)
    const trigger = triggers.find((t) => t.deploy_command === BUILD.deployCommand) ?? triggers[0]
    if (!trigger) fail("No production build trigger. Run `npm run worker:setup`.")
    started = await cf<Build>("POST", `/accounts/:account/builds/triggers/${trigger.trigger_uuid}/builds`, { branch })
    console.log(`Production build of ${branch} started (${started.build_uuid})`)
  } else {
    const previews = await cf<Preview[]>("GET", `/accounts/:account/builds/workers/${tag}/previews`)
    const preview = previews.find((p) => p.branch === branch)
    if (!preview) fail(`No Preview for branch ${branch} yet. Push the branch; Cloudflare creates its Preview on the first push.`)
    started = await cf<Build>("POST", `/accounts/:account/builds/workers/${tag}/previews/${preview.preview_id}/builds`, { branch })
    console.log(`Preview build of ${branch} started (${started.build_uuid})`)
  }

  const done = await waitFor(started.build_uuid)
  const lines = await logLines(started.build_uuid)
  if (done.build_outcome !== "success") {
    console.log(lines.slice(-40).join("\n"))
    fail(`Build ${done.build_outcome ?? "failed"}. Full log: npm run worker:logs -- ${started.build_uuid}`)
  }
  const urls = [...new Set(lines.flatMap((l) => l.match(/https:\/\/[\w.-]+\.workers\.dev/g) ?? []))]
  console.log(`Build succeeded.${urls.length ? "\n" + urls.map((u) => `  ${u}`).join("\n") : ""}`)
}

/** Production builds and every Preview's builds, newest first. */
async function allBuilds(tag: string): Promise<{ builds: Build[]; previews: Preview[] }> {
  const production = await cf<Build[]>("GET", `/accounts/:account/builds/workers/${tag}/builds`)
  const previews = await cf<Preview[]>("GET", `/accounts/:account/builds/workers/${tag}/previews`).catch(() => [] as Preview[])
  const perPreview = await Promise.all(previews.map((p) =>
    cf<Build[]>("GET", `/accounts/:account/builds/workers/${tag}/previews/${p.preview_id}/builds`).catch(() => [] as Build[])))
  const builds = [...production, ...perPreview.flat()].sort((a, b) => b.created_on.localeCompare(a.created_on))
  return { builds, previews }
}

async function status(): Promise<void> {
  const name = workerName()
  const tag = await requireTag()
  const sub = await subdomain()
  const { builds, previews } = await allBuilds(tag)
  console.log(`Production  https://${name}.${sub}.workers.dev`)
  for (const p of previews) console.log(`Preview     https://${p.branch.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${name}.${sub}.workers.dev  (${p.branch})`)
  console.log("\nRecent builds")
  for (const b of builds.slice(0, 8)) {
    const kind = b.build_trigger_metadata?.deploy_command === BUILD.previewCommand ? "preview" : "production"
    console.log(`  ${b.created_on.slice(0, 16).replace("T", " ")}  ${(b.build_outcome ?? b.status).padEnd(9)} ${kind.padEnd(10)} ${b.build_trigger_metadata?.branch ?? ""}  ${b.build_uuid}`)
  }
}

async function logs(uuid?: string): Promise<void> {
  let id = uuid
  if (!id) {
    const { builds } = await allBuilds(await requireTag())
    id = builds[0]?.build_uuid
    if (!id) fail("No builds yet.")
  }
  console.log((await logLines(id)).join("\n"))
}
