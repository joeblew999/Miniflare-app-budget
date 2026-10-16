import type { Command } from "commander"
import { run } from "../run.ts"

export function register(program: Command): void {
  const app = program.command("app").description("The whole app: React front end + Worker, built together by Vite")

  app.command("dev").description("Dev server with hot reload; the Worker runs in workerd (http://localhost:5173)")
    .action(() => run("vite"))

  app.command("check").description("Type-check everything: app, worker, shared and cli")
    .action(check)

  app.command("build").description("Type-check, then build the app and Worker to dist/")
    .action(build)

  app.command("preview").description("Build, then run the production build in workerd (http://localhost:4173)")
    .action(() => { build(); run("vite", ["preview"]) })

  app.command("lint").description("Lint with oxlint")
    .action(() => run("oxlint"))
}

export function check(): void {
  run("tsc", ["-b"])
}

export function build(): void {
  check()
  run("vite", ["build"])
}
