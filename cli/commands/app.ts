import type { Command } from "commander"
import { readFileSync, writeFileSync } from "node:fs"
import { parse as parseJsonc } from "jsonc-parser"
import path from "node:path"
import { chromium, type Browser, type Page } from "playwright-core"
import { cliCommands, cliPath, readPackageJson } from "../program.ts"
import { fail, root, run, tryRun } from "../lib/run.ts"

/** Lets wrangler hand the secrets fnox put in the environment to the Worker in local dev. */
const workerEnv = { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" }

export function register(program: Command): void {
  const app = program.command("app").description("The whole app: React front end + Worker, built together by Vite")

  app.command("dev").description("Dev server with hot reload; the Worker runs in workerd (http://localhost:5173)")
    .action(() => run("vite", [], { secrets: true, env: workerEnv }))

  app.command("check").description("Type-check everything: app, worker, shared and cli")
    .action(check)

  app.command("build").description("Build the app and Worker to dist/")
    .action(() => run("vite", ["build"]))

  app.command("preview").description("Run the production build (dist/) in workerd (http://localhost:4173)")
    .action(() => run("vite", ["preview"], { secrets: true, env: workerEnv }))

  app.command("lint").description("Lint the code with oxlint, and check package.json lines up with the CLI (every command a goal or step, named after it, in the CLI's order)")
    .action(() => {
      run("oxlint")
      lintPackageJson()
    })

  app.command("setup").description("Set up this machine: install the VS Code extensions in .vscode/extensions.json and a browser for the checks (safe to re-run)")
    .action(setup)

  app.command("artifact").description("Build the app and its Worker into one HTML file that runs with no server (dist/artifact/index.html, for a Claude artifact), then check it in a browser with the network blocked")
    .option("--no-check", "build only, skip the browser check")
    .action(async (opts: { check: boolean }) => {
      const file = artifact()
      if (opts.check && !(await checkArtifact(file))) process.exit(1)
    })

  app.command("smoke").description("Smoke-test a running copy of the app over HTTP (production: read-only; Previews and local: full guest round trip)")
    .option("--url <url>", "base URL of the app", "http://localhost:5173")
    .option("--offline", "also check offline use in a browser: edit offline, reload, reconnect (Previews and app:preview only)")
    .action(async (opts: { url: string; offline?: boolean }) => {
      if (!(await smoke(opts.url))) process.exit(1)
      if (opts.offline && !(await checkOffline(opts.url))) process.exit(1)
    })
}

export function check(): void {
  run("tsc", ["-b"])
}

/**
 * package.json lines up with the CLI: every CLI command is a goal or a step, every script is a Wireit goal,
 * each wireit entry is named after the command it runs (`app:build` runs `node cli/main.ts app build`), and
 * `scripts` and `wireit` follow the CLI's order: nouns as registered in program.ts, verbs as declared in
 * cli/commands/<noun>.ts, and goals with no command of their own (they only run others) at the end of their noun.
 */
function lintPackageJson(): void {
  const pkg = readPackageJson()
  const cli = [...cliCommands().keys()]
  const problems: string[] = []

  const wired = new Set(Object.values(pkg.wireit).map((w) => cliPath(w.command)))
  for (const c of cli) if (!wired.has(c)) problems.push(`\`${c}\` isn't a goal or step: add "${c.replace(" ", ":")}" to wireit (and to scripts for a goal)`)
  for (const [name, value] of Object.entries(pkg.scripts))
    if (name !== "cli" && value !== "wireit") problems.push(`scripts "${name}" should be "wireit", with its command in the wireit section`)
  for (const [name, cfg] of Object.entries(pkg.wireit))
    if (cfg.command && cliPath(cfg.command)?.replace(" ", ":") !== name) problems.push(`wireit "${name}" runs \`${cfg.command}\`: name it after its command`)

  const nouns = [...new Set(cli.map((c) => c.split(" ")[0]))]
  const rank = (name: string) => {
    const at = cli.indexOf(name.replace(":", " "))
    return nouns.indexOf(name.split(":")[0]) * 1000 + (at >= 0 ? at : 999)
  }
  const inOrder = (names: string[]) => [...names].sort((a, b) => rank(a) - rank(b))
  const wireit = Object.keys(pkg.wireit)
  const scripts = Object.keys(pkg.scripts).filter((s) => s !== "cli")
  if (wireit.join() !== inOrder(wireit).join()) problems.push(`wireit order should be: ${inOrder(wireit).join(", ")}`)
  if (scripts.join() !== inOrder(scripts).join()) problems.push(`scripts order should be: ${inOrder(scripts).join(", ")}`)

  if (problems.length) fail(`package.json doesn't line up with the CLI:\n  ${problems.join("\n  ")}`)
  console.log(`package.json lines up with the CLI (${cli.length} commands).`)
}

/** VS Code extensions from .vscode/extensions.json (the one list), and a browser for the Playwright checks. */
async function setup(): Promise<void> {
  const { recommendations = [] } = parseJsonc(readFileSync(path.join(root, ".vscode/extensions.json"), "utf8")) as { recommendations?: string[] }
  if (tryRun("code", ["--version"], { quiet: true })) {
    for (const id of recommendations) run("code", ["--install-extension", id])
  } else {
    console.log(`VS Code's \`code\` command isn't on your PATH, so extensions weren't installed: ${recommendations.join(", ")}.`)
    console.log("In VS Code: Command Palette > \"Shell Command: Install 'code' command in PATH\", then run this again.")
  }
  if (await hasBrowser()) console.log("A browser for the checks is already installed.")
  else run("playwright-core", ["install", "chromium"])
}

/** Same app, same Worker, one HTML file (vite.artifact.config.ts): API calls run the router in the page, via artifact/. */
export function artifact(): string {
  run("vite", ["build", "--config", "vite.artifact.config.ts"])
  // Bundled libraries contain a literal U+FFFD inside template strings; write it as an escape so the file is clean text.
  const file = path.join(root, "dist/artifact/index.html")
  // and drop the favicon link: an artifact can't load other files, so it would only be a failed request.
  const html = readFileSync(file, "utf8").replaceAll("\uFFFD", "\\uFFFD").replace(/\s*<link rel="icon"[^>]*>/, "")
  writeFileSync(file, html)
  console.log(`Built ${path.relative(root, file)}`)
  return file
}

// Smoke test against any running copy of the app (local, a Preview, or production), over HTTP.
// Read-only checks everywhere. Where guest sign-in is on (Previews, local dev) it also does a full
// sign-in → save → load round trip as a throwaway guest, so production data is never written.

interface Check { name: string; ok: boolean; detail: string }

export async function smoke(baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, "")
  const checks: Check[] = []
  const check = async (name: string, fn: () => Promise<string>) => {
    try { checks.push({ name, ok: true, detail: await fn() }) }
    catch (e) { checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) }) }
  }
  const get = (path: string, init: RequestInit = {}) =>
    fetch(base + path, { ...init, headers: { origin: base, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } })
  const expect = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg) }

  console.log(`Smoke test: ${base}`)
  await check("app page loads", async () => {
    const res = await get("/")
    const html = await res.text()
    expect(res.ok && html.includes('<div id="root">'), `GET / returned ${res.status}`)
    return "200, React root present"
  })
  await check("deep links load the app", async () => {
    const res = await get("/some/deep/link")
    expect(res.ok && (await res.text()).includes('<div id="root">'), `returned ${res.status}`)
    return "200"
  })
  await check("API health", async () => {
    const body = await (await get("/api/health")).json() as { ok?: boolean }
    expect(body.ok === true, `got ${JSON.stringify(body)}`)
    return '{"ok":true}'
  })
  await check("budget needs sign-in", async () => {
    const res = await get("/api/budget")
    expect(res.status === 401, `expected 401, got ${res.status}`)
    return "401 UNAUTHORIZED"
  })
  await check("OpenAPI spec and docs", async () => {
    const spec = await (await get("/api/spec.json")).json() as { paths?: Record<string, unknown> }
    const docs = await get("/api/docs")
    expect(!!spec.paths?.["/budget"] && docs.ok, "spec or docs missing")
    return `${Object.keys(spec.paths ?? {}).length} paths, docs 200`
  })

  await check("exchange rate", async () => {
    const res = await get("/api/rate")
    const body = await res.json() as { rate?: number; date?: string }
    expect(res.ok && !!body.rate && body.rate > 0, `returned ${res.status} ${JSON.stringify(body)}`)
    return `฿${body.rate} per A$1 on ${body.date}`
  })

  let guest = false
  await check("deployment config", async () => {
    const cfg = await (await get("/api/config")).json() as { guestSignIn: boolean }
    guest = cfg.guestSignIn
    return `guest sign-in ${guest ? "on (Preview or local)" : "off (production)"}`
  })

  if (guest) {
    let cookie = ""
    await check("guest sign-in", async () => {
      const res = await get("/api/auth/sign-in/anonymous", { method: "POST", body: "{}" })
      expect(res.ok, `returned ${res.status}`)
      cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
      const me = await (await get("/api/me", { headers: { cookie } })).json() as { isGuest?: boolean }
      expect(me.isGuest === true, `me: ${JSON.stringify(me)}`)
      return "signed in as a throwaway guest"
    })
    await check("save and load a budget", async () => {
      const amount = 1000 + Math.floor(Math.random() * 9000)
      const budget = {
        rate: 23.3, period: "month", nextId: 10, tags: [{ id: "t1", name: "Smoke test" }],
        income: [{ id: "i1", name: "Smoke test income", amount, cur: "AUD", freq: "week", tags: ["t1"] }],
        expense: [{ id: "e1", name: "Smoke test expense", amount: 500, cur: "THB", freq: "day", tags: [] }],
      }
      const put = await get("/api/budget", { method: "PUT", body: JSON.stringify(budget), headers: { cookie } })
      expect(put.ok, `PUT returned ${put.status}`)
      const got = await (await get("/api/budget", { headers: { cookie } })).json() as { budget: { income: { amount: number }[] } }
      expect(got.budget.income[0].amount === amount, `saved ${amount}, read back ${got.budget.income[0].amount}`)
      return `saved and read back ${amount}`
    })
  } else {
    await check("guest sign-in is closed", async () => {
      const res = await get("/api/auth/sign-in/anonymous", { method: "POST", body: "{}" })
      expect(res.status === 404, `expected 404, got ${res.status}`)
      return "404, as it should be in production"
    })
  }

  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`)
  const failed = checks.filter((c) => !c.ok).length
  console.log(failed ? `${failed} check(s) failed.` : `All ${checks.length} checks passed.`)
  return failed === 0
}

// Checks that need a real browser (Playwright, headless):
//   checkArtifact: the artifact build (dist/artifact/index.html) the way a Claude artifact runs it, with every
//     network request blocked. Guest sign-in, edit, save, reload, and the data is still there.
//   checkOffline: a running copy of the app (local preview or a Preview) going offline. Edit while offline,
//     reload with no connection (the app must still open, signed in, with the edit), reconnect, and the server has it;
//     then an offline edit loses to a later save from another device.
// Only for copies where guest sign-in is on, so production data is never touched.

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch() // Playwright's own Chromium (PLAYWRIGHT_BROWSERS_PATH, or `npm run app:setup`)
  } catch {
    try {
      return await chromium.launch({ channel: "chrome" }) // fall back to installed Google Chrome
    } catch {
      throw new Error("No browser found. Run `npm run app:setup` once, or install Google Chrome.")
    }
  }
}

/** Is there a browser the checks can use? */
export async function hasBrowser(): Promise<boolean> {
  try { await (await launch()).close(); return true } catch { return false }
}

interface Step { name: string; ok: boolean; detail: string }

/** Runs named steps in order, stopping at the first failure, and prints the results. */
function stepper(title: string) {
  const steps: Step[] = []
  const problems: string[] = []
  return {
    problems,
    async step(name: string, fn: () => Promise<string>) {
      if (steps.some((s) => !s.ok)) return
      try { steps.push({ name, ok: true, detail: await fn() }) }
      catch (e) { steps.push({ name, ok: false, detail: e instanceof Error ? e.message.split("\n")[0] : String(e) }) }
    },
    report(expected: number, success: string): boolean {
      console.log(title)
      for (const s of steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}: ${s.detail}`)
      for (const p of problems) console.log(`  ✗ ${p}`)
      const ok = steps.length === expected && steps.every((s) => s.ok) && problems.length === 0
      console.log(ok ? success : "Check failed.")
      return ok
    },
  }
}

const TIMEOUT = { timeout: 15_000 }
const randomAmount = () => String(100 + Math.floor(Math.random() * 900))

async function signInAsGuest(page: Page): Promise<string> {
  await page.getByText("Continue as guest").click(TIMEOUT)
  await page.getByLabel("Amount").first().waitFor(TIMEOUT)
  return "budget shown"
}

const ARTIFACT_URL = "https://artifact.check/"

export async function checkArtifact(file: string): Promise<boolean> {
  const html = readFileSync(file, "utf8")
  const checks = stepper(`Artifact check: ${file}`)
  const browser = await launch()
  try {
    const page = await browser.newPage()
    page.on("pageerror", (e) => checks.problems.push(`page error: ${e.message}`))
    await page.route("**/*", (route) => {
      const url = route.request().url()
      if (url === ARTIFACT_URL) return route.fulfill({ body: html, contentType: "text/html; charset=utf-8" })
      checks.problems.push(`network request (would be blocked in an artifact): ${url}`)
      return route.abort()
    })
    // Edits go into the first income line's amount (the exchange rate is live, not edited).
    const amount = page.getByLabel("Amount").first()
    const value = randomAmount()

    await checks.step("page loads with no server", async () => {
      await page.goto(ARTIFACT_URL)
      await page.getByText("Continue as guest").waitFor(TIMEOUT)
      return "sign-in screen shown"
    })
    await checks.step("guest sign-in", () => signInAsGuest(page))
    await checks.step("edit and save", async () => {
      await amount.fill(value)
      await page.getByText("Saved", { exact: true }).waitFor(TIMEOUT)
      return `income amount set to ${value}`
    })
    await checks.step("reload keeps the data", async () => {
      await page.reload()
      await amount.waitFor(TIMEOUT)
      const got = await amount.inputValue()
      if (got !== value) throw new Error(`expected ${value}, got ${got}`)
      return `still signed in, amount ${got}`
    })
  } finally {
    await browser.close()
  }
  return checks.report(4, "Artifact works with no network.")
}

export async function checkOffline(baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, "")
  const checks = stepper(`Offline check: ${base}`)
  const browser = await launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    page.on("pageerror", (e) => checks.problems.push(`page error: ${e.message}`))
    // Edits go into the first income line's amount (the exchange rate is live, not edited).
    const amount = page.getByLabel("Amount").first()
    const value = randomAmount()

    await checks.step("app installs for offline use", async () => {
      await page.goto(base)
      // Runs in the page (as a string, since the CLI is typed for Node, not the DOM).
      const controlled = await page.evaluate(`(async () => {
        if (!("serviceWorker" in navigator)) return false
        await navigator.serviceWorker.ready
        if (!navigator.serviceWorker.controller)
          await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }))
        return true
      })()`)
      if (!controlled) throw new Error("no service worker (offline needs a build: app:preview or a deployed copy, not app:dev)")
      return "service worker in control"
    })
    await checks.step("guest sign-in", () => signInAsGuest(page))
    await checks.step("live exchange rate shown and kept", async () => {
      const live = await (await context.request.get(`${base}/api/rate`)).json() as { rate: number }
      await page.getByText(`฿${live.rate.toFixed(2)} per A$1`).waitFor(TIMEOUT)
      await page.getByText("Saved", { exact: true }).waitFor(TIMEOUT)
      const saved = await (await context.request.get(`${base}/api/budget`, { headers: { origin: base } })).json() as { budget: { rate: number } }
      if (saved.budget.rate !== live.rate) throw new Error(`budget keeps rate ${saved.budget.rate}, live is ${live.rate}`)
      return `฿${live.rate} shown, and kept with the budget for offline use`
    })
    await checks.step("edit while offline", async () => {
      await context.setOffline(true)
      await amount.fill(value)
      await page.getByText("Saved on this device", { exact: true }).waitFor(TIMEOUT)
      return `amount ${value}, kept on this device`
    })
    await checks.step("reload with no connection", async () => {
      await page.reload()
      await amount.waitFor(TIMEOUT)
      const got = await amount.inputValue()
      if (got !== value) throw new Error(`expected ${value}, got ${got}`)
      await page.getByText("Saved on this device", { exact: true }).waitFor(TIMEOUT)
      await page.getByText("Offline", { exact: true }).waitFor(TIMEOUT)
      return `app opened, still signed in, amount ${got}, marked offline`
    })
    await checks.step("reconnect and sync", async () => {
      await context.setOffline(false)
      await page.getByText("Saved", { exact: true }).waitFor(TIMEOUT)
      await page.getByText("Offline", { exact: true }).waitFor({ state: "hidden", ...TIMEOUT })
      const res = await context.request.get(`${base}/api/budget`, { headers: { origin: base } })
      const body = await res.json() as { budget?: { income: { amount: number }[] } }
      const saved = body.budget?.income[0]?.amount
      if (String(saved) !== value) throw new Error(`server has ${saved}, expected ${value}`)
      return `server has ${value}`
    })
    await checks.step("a newer save on another device wins", async () => {
      const mine = randomAmount()
      const theirs = String(Number(mine) + 1) // always different from mine
      await context.setOffline(true)
      await amount.fill(mine) // edited first, on this device, offline
      await page.getByText("Saved on this device", { exact: true }).waitFor(TIMEOUT)
      // Another device, same account, saves later while this one is still offline.
      const other = await browser.newContext({ storageState: await context.storageState() })
      const current = await (await other.request.get(`${base}/api/budget`, { headers: { origin: base } })).json() as { budget: { income: { amount: number }[] } }
      const put = await other.request.put(`${base}/api/budget`, {
        headers: { origin: base }, data: { ...current.budget, income: current.budget.income.map((l, i) => i ? l : { ...l, amount: Number(theirs) }), editedAt: new Date().toISOString() },
      })
      if (!put.ok()) throw new Error(`other device's save returned ${put.status()}`)
      await other.close()
      await context.setOffline(false)
      await page.waitForFunction(`document.querySelector('input[aria-label="Amount"]')?.value === ${JSON.stringify(theirs)}`, undefined, TIMEOUT)
      const body = await (await context.request.get(`${base}/api/budget`, { headers: { origin: base } })).json() as { budget?: { income: { amount: number }[] } }
      const saved = body.budget?.income[0]?.amount
      if (String(saved) !== theirs) throw new Error(`server has ${saved}, expected ${theirs}`)
      return `this device's older edit (${mine}) dropped, both show ${theirs}`
    })
  } finally {
    await browser.close()
  }
  return checks.report(7, "Works offline, syncs when back online, and the latest edit wins.")
}
