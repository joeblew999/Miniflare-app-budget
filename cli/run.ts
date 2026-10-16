// Helpers for running the tools the CLI wraps.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Repo root (the folder above cli/). */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** The BETTER_AUTH_SECRET default in fnox.toml. Never allowed to reach Cloudflare. */
export const DEV_SECRET = "local-dev-only-secret-do-not-deploy-0000"

/** Print how long something took, to stderr. Set BUDGET_TIMINGS=0 to turn timings off. */
export function logTiming(label: string, startedAt: number): void {
  if (process.env.BUDGET_TIMINGS === "0") return
  const s = (performance.now() - startedAt) / 1000
  console.error(`⏱  ${label} ${s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`}`)
}

interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  /** Run through `fnox exec` so the command sees the project's secrets. */
  secrets?: boolean | { profile: string }
  input?: string
}

/** Resolve a tool: a local node_modules/.bin entry if there is one, otherwise PATH (e.g. fnox from mise). */
function bin(name: string): string {
  const local = path.join(root, "node_modules", ".bin", name)
  return existsSync(local) ? local : name
}

function command(name: string, args: string[], opts: RunOptions): [string, string[]] {
  if (!opts.secrets) return [bin(name), args]
  const profile = typeof opts.secrets === "object" ? ["--profile", opts.secrets.profile] : []
  return ["fnox", ["exec", ...profile, "--", bin(name), ...args]]
}

/** Run a tool with inherited stdio. Exits the CLI with the tool's code if it fails. */
export function run(name: string, args: string[] = [], opts: RunOptions = {}): void {
  const [cmd, argv] = command(name, args, opts)
  const started = performance.now()
  const res = spawnSync(cmd, argv, {
    cwd: opts.cwd ?? root,
    stdio: opts.input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input: opts.input,
    env: { ...process.env, ...opts.env },
  })
  logTiming(`  ${name}${args[0] && !args[0].startsWith("-") ? ` ${args[0]}` : ""}`, started)
  if (res.error) {
    console.error(`Could not run ${cmd}: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) process.exit(res.status ?? 1)
}

/** Run a tool with inherited stdio and report whether it succeeded, without exiting. */
export function tryRun(name: string, args: string[] = [], opts: RunOptions = {}): boolean {
  const [cmd, argv] = command(name, args, opts)
  const started = performance.now()
  const res = spawnSync(cmd, argv, { cwd: opts.cwd ?? root, stdio: "inherit", env: { ...process.env, ...opts.env } })
  logTiming(`  ${name}${args[0] && !args[0].startsWith("-") ? ` ${args[0]}` : ""}`, started)
  return res.status === 0
}

/** Run a tool and return its stdout. Throws if it fails. */
export function capture(name: string, args: string[] = [], opts: RunOptions = {}): string {
  const [cmd, argv] = command(name, args, opts)
  const res = spawnSync(cmd, argv, { cwd: opts.cwd ?? root, encoding: "utf8", env: { ...process.env, ...opts.env } })
  if (res.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} failed:\n${res.stderr || res.stdout}`)
  return res.stdout
}

/** Exit with a message. */
export function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
