import type { Command } from "commander"
import { readFileSync, writeFileSync } from "node:fs"
import { parse as parseJsonc } from "jsonc-parser"
import path from "node:path"
import { root, run, tryRun } from "../run.ts"
import { smoke } from "../smoke.ts"
import { checkArtifact, checkOffline, hasBrowser } from "../browser-checks.ts"

/** Lets wrangler hand the secrets fnox put in the environment to the Worker in local dev. */
const workerEnv = { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" }

export function register(program: Command): void {
  const app = program.command("app").description("The whole app: React front end + Worker, built together by Vite")

  app.command("dev").description("Dev server with hot reload; the Worker runs in workerd (http://localhost:5173)")
    .action(() => run("vite", [], { secrets: true, env: workerEnv }))

  app.command("check").description("Type-check everything: app, worker, shared and cli")
    .action(check)

  app.command("build").description("Build the app and Worker to dist/")
    .action(() => run("vite", ["build"]))

  app.command("preview").description("Run the production build (dist/) in workerd (http://localhost:4173)")
    .action(() => run("vite", ["preview"], { secrets: true, env: workerEnv }))

  app.command("lint").description("Lint with oxlint")
    .action(() => run("oxlint"))

  app.command("setup").description("Set up this machine: install the VS Code extensions in .vscode/extensions.json and a browser for the checks (safe to re-run)")
    .action(setup)

  app.command("artifact").description("Build the app and its Worker into one HTML file that runs with no server (dist/artifact/index.html, for a Claude artifact), then check it in a browser with the network blocked")
    .option("--no-check", "build only, skip the browser check")
    .action(async (opts: { check: boolean }) => {
      const file = artifact()
      if (opts.check && !(await checkArtifact(file))) process.exit(1)
    })

  app.command("smoke").description("Smoke-test a running copy of the app over HTTP (production: read-only; Previews and local: full guest round trip)")
    .option("--url <url>", "base URL of the app", "http://localhost:5173")
    .option("--offline", "also check offline use in a browser: edit offline, reload, reconnect (Previews and app:preview only)")
    .action(async (opts: { url: string; offline?: boolean }) => {
      if (!(await smoke(opts.url))) process.exit(1)
      if (opts.offline && !(await checkOffline(opts.url))) process.exit(1)
    })
}

export function check(): void {
  run("tsc", ["-b"])
}

/** VS Code extensions from .vscode/extensions.json (the one list), and a browser for the Playwright checks. */
async function setup(): Promise<void> {
  const { recommendations = [] } = parseJsonc(readFileSync(path.join(root, ".vscode/extensions.json"), "utf8")) as { recommendations?: string[] }
  if (tryRun("code", ["--version"], { quiet: true })) {
    for (const id of recommendations) run("code", ["--install-extension", id])
  } else {
    console.log(`VS Code's \`code\` command isn't on your PATH, so extensions weren't installed: ${recommendations.join(", ")}.`)
    console.log("In VS Code: Command Palette > \"Shell Command: Install 'code' command in PATH\", then run this again.")
  }
  if (await hasBrowser()) console.log("A browser for the checks is already installed.")
  else run("playwright-core", ["install", "chromium"])
}

/** Same app, same Worker, one HTML file (vite.artifact.config.ts): API calls run the router in the page, via artifact/. */
export function artifact(): string {
  run("vite", ["build", "--config", "vite.artifact.config.ts"])
  // Bundled libraries contain a literal U+FFFD inside template strings; write it as an escape so the file is clean text.
  const file = path.join(root, "dist/artifact/index.html")
  // and drop the favicon link: an artifact can't load other files, so it would only be a failed request.
  const html = readFileSync(file, "utf8").replaceAll("\uFFFD", "\\uFFFD").replace(/\s*<link rel="icon"[^>]*>/, "")
  writeFileSync(file, html)
  console.log(`Built ${path.relative(root, file)}`)
  return file
}
