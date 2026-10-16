// The CLI's commands, built once here so main.ts can run them and docs.ts can describe them.
import { Command } from "commander"
import { logTiming } from "./run.ts"
import { register as app } from "./commands/app.ts"
import { register as db } from "./commands/db.ts"
import { register as docs } from "./commands/docs.ts"
import { register as env } from "./commands/env.ts"
import { register as test } from "./commands/test.ts"
import { register as theme } from "./commands/theme.ts"
import { register as ui } from "./commands/ui.ts"
import { register as worker } from "./commands/worker.ts"

export function createProgram(): Command {
  const program = new Command("budget")
    .description("Baht & Dollar Budget project CLI (noun verb)")
    .showHelpAfterError()

  for (const group of [app, worker, db, test, ui, theme, env, docs]) group(program)

  // Timings: Commander's preAction hook marks the start of every command; the total is printed
  // on exit, so it also shows when a command fails part-way (many exit early via process.exit).
  program.hook("preAction", (_root, action) => {
    const name = [action.parent?.name(), action.name()].filter((n) => n && n !== "budget").join(" ")
    const started = performance.now()
    process.on("exit", (code) => logTiming(`${name} ${code === 0 ? "done" : `failed (exit ${code})`}`, started))
  })
  return program
}
