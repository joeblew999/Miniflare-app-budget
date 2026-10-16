import type { Command } from "commander"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { root, run } from "../run.ts"
import { migrateLocal } from "./db.ts"
import { smoke } from "../smoke.ts"
import { checkArtifact, checkOffline } from "../browser-checks.ts"

/** Lets wrangler hand the secrets fnox put in the environment to the Worker in local dev. */
const workerEnv = { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" }

export function register(program: Command): void {
  const app = program.command("app").description("The whole app: React front end + Worker, built together by Vite")

  app.command("dev").description("Dev server with hot reload; the Worker runs in workerd (http://localhost:5173)")
    .action(() => { migrateLocal(); run("vite", [], { secrets: true, env: workerEnv }) })

  app.command("check").description("Type-check everything: app, worker, shared and cli")
    .action(check)

  app.command("build").description("Type-check, then build the app and Worker to dist/")
    .action(build)

  app.command("preview").description("Build, then run the production build in workerd (http://localhost:4173)")
    .action(() => { build(); migrateLocal(); run("vite", ["preview"], { secrets: true, env: workerEnv }) })

  app.command("lint").description("Lint with oxlint")
    .action(() => run("oxlint"))

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

export function build(): void {
  check()
  run("vite", ["build"])
}

/** Same app, same Worker, one HTML file: artifact/in-page-worker.ts answers /api/* inside the page. */
export function artifact(): string {
  check()
  run("vite", ["build", "--config", "vite.artifact.config.ts"])
  // Bundled libraries contain a literal U+FFFD inside template strings; write it as an escape so the file is clean text.
  const file = path.join(root, "dist/artifact/index.html")
  // and drop the favicon link: an artifact can't load other files, so it would only be a failed request.
  const html = readFileSync(file, "utf8").replaceAll("\uFFFD", "\\uFFFD").replace(/\s*<link rel="icon"[^>]*>/, "")
  writeFileSync(file, html)
  console.log(`Built ${path.relative(root, file)}`)
  return file
}
