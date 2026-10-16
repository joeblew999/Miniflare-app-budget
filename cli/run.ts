// Helpers for running the tools the CLI wraps.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Repo root (the folder above cli/). */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Resolve a tool: a local node_modules/.bin entry if there is one, otherwise PATH (e.g. fnox from mise). */
function bin(name: string): string {
  const local = path.join(root, "node_modules", ".bin", name)
  return existsSync(local) ? local : name
}

/** Run a tool with inherited stdio. Exits the CLI with the tool's code if it fails. */
export function run(name: string, args: string[] = [], opts: { cwd?: string } = {}): void {
  const res = spawnSync(bin(name), args, { cwd: opts.cwd ?? root, stdio: "inherit" })
  if (res.error) {
    console.error(`Could not run ${name}: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) process.exit(res.status ?? 1)
}

/** Run a tool and return its stdout. Throws if it fails. */
export function capture(name: string, args: string[] = [], opts: { cwd?: string } = {}): string {
  const res = spawnSync(bin(name), args, { cwd: opts.cwd ?? root, encoding: "utf8" })
  if (res.status !== 0) throw new Error(`${name} ${args.join(" ")} failed:\n${res.stderr || res.stdout}`)
  return res.stdout
}
