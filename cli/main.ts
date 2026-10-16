// Project CLI: `node cli/main.ts <noun> <verb>`. Every package.json script calls this.
// Runs as TypeScript directly on Node 22+ (type stripping), no build step.
import { Command } from "commander"
import { register as app } from "./commands/app.ts"
import { register as env } from "./commands/env.ts"
import { register as theme } from "./commands/theme.ts"
import { register as ui } from "./commands/ui.ts"
import { register as worker } from "./commands/worker.ts"

const program = new Command("budget")
  .description("Baht & Dollar Budget project CLI (noun verb)")
  .showHelpAfterError()

for (const group of [app, worker, ui, theme, env]) group(program)

program.parse()
