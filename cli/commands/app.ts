import type { Command } from "commander"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { root, run } from "../run.ts"
import { migrateLocal } from "./db.ts"
import { smoke } from "../smoke.ts"

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

  app.command("artifact").description("Build the app and its Worker into one self-contained HTML file (dist/artifact/index.html) that runs with no server, for a Claude artifact")
    .action(artifact)

  app.command("smoke").description("Smoke-test a running copy of the app over HTTP (production: read-only; Previews and local: full guest round trip)")
    .option("--url <url>", "base URL of the app", "http://localhost:5173")
    .action(async (opts: { url: string }) => { if (!(await smoke(opts.url))) process.exit(1) })
}

export function check(): void {
  run("tsc", ["-b"])
}

export function build(): void {
  check()
  run("vite", ["build"])
}

/** Same app, same Worker, one HTML file: artifact/in-page-worker.ts answers /api/* inside the page. */
export function artifact(): void {
  check()
  run("vite", ["build", "--config", "vite.artifact.config.ts"])
  // Bundled libraries contain a literal U+FFFD inside template strings; write it as an escape so the file is clean text.
  const file = path.join(root, "dist/artifact/index.html")
  writeFileSync(file, readFileSync(file, "utf8").replaceAll("\uFFFD", "\\uFFFD"))
  console.log(`Built ${path.relative(root, file)}`)
}
