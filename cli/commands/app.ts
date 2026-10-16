import type { Command } from "commander"
import { run } from "../run.ts"
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
