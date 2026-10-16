// Checks the artifact build (dist/artifact/index.html) the way a Claude artifact runs it: in a real browser,
// with every network request blocked. Signs in as a guest, changes the exchange rate, waits for the save,
// reloads, and expects the new value back. Any page error or blocked request fails the check.
import { readFileSync } from "node:fs"
import { chromium, type Browser } from "playwright-core"

const PAGE = "https://artifact.check/"

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch() // Playwright's own Chromium (PLAYWRIGHT_BROWSERS_PATH, or `npx playwright-core install chromium`)
  } catch {
    try {
      return await chromium.launch({ channel: "chrome" }) // fall back to installed Google Chrome
    } catch {
      throw new Error("No browser found. Run `npx playwright-core install chromium` once, or install Google Chrome.")
    }
  }
}

interface Step { name: string; ok: boolean; detail: string }

export async function checkArtifact(file: string): Promise<boolean> {
  const html = readFileSync(file, "utf8")
  const steps: Step[] = []
  const problems: string[] = []
  const browser = await launch()
  try {
    const page = await browser.newPage()
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`))
    await page.route("**/*", (route) => {
      const url = route.request().url()
      if (url === PAGE) return route.fulfill({ body: html, contentType: "text/html; charset=utf-8" })
      problems.push(`network request (would be blocked in an artifact): ${url}`)
      return route.abort()
    })

    const step = async (name: string, fn: () => Promise<string>) => {
      if (steps.some((s) => !s.ok)) return // stop after the first failure
      try { steps.push({ name, ok: true, detail: await fn() }) }
      catch (e) { steps.push({ name, ok: false, detail: e instanceof Error ? e.message.split("\n")[0] : String(e) }) }
    }
    const rate = page.locator("#rate")
    const value = String(10 + Math.floor(Math.random() * 90))

    await step("page loads with no server", async () => {
      await page.goto(PAGE)
      await page.getByText("Continue as guest").waitFor({ timeout: 15_000 })
      return "sign-in screen shown"
    })
    await step("guest sign-in", async () => {
      await page.getByText("Continue as guest").click()
      await rate.waitFor({ timeout: 15_000 })
      return "budget shown"
    })
    await step("edit and save", async () => {
      await rate.fill(value)
      await page.getByText("Saved", { exact: true }).waitFor({ timeout: 15_000 })
      return `exchange rate set to ${value}`
    })
    await step("reload keeps the data", async () => {
      await page.reload()
      await rate.waitFor({ timeout: 15_000 })
      const got = await rate.inputValue()
      if (got !== value) throw new Error(`expected ${value}, got ${got}`)
      return `still signed in, rate ${got}`
    })
  } finally {
    await browser.close()
  }

  console.log(`Artifact check: ${file}`)
  for (const s of steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}: ${s.detail}`)
  for (const p of problems) console.log(`  ✗ ${p}`)
  const ok = steps.length === 4 && steps.every((s) => s.ok) && problems.length === 0
  console.log(ok ? "Artifact works with no network." : "Artifact check failed.")
  return ok
}
