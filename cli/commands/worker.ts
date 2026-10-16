import type { Command } from "commander"
import { DEV_SECRET, capture, fail, run } from "../run.ts"
import { build } from "./app.ts"

const production = { profile: "production" }
const SECRETS = ["BETTER_AUTH_SECRET"] // must match "secrets.required" in wrangler.jsonc

export function register(program: Command): void {
  const worker = program.command("worker").description("The Cloudflare Worker (wrangler)")

  worker.command("types").description("Regenerate worker-configuration.d.ts from wrangler.jsonc")
    .action(() => run("wrangler", ["types"]))

  worker.command("secrets").description("Push the Worker's secrets from your fnox production profile to Cloudflare")
    .action(pushSecrets)

  worker.command("deploy").description("Build, migrate the remote database, push secrets and deploy")
    .action(() => {
      build()
      run("wrangler", ["d1", "migrations", "apply", "DB", "--remote"], { secrets: production })
      pushSecrets()
      run("wrangler", ["deploy"], { secrets: production })
    })
}

function pushSecrets(): void {
  for (const name of SECRETS) {
    const value = capture("fnox", ["get", name, "--profile", production.profile]).trim()
    if (!value || value === DEV_SECRET)
      fail(`${name} in your fnox "production" profile is missing or still the dev default. Set a real value first.`)
    run("wrangler", ["secret", "put", name], { secrets: production, input: value })
  }
}
