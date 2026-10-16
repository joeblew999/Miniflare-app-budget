import type { Command } from "commander"
import { run } from "../lib/run.ts"

export function register(program: Command): void {
  const env = program.command("env").description("Secrets and env vars (fnox)")

  env.command("list").description("List the secrets declared in fnox.toml")
    .action(() => run("fnox", ["list"]))

  env.command("check").description("Check every secret has a value in your store")
    .action(() => run("fnox", ["check"]))
}
