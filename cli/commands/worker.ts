import type { Command } from "commander"
import { run } from "../run.ts"
import { build } from "./app.ts"

export function register(program: Command): void {
  const worker = program.command("worker").description("The Cloudflare Worker (wrangler)")

  worker.command("types").description("Regenerate worker-configuration.d.ts from wrangler.jsonc")
    .action(() => run("wrangler", ["types"]))

  worker.command("deploy").description("Build and deploy to Cloudflare (secrets from fnox)")
    .action(() => { build(); run("fnox", ["exec", "--", "wrangler", "deploy"]) })
}
