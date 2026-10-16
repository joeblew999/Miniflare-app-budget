import type { Command } from "commander"
import { spawnSync } from "node:child_process"
import { cf, CloudflareError, sleep } from "../lib/cloudflare.ts"
import { capture, fail, run } from "../lib/run.ts"

/** This machine's own fnox file (gitignored): it says which store holds each value, never the value itself. */
const LOCAL = "fnox.local.toml"

const TOKEN_NAME = "baht-dollar-budget (this Mac)"

/**
 * The permissions this machine's everyday Cloudflare token needs: the one list. env setup builds the pre-filled form
 * from it, names any that are missing, and checks each with a read call. When the app needs more, add a line here,
 * and every developer's next env setup asks for it.
 * It's a user token, because the Workers Builds API rejects account tokens. It also becomes the Workers Builds build
 * token, which every branch's build can reach, so keep it to what's needed.
 */
const PERMISSIONS: { name: string; formKey?: { key: string; type: "edit" | "read" }; probe: string }[] = [
  { name: "Workers Scripts: Edit", formKey: { key: "workers_scripts", type: "edit" }, probe: "/workers/scripts" },
  { name: "D1: Edit", formKey: { key: "d1", type: "edit" }, probe: "/d1/database" },
  { name: "Workers Builds Configuration: Edit", probe: "/builds/tokens" }, // no known form key yet: added by hand in the form
  { name: "Account Settings: Read", formKey: { key: "account_settings", type: "read" }, probe: "" },
]

const FORM = "https://dash.cloudflare.com/profile/api-tokens?" + new URLSearchParams({
  permissionGroupKeys: JSON.stringify(PERMISSIONS.flatMap((p) => (p.formKey ? [p.formKey] : []))),
  accountId: "*",
  zoneId: "all",
  name: TOKEN_NAME,
})

export function register(program: Command): void {
  const env = program.command("env").description("Secrets and env vars (fnox)")

  env.command("list").description("List the secrets declared in fnox.toml")
    .action(() => run("fnox", ["list"]))

  env.command("check").description("Check every secret has a value in your store")
    .action(() => run("fnox", ["check"]))

  env.command("setup").description("Give this machine its Cloudflare access in fnox, the everyday token and account id: opens a pre-filled Cloudflare form for anything missing and picks the token up from the clipboard (safe to re-run)")
    .option("--account <id>", "Cloudflare account id, if your token can see more than one account")
    .option("--provider <name>", "fnox provider to keep the values in", "keychain")
    .action((opts: { account?: string; provider: string }) => setup(opts).catch((e: unknown) => fail(e instanceof Error ? e.message : String(e))))
}

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

async function isActiveUserToken(token: string): Promise<boolean> {
  try {
    return (await cf<{ status: string }>("GET", "/user/tokens/verify", undefined, { token })).status === "active"
  } catch {
    return false
  }
}

/** Wait for a working token to be copied to the clipboard (macOS), then clear the clipboard. */
async function tokenFromClipboard(): Promise<string> {
  const paste = () => spawnSync("pbpaste", { encoding: "utf8" }).stdout?.trim() ?? ""
  if (spawnSync("pbpaste").error) fail(`No clipboard here. Store the token yourself: fnox set CLOUDFLARE_API_TOKEN --profile production -c ${LOCAL}`)
  const before = paste()
  console.log("Waiting for the token: press Create in the form, then Copy (up to 5 minutes)…")
  for (let i = 0; i < 300; i++) {
    await sleep(1000)
    const text = paste()
    if (text && text !== before && /^[\w-]{30,}$/.test(text) && (await isActiveUserToken(text))) {
      spawnSync("pbcopy", { input: "" })
      return text
    }
  }
  fail("No working token showed up on the clipboard. Run this again when you have one.")
}

async function setup(opts: { account?: string; provider: string }): Promise<void> {
  let token = fnoxGet("CLOUDFLARE_API_TOKEN", "production")
  if (token && !(await isActiveUserToken(token))) {
    console.log("The Cloudflare token in fnox doesn't work any more (expired, deleted, or not a user token). Making a new one.")
    token = undefined
  }
  if (token) console.log("Cloudflare token: in fnox, and working.")
  else {
    console.log("This machine needs a Cloudflare user token. Opening the form; check it has exactly these permissions:")
    for (const p of PERMISSIONS) console.log(`  - ${p.name}${p.formKey ? "" : " (add this one in the form)"}`)
    console.log(`  ${FORM}`)
    spawnSync("open", [FORM])
    token = await tokenFromClipboard()
    fnoxStore("CLOUDFLARE_API_TOKEN", "production", token, opts.provider)
    console.log("Cloudflare token: stored in fnox.")
  }

  let account = fnoxGet("CLOUDFLARE_ACCOUNT_ID", "production")
  if (account && !opts.account) console.log(`Cloudflare account: ${account}`)
  else {
    account = opts.account
    if (!account) {
      const accounts = await cf<{ id: string; name: string }[]>("GET", "/accounts", undefined, { token })
      if (accounts.length !== 1)
        fail(`Your token can see ${accounts.length} accounts. Run again with -- --account <id>:\n${accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n")}`)
      account = accounts[0].id
    }
    fnoxStore("CLOUDFLARE_ACCOUNT_ID", "production", account, opts.provider)
    console.log(`Cloudflare account: ${account}, stored in fnox.`)
  }

  await waitForPermissions(token, account)
}

/** Check the token has every permission; if not, say which to add in the dashboard and wait until it has (the token itself doesn't change). */
async function waitForPermissions(token: string, account: string): Promise<void> {
  const missing = async () => {
    const out: string[] = []
    for (const p of PERMISSIONS)
      await cf("GET", `/accounts/${account}${p.probe}`, undefined, { token }).catch((e: unknown) => {
        if (e instanceof CloudflareError && e.status === 403) out.push(p.name) // forbidden: the token lacks it
        else throw e // anything else (offline, Cloudflare down) is not a missing permission
      })
    return out
  }
  let gaps = await missing()
  if (!gaps.length) { console.log("Cloudflare token: has every permission it needs."); return }
  console.log(`The token is missing: ${gaps.join(", ")}.`)
  console.log(`In Cloudflare: My Profile > API Tokens > edit \"${TOKEN_NAME}\", add them and save. Waiting (up to 5 minutes)…`)
  for (let i = 0; i < 60 && gaps.length; i++) { await sleep(5000); gaps = await missing() }
  if (gaps.length) fail(`Still missing: ${gaps.join(", ")}. Add them to the token, then run this again.`)
  console.log("Cloudflare token: has every permission it needs.")
}
