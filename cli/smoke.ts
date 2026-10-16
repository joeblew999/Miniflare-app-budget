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
