// Keeps the docs in step with the commands, so they can't drift apart:
//   - docs/commands.md, the one list of commands, is generated from package.json (goals, Wireit
//     dependencies) and the CLI's own descriptions. README.md links to it; CLAUDE.md imports it.
//   - every command mentioned anywhere in the repo (as an npm script, a `npm run cli` call, or a noun:verb name in backticks) must exist.
// Runs as a step of app:verify.
import type { Command } from "commander"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { capture, fail, root } from "../lib/run.ts"
import { cliCommands, cliPath, readPackageJson } from "../program.ts"

export function register(program: Command): void {
  const docs = program.command("docs").description("The docs (README.md, CLAUDE.md)")
  docs.command("gen").description("Write docs/commands.md from package.json and the CLI, and fail on any mention of a command that doesn't exist")
    .action(gen)
}

/** How to pass a command's arguments and options after `--`. */
function argsOf(cmd?: Command): string {
  const list = [
    ...cmd?.registeredArguments.map((a) => (a.required ? `<${a.name()}${a.variadic ? "..." : ""}>` : `[${a.name()}]`)) ?? [],
    ...cmd?.options.map((o) => `[${o.flags.split(/,\s*/).pop()}]`) ?? [],
  ]
  return list.length ? ` -- ${list.join(" ")}` : ""
}

function gen(): void {
  const pkg = readPackageJson()
  const commands = cliCommands()
  const goals = Object.keys(pkg.scripts).filter((s) => s !== "cli")
  const steps = Object.keys(pkg.wireit).filter((s) => !(s in pkg.scripts))

  const describe = (name: string) => {
    const cmd = commands.get(cliPath(pkg.wireit[name]?.command) ?? "")
    if (cmd) return cmd.description()
    const deps = pkg.wireit[name]?.dependencies ?? []
    return deps.length ? `Runs ${deps.join(", ")}` : ""
  }
  const args = (name: string) => argsOf(commands.get(cliPath(pkg.wireit[name]?.command) ?? ""))
  const runsFirst = (name: string) => (pkg.wireit[name]?.dependencies ?? []).map((d) => `\`${d}\``).join(", ")

  const md = [
    "# Commands",
    "",
    "Generated from `package.json` and `cli/` by the `docs:gen` step of `npm run app:verify`. Don't edit this file:",
    "change a command's description in `cli/commands/<noun>.ts`, or its dependencies in `package.json` → `wireit`.",
    "",
    "## Goals",
    "",
    "Run with `npm run <goal>`. Wireit runs what each one needs first, in order, and skips anything already up to date.",
    "",
    "| Goal | Runs first | What it does |",
    "|---|---|---|",
    ...goals.map((g) => `| \`${g}${args(g)}\` | ${runsFirst(g)} | ${describe(g)} |`),
    "",
    "## Steps",
    "",
    "Only in the `wireit` section of `package.json`: they run as part of a goal.",
    "",
    ...steps.map((s) => `- \`${s}\`${runsFirst(s) ? ` (after ${runsFirst(s)})` : ""}: ${describe(s)}`),
    "",
    "Any goal or step also runs on its own, without what it depends on, with `npm run cli -- <noun> <verb>`.",
    "",
  ].join("\n")

  const file = path.join(root, "docs/commands.md")
  mkdirSync(path.dirname(file), { recursive: true })
  const before = existsSync(file) ? readFileSync(file, "utf8") : ""
  if (before !== md) { writeFileSync(file, md); console.log("Updated docs/commands.md") }
  checkReferences(new Set([...goals, ...steps]), new Set(Object.keys(pkg.scripts)), commands)
}

/** Fail if any tracked file mentions a command that doesn't exist. Plans are skipped: they describe commands not built yet. */
function checkReferences(known: Set<string>, scripts: Set<string>, commands: Map<string, Command>): void {
  const nouns = new Set([...commands.keys()].map((c) => c.split(" ")[0]))
  const files = capture("git", ["ls-files", "-co", "--exclude-standard"]).split("\n")
    .filter((f) => /\.(md|ts|tsx|css|html|json|jsonc|toml)$/.test(f) && !f.startsWith("plans/") && f !== "docs/commands.md" && f !== "package-lock.json" && !f.startsWith(".claude/"))
  const problems: string[] = []
  for (const file of files) {
    const text = readFileSync(path.join(root, file), "utf8")
    for (const [, name] of text.matchAll(/npm run ([a-z]+:[a-z]+)/g))
      if (!scripts.has(name)) problems.push(`${file}: \`npm run ${name}\` isn't a goal in package.json`)
    for (const [, noun, verb] of text.matchAll(/npm run cli -- ([a-z]+) ([a-z]+)/g))
      if (!commands.has(`${noun} ${verb}`)) problems.push(`${file}: \`npm run cli -- ${noun} ${verb}\` isn't a CLI command`)
    for (const [, noun, verb] of text.matchAll(/`([a-z]+):([a-z]+)`/g))
      if (nouns.has(noun) && !known.has(`${noun}:${verb}`)) problems.push(`${file}: \`${noun}:${verb}\` isn't a goal or step`)
  }
  if (problems.length) fail(`Docs mention commands that don't exist:\n  ${[...new Set(problems)].join("\n  ")}`)
}
