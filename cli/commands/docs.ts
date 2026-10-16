// Keeps the docs in step with the commands, so they can't drift apart:
//   - the command tables in README.md and CLAUDE.md are generated from package.json (goals, Wireit
//     dependencies) and the CLI's own descriptions, between <!-- generated:… --> markers;
//   - every command mentioned anywhere in the repo (as an npm script, a `npm run cli` call, or a noun:verb name in backticks) must exist.
// Runs as a step of app:verify.
import type { Command } from "commander"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { capture, fail, root } from "../run.ts"
import { createProgram } from "../program.ts"

interface Pkg { scripts: Record<string, string>; wireit: Record<string, { command?: string; dependencies?: string[] }> }

export function register(program: Command): void {
  const docs = program.command("docs").description("The docs (README.md, CLAUDE.md)")
  docs.command("gen").description("Regenerate the command tables in the docs, and fail on any mention of a command that doesn't exist")
    .action(gen)
}

/** Every CLI command as "noun verb", with its Commander command. */
function cliCommands(): Map<string, Command> {
  const all = new Map<string, Command>()
  for (const noun of createProgram().commands) for (const verb of noun.commands) all.set(`${noun.name()} ${verb.name()}`, verb)
  return all
}

/** The CLI command a goal or step runs ("app dev" for `node cli/main.ts app dev`), if any. */
const cliPath = (command?: string) => command?.match(/^node cli\/main\.ts (\S+ \S+)/)?.[1]

function gen(): void {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as Pkg
  const commands = cliCommands()
  const goals = Object.keys(pkg.scripts).filter((s) => s !== "cli")
  const steps = Object.keys(pkg.wireit).filter((s) => !(s in pkg.scripts))

  const describe = (name: string) => {
    const cmd = commands.get(cliPath(pkg.wireit[name]?.command) ?? "")
    if (cmd) return cmd.description()
    const deps = pkg.wireit[name]?.dependencies ?? []
    return deps.length ? `Runs ${deps.join(", ")}` : ""
  }
  const args = (name: string) => {
    const cmd = commands.get(cliPath(pkg.wireit[name]?.command) ?? "")
    const list = [
      ...cmd?.registeredArguments.map((a) => (a.required ? `<${a.name()}${a.variadic ? "..." : ""}>` : `[${a.name()}]`)) ?? [],
      ...cmd?.options.map((o) => `[${o.flags.split(/,\s*/).pop()}]`) ?? [],
    ]
    return list.length ? ` -- ${list.join(" ")}` : ""
  }
  const runsFirst = (name: string) => (pkg.wireit[name]?.dependencies ?? []).map((d) => `\`${d}\``).join(", ")
  const used = new Set([...goals, ...steps].map((n) => cliPath(pkg.wireit[n]?.command)))
  const others = [...commands.keys()].filter((c) => !used.has(c))

  const claudeTable = [
    "| Goal | Runs first | What it does |",
    "|---|---|---|",
    ...goals.map((g) => `| \`${g}${args(g)}\` | ${runsFirst(g)} | ${describe(g)} |`),
    "",
    "**Steps** (only in the `wireit` section, run as part of a goal):",
    "",
    ...steps.map((s) => `- \`${s}\`${runsFirst(s) ? ` (after ${runsFirst(s)})` : ""}: ${describe(s)}`),
    "",
    "**Other commands**, run on their own with `npm run cli -- <noun> <verb>`:",
    "",
    ...others.map((c) => `- \`${c}\`: ${commands.get(c)!.description()}`),
  ].join("\n")

  const readme = [
    "```",
    ...goals.map((g) => `npm run ${g}${args(g)}`.padEnd(36) + ` # ${describe(g)}`),
    "```",
    "",
    "Single steps or other commands, without what they depend on: `npm run cli -- <noun> <verb>`,",
    `e.g. ${others.slice(0, 3).map((c) => `\`npm run cli -- ${c}\``).join(", ")}. \`npm run cli -- --help\` lists them all.`,
  ].join("\n")

  replaceBlock("CLAUDE.md", "goals", claudeTable)
  replaceBlock("README.md", "commands", readme)
  checkReferences(new Set([...goals, ...steps]), new Set(pkg.scripts ? Object.keys(pkg.scripts) : []), commands)
}

/** Replace the text between <!-- generated:NAME --> and <!-- /generated:NAME --> in a doc. */
function replaceBlock(file: string, name: string, body: string): void {
  const full = path.join(root, file)
  const text = readFileSync(full, "utf8")
  const start = `<!-- generated:${name} (npm run app:verify writes this; edit package.json or cli/ instead) -->`
  const end = `<!-- /generated:${name} -->`
  const re = new RegExp(`<!-- generated:${name}[^>]*-->[\\s\\S]*?${end.replace(/[/]/g, "\\/")}`)
  if (!re.test(text)) fail(`${file} has no generated:${name} block`)
  const next = text.replace(re, `${start}\n${body}\n${end}`)
  if (next !== text) { writeFileSync(full, next); console.log(`Updated the ${name} block in ${file}`) }
}

/** Fail if any tracked file mentions a command that doesn't exist. Plans are skipped: they describe commands not built yet. */
function checkReferences(known: Set<string>, scripts: Set<string>, commands: Map<string, Command>): void {
  const nouns = new Set([...commands.keys()].map((c) => c.split(" ")[0]))
  const files = capture("git", ["ls-files", "-co", "--exclude-standard"]).split("\n")
    .filter((f) => /\.(md|ts|tsx|css|html|json|jsonc|toml)$/.test(f) && !f.startsWith("plans/") && f !== "package-lock.json" && !f.startsWith(".claude/"))
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
