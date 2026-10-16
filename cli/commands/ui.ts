import type { Command } from "commander"
import { run } from "../lib/run.ts"

export function register(program: Command): void {
  const ui = program.command("ui").description("shadcn components in src/components/ui/")

  ui.command("add").description("Add shadcn components, e.g. ui add dialog sheet")
    .argument("<components...>", "component names")
    .action((components: string[]) => run("shadcn", ["add", ...components]))
}
