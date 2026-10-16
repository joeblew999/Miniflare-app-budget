// Checks that need a real browser (Playwright, headless):
//   checkArtifact: the artifact build (dist/artifact/index.html) the way a Claude artifact runs it, with every
//     network request blocked. Guest sign-in, edit, save, reload, and the data is still there.
//   checkOffline: a running copy of the app (local preview or a Preview) going offline. Edit while offline,
//     reload with no connection (the app must still open, signed in, with the edit), reconnect, and the server has it;
//     then an offline edit loses to a later save from another device.
// Only for copies where guest sign-in is on, so production data is never touched.
import { readFileSync } from "node:fs"
import { chromium, type Browser, type Page } from "playwright-core"

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
  const run = stepper(`Artifact check: ${file}`)
  const browser = await launch()
  try {
    const page = await browser.newPage()
    page.on("pageerror", (e) => run.problems.push(`page error: ${e.message}`))
    await page.route("**/*", (route) => {
      const url = route.request().url()
      if (url === ARTIFACT_URL) return route.fulfill({ body: html, contentType: "text/html; charset=utf-8" })
      run.problems.push(`network request (would be blocked in an artifact): ${url}`)
      return route.abort()
    })
    // Edits go into the first income line's amount (the exchange rate is live, not edited).
    const amount = page.getByLabel("Amount").first()
    const value = randomAmount()

    await run.step("page loads with no server", async () => {
      await page.goto(ARTIFACT_URL)
      await page.getByText("Continue as guest").waitFor(TIMEOUT)
      return "sign-in screen shown"
    })
    await run.step("guest sign-in", () => signInAsGuest(page))
    await run.step("edit and save", async () => {
      await amount.fill(value)
      await page.getByText("Saved", { exact: true }).waitFor(TIMEOUT)
      return `income amount set to ${value}`
    })
    await run.step("reload keeps the data", async () => {
      await page.reload()
      await amount.waitFor(TIMEOUT)
      const got = await amount.inputValue()
      if (got !== value) throw new Error(`expected ${value}, got ${got}`)
      return `still signed in, amount ${got}`
    })
  } finally {
    await browser.close()
  }
  return run.report(4, "Artifact works with no network.")
}

export async function checkOffline(baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, "")
  const run = stepper(`Offline check: ${base}`)
  const browser = await launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    page.on("pageerror", (e) => run.problems.push(`page error: ${e.message}`))
    // Edits go into the first income line's amount (the exchange rate is live, not edited).
    const amount = page.getByLabel("Amount").first()
    const value = randomAmount()

    await run.step("app installs for offline use", async () => {
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
    await run.step("guest sign-in", () => signInAsGuest(page))
    await run.step("live exchange rate shown and kept", async () => {
      const live = await (await context.request.get(`${base}/api/rate`)).json() as { rate: number }
      await page.getByText(`฿${live.rate.toFixed(2)} per A$1`).waitFor(TIMEOUT)
      await page.getByText("Saved", { exact: true }).waitFor(TIMEOUT)
      const saved = await (await context.request.get(`${base}/api/budget`, { headers: { origin: base } })).json() as { budget: { rate: number } }
      if (saved.budget.rate !== live.rate) throw new Error(`budget keeps rate ${saved.budget.rate}, live is ${live.rate}`)
      return `฿${live.rate} shown, and kept with the budget for offline use`
    })
    await run.step("edit while offline", async () => {
      await context.setOffline(true)
      await amount.fill(value)
      await page.getByText("Saved on this device", { exact: true }).waitFor(TIMEOUT)
      return `amount ${value}, kept on this device`
    })
    await run.step("reload with no connection", async () => {
      await page.reload()
      await amount.waitFor(TIMEOUT)
      const got = await amount.inputValue()
      if (got !== value) throw new Error(`expected ${value}, got ${got}`)
      await page.getByText("Saved on this device", { exact: true }).waitFor(TIMEOUT)
      await page.getByText("Offline", { exact: true }).waitFor(TIMEOUT)
      return `app opened, still signed in, amount ${got}, marked offline`
    })
    await run.step("reconnect and sync", async () => {
      await context.setOffline(false)
      await page.getByText("Saved", { exact: true }).waitFor(TIMEOUT)
      await page.getByText("Offline", { exact: true }).waitFor({ state: "hidden", ...TIMEOUT })
      const res = await context.request.get(`${base}/api/budget`, { headers: { origin: base } })
      const body = await res.json() as { budget?: { income: { amount: number }[] } }
      const saved = body.budget?.income[0]?.amount
      if (String(saved) !== value) throw new Error(`server has ${saved}, expected ${value}`)
      return `server has ${value}`
    })
    await run.step("a newer save on another device wins", async () => {
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
  return run.report(7, "Works offline, syncs when back online, and the latest edit wins.")
}
