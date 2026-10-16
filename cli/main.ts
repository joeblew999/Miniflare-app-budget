// Project CLI: `node cli/main.ts <noun> <verb>`. Every package.json script calls this.
// Runs as TypeScript directly on Node 22+ (type stripping), no build step.
import { Command } from "commander"
import { logTiming } from "./run.ts"
import { register as app } from "./commands/app.ts"
import { register as db } from "./commands/db.ts"
import { register as env } from "./commands/env.ts"
import { register as test } from "./commands/test.ts"
import { register as theme } from "./commands/theme.ts"
import { register as ui } from "./commands/ui.ts"
import { register as worker } from "./commands/worker.ts"

const program = new Command("budget")
  .description("Baht & Dollar Budget project CLI (noun verb)")
  .showHelpAfterError()

for (const group of [app, worker, db, test, ui, theme, env]) group(program)

// Timings: Commander's preAction hook marks the start of every command; the total is printed
// on exit, so it also shows when a command fails part-way (many exit early via process.exit).
program.hook("preAction", (_root, action) => {
  const name = [action.parent?.name(), action.name()].filter((n) => n && n !== "budget").join(" ")
  const started = performance.now()
  process.on("exit", (code) => logTiming(`${name} ${code === 0 ? "done" : `failed (exit ${code})`}`, started))
})

await program.parseAsync()
