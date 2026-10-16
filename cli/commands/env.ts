import type { Command } from "commander"
import { spawnSync } from "node:child_process"
import { cf, sleep } from "../lib/cloudflare.ts"
import { capture, fail, run } from "../lib/run.ts"

/** This machine's own fnox file (gitignored): it says which store holds each value, never the value itself. */
const LOCAL = "fnox.local.toml"

/**
 * This machine's everyday Cloudflare token, used by the worker commands and as the Workers Builds build token.
 * It must be a user token: the Workers Builds API rejects account tokens. Keep it to these permissions,
 * because every branch's build can reach the build token.
 */
const EVERYDAY = {
  permissions: ["Workers Scripts: Edit", "D1: Edit", "Workers Builds Configuration: Edit", "Account Settings: Read"],
  form: "https://dash.cloudflare.com/profile/api-tokens?" + new URLSearchParams({
    permissionGroupKeys: JSON.stringify([
      { key: "workers_scripts", type: "edit" }, { key: "d1", type: "edit" }, { key: "account_settings", type: "read" },
    ]),
    accountId: "*",
    zoneId: "all",
    name: "baht-dollar-budget (this Mac)",
  }),
}

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
    for (const p of EVERYDAY.permissions) console.log(`  - ${p}`)
    console.log(`  ${EVERYDAY.form}`)
    spawnSync("open", [EVERYDAY.form])
    token = await tokenFromClipboard()
    fnoxStore("CLOUDFLARE_API_TOKEN", "production", token, opts.provider)
    console.log("Cloudflare token: stored in fnox.")
  }

  const stored = fnoxGet("CLOUDFLARE_ACCOUNT_ID", "production")
  if (stored && !opts.account) console.log(`Cloudflare account: ${stored}`)
  else {
    let id = opts.account
    if (!id) {
      const accounts = await cf<{ id: string; name: string }[]>("GET", "/accounts", undefined, { token })
      if (accounts.length !== 1)
        fail(`Your token can see ${accounts.length} accounts. Run again with -- --account <id>:\n${accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n")}`)
      id = accounts[0].id
    }
    fnoxStore("CLOUDFLARE_ACCOUNT_ID", "production", id, opts.provider)
    console.log(`Cloudflare account: ${id}, stored in fnox.`)
  }
}
