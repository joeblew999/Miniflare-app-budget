import type { Command } from "commander"
import { spawnSync } from "node:child_process"
import { createCipheriv, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { cf, CloudflareError, expiresIn, scriptTag, sleep, withCloudflare, type ApiToken, type BuildConfig, type TokenPolicy } from "../lib/cloudflare.ts"
import { githubRepo, workerName } from "../lib/project.ts"
import { capture, fail, root, run, tryRun } from "../lib/run.ts"

/** This machine's own fnox file (gitignored): it says which store holds each value, never the value itself. */
const LOCAL = "fnox.local.toml"
const DAY = 86_400_000

interface Permission { name: string; formKey?: { key: string; type: "edit" | "read" } }

/**
 * This machine's everyday Cloudflare token: the one list of what it may do. env setup builds the pre-filled form from it,
 * names any permission that's missing, and checks each with a read call (probe). When the app needs more, add a line
 * here, and every developer's next env setup asks for it.
 * It's a user token, because the Workers Builds API rejects account tokens. It also becomes the Workers Builds build
 * token, which every branch's build can reach, so keep it to what's needed.
 */
const EVERYDAY: { name: string; permissions: (Permission & { probe: string })[] } = {
  name: "baht-dollar-budget (this Mac)",
  permissions: [
    { name: "Workers Scripts: Edit", formKey: { key: "workers_scripts", type: "edit" }, probe: "/workers/scripts" },
    { name: "D1: Edit", formKey: { key: "d1", type: "edit" }, probe: "/d1/database" },
    { name: "Workers Builds Configuration: Edit", probe: "/builds/tokens" }, // no known form key yet: added by hand
    { name: "Account Settings: Read", formKey: { key: "account_settings", type: "read" }, probe: "" },
  ],
}

/**
 * The parent token: an account token whose only job is making short-lived tokens for agent sessions (env issue, in the
 * GitHub mint workflow). Its children get its permissions except token management. Agents deploy with wrangler, which
 * takes account tokens; the Workers Builds API doesn't, so it isn't here. The one list, as for EVERYDAY.
 */
const PARENT: { name: string; permissions: Permission[] } = {
  name: "baht-dollar-budget agents (parent)",
  permissions: [
    { name: "Account API Tokens: Edit", formKey: { key: "account_api_tokens", type: "edit" } },
    { name: "Workers Scripts: Edit", formKey: { key: "workers_scripts", type: "edit" } },
    { name: "D1: Edit", formKey: { key: "d1", type: "edit" } },
    { name: "Account Settings: Read", formKey: { key: "account_settings", type: "read" } },
  ],
}

const formKeys = (perms: Permission[]) => JSON.stringify(perms.flatMap((p) => (p.formKey ? [p.formKey] : [])))
const userForm = (name: string, perms: Permission[]) =>
  "https://dash.cloudflare.com/profile/api-tokens?" + new URLSearchParams({ permissionGroupKeys: formKeys(perms), accountId: "*", zoneId: "all", name })
const accountForm = (name: string, perms: Permission[]) =>
  "https://dash.cloudflare.com/?to=/:account/api-tokens&" + new URLSearchParams({ permissionGroupKeys: formKeys(perms), name })

/** The dashboard's "D1: Edit" is the API's "D1 Write". */
const norm = (name: string) => name.toLowerCase().replace(":", "").replace(/\bedit\b/, "write").replace(/\s+/g, " ").trim()

/** What the mint workflow reads from GitHub. Only env setup writes these. */
const GH = { parent: "CLOUDFLARE_PARENT_TOKEN", agent: "CLOUDFLARE_AGENT_TOKEN", account: "CLOUDFLARE_ACCOUNT_ID", source: "CLOUDFLARE_LEASE_SOURCE" }
const WORKFLOW = "mint-cloudflare-token.yml"
const FALLBACK_NAME = "baht-dollar-budget agents (30 days)"
const MAX_LEASE = 4 * 3_600_000

/** Which token the workflow hands out from, as the GitHub variable GH.source: ids and dates only. */
interface LeaseSource { mode: "parent" | "agent"; parentId: string; expiresOn?: string }
/** What env issue sends a session, encrypted to the session's key. */
interface Lease { token: string; accountId: string; expiresOn: string; sourceExpiresOn?: string }

const LEASE_MARK = "# Written by `npm run env:lease`: this cloud session's short-lived Cloudflare token. The next env:lease replaces it."

interface SetupOptions { account?: string; provider: string; recheck?: boolean; keepOtherTokens?: boolean }

export function register(program: Command): void {
  const env = program.command("env").description("Secrets and env vars (fnox), and Cloudflare access")

  env.command("list").description("List the secrets declared in fnox.toml")
    .action(() => run("fnox", ["list"]))

  env.command("check").description("Check every secret has a value in your store")
    .action(() => run("fnox", ["check"]))

  env.command("setup").description("Give this machine its Cloudflare access and agents theirs: your everyday token and account id in fnox, the parent token that makes agents' short-lived tokens, and what the mint workflow needs on GitHub. Never waits: if it needs you, it opens the pre-filled Cloudflare form, says what to do and stops; then run it again (safe to re-run)")
    .option("--account <id>", "Cloudflare account id, if your token can see more than one account")
    .option("--provider <name>", "fnox provider to keep the tokens in", "keychain")
    .option("--recheck", "check the parent token again even if GitHub is up to date")
    .option("--keep-other-tokens", "go on even if other account tokens can do more than the parent")
    .action((opts: SetupOptions) => setup(opts).catch(failWith))

  env.command("push").description("Copy the secrets listed in env.targets.jsonc from fnox to their targets: Worker secrets, Workers Builds variables, GitHub")
    .option("--dry-run", "only list what would be set where (names, never values)")
    .option("--only <name>", "push just this secret")
    .action((opts: { dryRun?: boolean; only?: string }) => withCloudflare(() => push(opts)))

  env.command("status").description("Show which secrets are where (names only), and warn about Cloudflare tokens that expire within 14 days")
    .action(() => withCloudflare(status))

  env.command("lease").description("Cloud sessions: get a short-lived Cloudflare token from the GitHub mint workflow, with nothing pasted, and keep it in this session's fnox.local.toml")
    .option("--ttl <duration>", "how long the token lasts, like 90m or 4h (at most 4h)", "4h")
    .action((opts: { ttl: string }) => lease(opts).catch(failWith))

  env.command("issue").description("Run by the GitHub mint workflow: make a short-lived Cloudflare token (or take the fallback token) and encrypt it to a session's public key")
    .requiredOption("--public-key <key>", "the session's X25519 public key (SPKI DER, base64)")
    .option("--ttl <duration>", "how long the token lasts, like 90m or 4h (at most 4h)", "4h")
    .option("--out <file>", "where to write the encrypted token", "lease.json")
    .action((opts: { publicKey: string; ttl: string; out: string }) => issue(opts).catch(failWith))
}

const failWith = (e: unknown) => fail(e instanceof Error ? e.message : String(e))

// fnox

/** A value from fnox, or undefined if no store has it (the dev defaults in fnox.toml don't count). */
function fnoxGet(name: string, profile: string): string | undefined {
  try {
    return capture("fnox", ["get", name, "--profile", profile, "--no-defaults", "--if-missing", "error"]).trim() || undefined
  } catch {
    return undefined
  }
}

/** Keep a value in your own store; fnox.local.toml only records where it is. The value goes over stdin. */
function fnoxStore(name: string, profile: string, value: string, provider: string): void {
  run("fnox", ["set", name, "--profile", profile, "-c", LOCAL, "--provider", provider, "-k", `baht-dollar-budget/${name}`], { input: value })
}

// GitHub

let repoSlug: string | undefined
async function repo(): Promise<string> {
  if (!repoSlug) { const r = await githubRepo(); repoSlug = `${r.owner}/${r.repo}` }
  return repoSlug
}
const ghSecretSet = (slug: string, name: string, value: string) => run("gh", ["secret", "set", name, "--repo", slug], { input: value })
const ghSecretDelete = (slug: string, name: string) => void tryRun("gh", ["secret", "delete", name, "--repo", slug], { quiet: true })
const ghVariableSet = (slug: string, name: string, value: string) => run("gh", ["variable", "set", name, "--repo", slug], { input: value })
function ghVariable(slug: string, name: string): string | undefined {
  try { return capture("gh", ["variable", "get", name, "--repo", slug]).trim() } catch { return undefined }
}
const ghNames = (slug: string, kind: "secret" | "variable") =>
  new Set((JSON.parse(capture("gh", [kind, "list", "--repo", slug, "--json", "name"])) as { name: string }[]).map((s) => s.name))

// env setup

const userTokenWorks = async (token: string) =>
  (await cf<{ status: string }>("GET", "/user/tokens/verify", undefined, { token }).catch(() => null))?.status === "active"
const accountTokenWorks = (account: string) => async (token: string) =>
  (await cf<{ status: string }>("GET", `/accounts/${account}/tokens/verify`, undefined, { token }).catch(() => null))?.status === "active"

/** A working token copied from the form, if one is on the clipboard (macOS); the clipboard is cleared once it's taken. */
async function tokenOnClipboard(works: (token: string) => Promise<boolean>): Promise<string | undefined> {
  const out = spawnSync("pbpaste", { encoding: "utf8" })
  const text = out.error ? "" : out.stdout.trim()
  if (!/^[\w-]{30,}$/.test(text) || !(await works(text))) return undefined
  spawnSync("pbcopy", { input: "" })
  return text
}

/** Take the token from the clipboard if it's there; otherwise open the pre-filled form, say what to do, and stop. */
async function obtainToken(what: string, form: string, perms: Permission[], works: (token: string) => Promise<boolean>, store: (token: string) => void): Promise<string> {
  const token = await tokenOnClipboard(works)
  if (token) { store(token); console.log(`${what}: taken from the clipboard and stored in fnox.`); return token }
  console.log(`${what} is needed. Opening the Cloudflare form; it should have exactly these permissions:`)
  for (const p of perms) console.log(`  - ${p.name}${p.formKey ? "" : "   (add this one: the form can't pre-fill it)"}`)
  console.log(`  ${form}`)
  spawnSync("open", [form])
  fail("Press Create, then Copy, then run `npm run env:setup` again. It takes the token from the clipboard.")
}

/** The everyday token's permissions it lacks: one read call each, where a 403 means it's missing. */
async function missingPermissions(token: string, account: string): Promise<string[]> {
  const missing: string[] = []
  for (const p of EVERYDAY.permissions)
    await cf("GET", `/accounts/${account}${p.probe}`, undefined, { token }).catch((e: unknown) => {
      if (e instanceof CloudflareError && e.status === 403) missing.push(p.name)
      else throw e // offline, or Cloudflare down: not a missing permission
    })
  return missing
}

async function setup(opts: SetupOptions): Promise<void> {
  // This machine: the everyday token and the account
  let token = fnoxGet("CLOUDFLARE_API_TOKEN", "production")
  if (token && !(await userTokenWorks(token))) {
    console.log("The Cloudflare token in fnox doesn't work any more (expired, deleted, or not a user token).")
    token = undefined
  }
  token ??= await obtainToken("A Cloudflare user token for this machine", userForm(EVERYDAY.name, EVERYDAY.permissions), EVERYDAY.permissions,
    userTokenWorks, (t) => fnoxStore("CLOUDFLARE_API_TOKEN", "production", t, opts.provider))

  const stored = fnoxGet("CLOUDFLARE_ACCOUNT_ID", "production")
  let account = opts.account ?? stored
  if (!account) {
    const accounts = await cf<{ id: string; name: string }[]>("GET", "/accounts", undefined, { token })
    if (accounts.length !== 1)
      fail(`Your token can see ${accounts.length} accounts. Run again with -- --account <id>:\n${accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n")}`)
    account = accounts[0].id
  }
  if (account !== stored) fnoxStore("CLOUDFLARE_ACCOUNT_ID", "production", account, opts.provider)

  const missing = await missingPermissions(token, account)
  if (missing.length)
    fail(`The Cloudflare token is missing: ${missing.join(", ")}. In Cloudflare: My Profile > API Tokens > edit "${EVERYDAY.name}", add them and save, then run \`npm run env:setup\` again.`)
  console.log(`This machine: Cloudflare token and account ${account}, with every permission it needs.`)

  await setupAgents(account, opts)
}

/** The parent token's own policies, minus token management: what a child (an agent's token) gets. */
const childPolicies = (policies: TokenPolicy[]): TokenPolicy[] => policies
  .map((p) => ({ effect: p.effect, resources: p.resources, permission_groups: p.permission_groups.filter((g) => !/api tokens/i.test(g.name ?? "")).map((g) => ({ id: g.id })) }))
  .filter((p) => p.permission_groups.length)

/** Does Cloudflare cap a child at its parent's permissions? Asks for a 5-minute child with one the parent lacks, then deletes it. */
async function capsChildren(as: { token: string; account: string }): Promise<boolean> {
  const groups = await cf<{ id: string; name: string }[]>("GET", "/accounts/:account/tokens/permission_groups", undefined, as)
  const probe = groups.find((g) => g.name === "Account Analytics Read") ?? fail("Couldn't find the Account Analytics Read permission to test with.")
  let child: ApiToken
  try {
    child = await cf<ApiToken>("POST", "/accounts/:account/tokens", {
      name: "baht-dollar-budget limit test", expires_on: expiresIn(5 * 60_000),
      policies: [{ effect: "allow", resources: { [`com.cloudflare.api.account.${as.account}`]: "*" }, permission_groups: [{ id: probe.id }] }],
    }, as)
  } catch (e) {
    if (e instanceof CloudflareError && e.status >= 400 && e.status < 500) return true // refused: capped
    throw e
  }
  await cf("DELETE", `/accounts/:account/tokens/${child.id}`, undefined, as)
  return !child.policies.some((p) => p.permission_groups.some((g) => g.id === probe.id))
}

async function setupAgents(account: string, opts: SetupOptions): Promise<void> {
  const works = accountTokenWorks(account)
  let parent = fnoxGet(GH.parent, "mint")
  if (parent && !(await works(parent))) { console.log("The parent token in fnox doesn't work any more."); parent = undefined }
  parent ??= await obtainToken("The parent token for agents (an account token)", accountForm(PARENT.name, PARENT.permissions), PARENT.permissions,
    works, (t) => fnoxStore(GH.parent, "mint", t, opts.provider))
  const as = { token: parent, account }

  // Exactly the listed permissions: anything more, agents could reach through GitHub.
  const self = await cf<{ id: string; expires_on?: string }>("GET", "/accounts/:account/tokens/verify", undefined, as)
  const own = await cf<ApiToken>("GET", `/accounts/:account/tokens/${self.id}`, undefined, as)
  const has = own.policies.flatMap((p) => p.permission_groups.map((g) => g.name ?? g.id))
  const wanted = new Set(PARENT.permissions.map((p) => norm(p.name)))
  const lacking = PARENT.permissions.filter((p) => !has.some((h) => norm(h) === norm(p.name))).map((p) => p.name)
  const extra = has.filter((h) => !wanted.has(norm(h)))
  if (lacking.length || extra.length)
    fail(`The parent token should have exactly: ${PARENT.permissions.map((p) => p.name).join(", ")}.`
      + (lacking.length ? ` Add: ${lacking.join(", ")}.` : "") + (extra.length ? ` Remove: ${extra.join(", ")}.` : "")
      + ` Edit "${PARENT.name}" under Manage account > Account API tokens, then run \`npm run env:setup\` again.`)

  const slug = await repo()
  const current = ghVariable(slug, GH.source)
  const source = current ? (JSON.parse(current) as LeaseSource) : undefined
  const secrets = ghNames(slug, "secret")
  const upToDate = source?.parentId === self.id
    && (source.mode === "parent" ? secrets.has(GH.parent) : secrets.has(GH.agent) && Date.parse(source.expiresOn ?? "") > Date.now() + 14 * DAY)
  if (upToDate && !opts.recheck) {
    if (ghVariable(slug, GH.account) !== account) ghVariableSet(slug, GH.account, account)
    console.log(`Agents: GitHub has their Cloudflare token source (${source.mode === "parent" ? "the parent token" : "the 30-day token"}), up to date.`)
    return
  }

  // A parent with token permissions might edit or roll other account tokens: stop if any can do more than it.
  const others = await cf<ApiToken[]>("GET", "/accounts/:account/tokens?per_page=50", undefined, as)
    .catch((e: unknown) => { if (e instanceof CloudflareError && e.status === 403) return [] as ApiToken[]; throw e })
  const allowed = new Set(has.map(norm))
  const broader = others.filter((t) => t.id !== self.id && !t.name.startsWith("baht-dollar-budget")
    && (t.policies ?? []).some((p) => p.permission_groups.some((g) => !allowed.has(norm(g.name ?? "")))))
  if (broader.length && !opts.keepOtherTokens)
    fail(`These account tokens can do more than the parent, and a leaked parent might reach them:\n${broader.map((t) => `  ${t.name} (${t.id})`).join("\n")}\n`
      + "Narrow or delete them under Manage account > Account API tokens, or run again with -- --keep-other-tokens to accept that.")

  let next: LeaseSource
  if (await capsChildren(as)) {
    ghSecretSet(slug, GH.parent, parent)
    ghSecretDelete(slug, GH.agent)
    next = { mode: "parent", parentId: self.id, expiresOn: self.expires_on }
    console.log("Agents: Cloudflare caps what the parent's tokens can do, so the mint workflow makes 4-hour tokens from it.")
  } else {
    const agent = await cf<ApiToken>("POST", "/accounts/:account/tokens", { name: FALLBACK_NAME, policies: childPolicies(own.policies), expires_on: expiresIn(30 * DAY) }, as)
    ghSecretSet(slug, GH.agent, agent.value ?? fail("Cloudflare returned no token value."))
    ghSecretDelete(slug, GH.parent)
    for (const old of others.filter((t) => t.name === FALLBACK_NAME && t.id !== agent.id)) await cf("DELETE", `/accounts/:account/tokens/${old.id}`, undefined, as)
    next = { mode: "agent", parentId: self.id, expiresOn: agent.expires_on }
    console.log("Agents: Cloudflare doesn't cap the parent's tokens, so the parent stays on this machine and agents get a 30-day token (renewed here when it's near its end).")
  }
  ghVariableSet(slug, GH.account, account)
  ghVariableSet(slug, GH.source, JSON.stringify(next))
}

// env push and env status

type Target = string | { target: string; as: string }

/** env.targets.jsonc: where each secret in fnox goes. */
function targets(): Record<string, Target[]> {
  const file = path.join(root, "env.targets.jsonc")
  return existsSync(file) ? ((parseJsonc(readFileSync(file, "utf8")) as Record<string, Target[]> | undefined) ?? {}) : {}
}
const unpack = (t: Target, name: string) => (typeof t === "string" ? { target: t, as: name } : t)

const BUILD_KINDS: Record<string, "production_settings" | "previews_base_config"> = {
  "cloudflare:builds:production": "production_settings",
  "cloudflare:builds:previews": "previews_base_config",
}

async function buildsConfig(): Promise<{ tag: string; config: BuildConfig }> {
  const tag = (await scriptTag(workerName())) ?? fail(`Worker ${workerName()} doesn't exist yet: \`npm run worker:setup\` creates it.`)
  return { tag, config: await cf<BuildConfig>("GET", `/accounts/:account/builds/workers/${tag}`) }
}

async function pushTo(target: string, as: string, value: string, slug: string): Promise<void> {
  if (target === "github:actions") return ghSecretSet(slug, as, value)
  if (target === "github:variables") return ghVariableSet(slug, as, value)
  if (target === "cloudflare:worker") {
    await cf("PUT", `/accounts/:account/workers/scripts/${workerName()}/secrets`, { name: as, text: value, type: "secret_text" })
    return
  }
  const kind = BUILD_KINDS[target] ?? fail(`Unknown target "${target}" in env.targets.jsonc.`)
  const { tag, config } = await buildsConfig()
  const s = config[kind] ?? fail("Workers Builds isn't set up: `npm run worker:setup` does it.")
  await cf("PATCH", `/accounts/:account/builds/workers/${tag}`, {
    [kind]: {
      build_command: s.build_command, deploy_command: s.deploy_command, root_directory: s.root_directory,
      build_token_uuid: s.build_token_uuid, build_caching_enabled: s.build_caching_enabled,
      environment_variables: { [as]: { is_secret: true, value } },
    },
  })
}

async function push(opts: { dryRun?: boolean; only?: string }): Promise<void> {
  const all = targets()
  if (opts.only && !all[opts.only]) fail(`${opts.only} isn't in env.targets.jsonc.`)
  const names = opts.only ? [opts.only] : Object.keys(all)
  if (!names.length) { console.log("env.targets.jsonc lists no secrets, so there's nothing to push."); return }
  const slug = await repo()
  for (const name of names) {
    const value = opts.dryRun ? "" : (fnoxGet(name, "production") ?? fail(`${name} has no value in your fnox production profile.`))
    for (const t of all[name]) {
      const { target, as } = unpack(t, name)
      console.log(`${opts.dryRun ? "would set" : "set"} ${as} in ${target}${as === name ? "" : ` (from ${name})`}`)
      if (!opts.dryRun) await pushTo(target, as, value, slug)
    }
  }
}

async function status(): Promise<void> {
  const soon = (date?: string) => !!date && Date.parse(date) < Date.now() + 14 * DAY
  const warnings: string[] = []

  console.log("This machine (fnox)")
  for (const [name, profile] of [["CLOUDFLARE_API_TOKEN", "production"], ["CLOUDFLARE_ACCOUNT_ID", "production"], [GH.parent, "mint"]])
    console.log(`  ${fnoxGet(name, profile) ? "✓" : "✗"} ${name} (${profile} profile)`)
  const me = await cf<{ expires_on?: string }>("GET", "/user/tokens/verify").catch(() => null)
  console.log(`  everyday token: ${me ? `works, ${me.expires_on ? `expires ${me.expires_on}` : "no expiry"}` : "doesn't work"}`)
  if (soon(me?.expires_on)) warnings.push(`This machine's Cloudflare token expires on ${me?.expires_on}.`)

  const slug = await repo()
  const secrets = ghNames(slug, "secret")
  const variables = ghNames(slug, "variable")
  const source = variables.has(GH.source) ? (JSON.parse(ghVariable(slug, GH.source) ?? "{}") as LeaseSource) : undefined
  console.log(`GitHub (${slug})`)
  console.log(`  agents' Cloudflare tokens: ${source ? `${source.mode === "parent" ? "made from the parent token" : "the 30-day token"}${source.expiresOn ? `, which expires ${source.expiresOn}` : ""}` : "not set up (`npm run env:setup`)"}`)
  if (source && soon(source.expiresOn)) warnings.push(`The agents' Cloudflare token source expires on ${source.expiresOn}.`)

  const all = targets()
  if (Object.keys(all).length) {
    console.log("env.targets.jsonc")
    let workerSecrets: Set<string> | undefined
    let builds: BuildConfig | undefined
    for (const [name, list] of Object.entries(all)) for (const t of list) {
      const { target, as } = unpack(t, name)
      let there = false
      if (target === "github:actions") there = secrets.has(as)
      else if (target === "github:variables") there = variables.has(as)
      else if (target === "cloudflare:worker") {
        workerSecrets ??= new Set((await cf<{ name: string }[]>("GET", `/accounts/:account/workers/scripts/${workerName()}/secrets`)).map((s) => s.name))
        there = workerSecrets.has(as)
      } else if (BUILD_KINDS[target]) {
        builds ??= (await buildsConfig()).config
        there = !!builds[BUILD_KINDS[target]]?.environment_variables?.[as]
      }
      console.log(`  ${there ? "✓" : "✗"} ${as} in ${target}`)
    }
  }
  for (const w of warnings) console.log(`! ${w} \`npm run env:setup\` renews it.`)
}

// env lease (cloud sessions) and env issue (the mint workflow)

function duration(text: string): number {
  const m = /^(\d+)(m|h)$/.exec(text.trim()) ?? fail(`Durations look like 90m or 4h, not "${text}".`)
  return Math.min(Number(m[1]) * (m[2] === "h" ? 3_600_000 : 60_000), MAX_LEASE)
}

const INFO = Buffer.from("baht-dollar-budget lease v1")
const boxKey = (shared: Buffer, salt: Buffer) => Buffer.from(hkdfSync("sha256", shared, salt, INFO, 32))

/** Encrypt a lease to a session's X25519 public key: a one-off key pair, ECDH, HKDF, AES-256-GCM. Only that session can open it. */
export function seal(publicKeyBase64: string, lease: Lease): string {
  if (!/^[A-Za-z0-9+/=]+$/.test(publicKeyBase64)) fail("The public key isn't base64.")
  const recipient = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" })
  if (recipient.asymmetricKeyType !== "x25519") fail("The public key isn't an X25519 key.")
  const own = generateKeyPairSync("x25519")
  const epk = own.publicKey.export({ format: "der", type: "spki" })
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", boxKey(diffieHellman({ privateKey: own.privateKey, publicKey: recipient }), epk), iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(lease)), cipher.final()])
  const box = { v: 1, epk: epk.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64"), tag: cipher.getAuthTag().toString("base64") }
  return Buffer.from(JSON.stringify(box)).toString("base64")
}

export function unseal(privateKey: KeyObject, sealed: string): Lease {
  const box = JSON.parse(Buffer.from(sealed, "base64").toString("utf8")) as { epk: string; iv: string; ct: string; tag: string }
  const epk = Buffer.from(box.epk, "base64")
  const sender = createPublicKey({ key: epk, format: "der", type: "spki" })
  const decipher = createDecipheriv("aes-256-gcm", boxKey(diffieHellman({ privateKey, publicKey: sender }), epk), Buffer.from(box.iv, "base64"))
  decipher.setAuthTag(Buffer.from(box.tag, "base64"))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.ct, "base64")), decipher.final()]).toString("utf8")) as Lease
}

async function issue(opts: { publicKey: string; ttl: string; out: string }): Promise<void> {
  const ttl = duration(opts.ttl)
  const owner = "the owner's `npm run env:setup` puts it on GitHub"
  const account = process.env[GH.account] || fail(`${GH.account} (a GitHub variable) is missing: ${owner}.`)
  const source = (JSON.parse(process.env[GH.source] || "null") as LeaseSource | null) ?? fail(`${GH.source} (a GitHub variable) is missing: ${owner}.`)
  let lease: Lease
  if (source.mode === "parent") {
    const as = { token: process.env[GH.parent] || fail(`${GH.parent} (a GitHub secret) is missing: ${owner}.`), account }
    const self = await cf<{ id: string }>("GET", "/accounts/:account/tokens/verify", undefined, as)
    const own = await cf<ApiToken>("GET", `/accounts/:account/tokens/${self.id}`, undefined, as)
    const child = await cf<ApiToken>("POST", "/accounts/:account/tokens", {
      name: `baht-dollar-budget agent ${new Date().toISOString().slice(0, 16)}`, policies: childPolicies(own.policies), expires_on: expiresIn(ttl),
    }, as)
    lease = { token: child.value ?? fail("Cloudflare returned no token value."), accountId: account, expiresOn: child.expires_on ?? expiresIn(ttl), sourceExpiresOn: source.expiresOn }
  } else {
    const token = process.env[GH.agent] || fail(`${GH.agent} (a GitHub secret) is missing: ${owner}.`)
    lease = { token, accountId: account, expiresOn: source.expiresOn ?? "", sourceExpiresOn: source.expiresOn }
  }
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${lease.token}`) // hidden from the logs before anything else prints
  const sealed = seal(opts.publicKey, lease)
  writeFileSync(opts.out, sealed)
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=lease::${sealed}`) // for sessions that can't download artifacts
  console.log(`Encrypted a Cloudflare token (valid until ${lease.expiresOn}) to the session's key, in ${opts.out}.`)
}

async function findRun(slug: string, id: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const runs = JSON.parse(capture("gh", ["run", "list", "--repo", slug, "--workflow", WORKFLOW, "--limit", "20", "--json", "databaseId,displayTitle"])) as { databaseId: number; displayTitle: string }[]
    const found = runs.find((r) => r.displayTitle === `mint ${id}`)
    if (found) return String(found.databaseId)
    await sleep(2000)
  }
  fail("The mint workflow didn't start within a minute. Look at the repo's Actions tab.")
}

/** The encrypted token: the run's artifact, or the run's "lease" annotation if this session can't download artifacts. */
function sealedFrom(slug: string, runId: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lease-"))
  try {
    if (tryRun("gh", ["run", "download", runId, "--repo", slug, "--name", "lease", "--dir", dir], { quiet: true }))
      return readFileSync(path.join(dir, "lease.json"), "utf8").trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const { jobs } = JSON.parse(capture("gh", ["run", "view", runId, "--repo", slug, "--json", "jobs"])) as { jobs: { databaseId: number }[] }
  const notes = JSON.parse(capture("gh", ["api", `repos/${slug}/check-runs/${jobs[0].databaseId}/annotations`])) as { title?: string; message: string }[]
  return notes.find((n) => n.title === "lease")?.message.trim() ?? fail("The mint workflow's run has no token in it.")
}

async function lease(opts: { ttl: string }): Promise<void> {
  const file = path.join(root, LOCAL)
  if (existsSync(file) && !readFileSync(file, "utf8").startsWith(LEASE_MARK))
    fail(`${LOCAL} wasn't written by env:lease: this machine is set up with env:setup and has its own Cloudflare access. env:lease is for cloud sessions.`)
  duration(opts.ttl)
  const { publicKey, privateKey } = generateKeyPairSync("x25519")
  const key = publicKey.export({ format: "der", type: "spki" }).toString("base64")
  const id = randomBytes(8).toString("hex")
  const slug = await repo()
  run("gh", ["workflow", "run", WORKFLOW, "--repo", slug, "--ref", "main", "-f", `public_key=${key}`, "-f", `request_id=${id}`, "-f", `ttl=${opts.ttl}`])
  const runId = await findRun(slug, id)
  // Quiet: outside a terminal, gh run watch prints the whole run on every refresh.
  console.log("Waiting for the mint workflow...")
  if (!tryRun("gh", ["run", "watch", runId, "--repo", slug, "--exit-status", "--interval", "3"], { quiet: true }))
    fail(`The mint workflow failed: https://github.com/${slug}/actions/runs/${runId}`)
  const got = unseal(privateKey, sealedFrom(slug, runId))
  writeFileSync(file, [
    LEASE_MARK,
    "[profiles.production.secrets]",
    `CLOUDFLARE_API_TOKEN = { default = ${JSON.stringify(got.token)} }`,
    `CLOUDFLARE_ACCOUNT_ID = { default = ${JSON.stringify(got.accountId)} }`,
    "",
  ].join("\n"), { mode: 0o600 })
  console.log(`Cloudflare token for this session, valid until ${got.expiresOn}. The worker commands use it from now on.`)
  if (got.sourceExpiresOn && Date.parse(got.sourceExpiresOn) < Date.now() + 14 * DAY)
    console.log(`! Tell the owner: the agents' Cloudflare token source expires on ${got.sourceExpiresOn}; \`npm run env:setup\` on their machine renews it.`)
}
