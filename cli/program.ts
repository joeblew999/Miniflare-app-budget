// The CLI's commands, built once here so main.ts can run them, plus how package.json maps to them
// (docs gen describes them from it; app lint checks the two line up).
import { Command } from "commander"
import { readFileSync } from "node:fs"
import path from "node:path"
import { logTiming, root } from "./lib/run.ts"
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

/** Every CLI command as "noun verb", in the CLI's order: nouns as registered above, verbs as declared in cli/commands/<noun>.ts. */
export function cliCommands(): Map<string, Command> {
  const all = new Map<string, Command>()
  for (const noun of createProgram().commands) for (const verb of noun.commands) all.set(`${noun.name()} ${verb.name()}`, verb)
  return all
}

/** package.json's goals (`scripts`) and what each goal or step runs (`wireit`). */
export interface PackageJson { scripts: Record<string, string>; wireit: Record<string, { command?: string; dependencies?: string[] }> }

export function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as PackageJson
}

/** The CLI command a goal or step runs ("app dev" for `node cli/main.ts app dev`), if any. */
export const cliPath = (command?: string) => command?.match(/^node cli\/main\.ts (\S+ \S+)/)?.[1]
