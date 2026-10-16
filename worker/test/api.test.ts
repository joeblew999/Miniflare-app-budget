import { exports } from "cloudflare:workers"
import { START } from "@shared/budget"
import type { Budget } from "@shared/schema"
import { afterEach, describe, expect, it, vi } from "vitest"

const ORIGIN = "http://example.com"
const worker = exports.default

function call(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers)
  headers.set("origin", ORIGIN)
  if (cookie) headers.set("cookie", cookie)
  if (init.body) headers.set("content-type", "application/json")
  return worker.fetch(new Request(ORIGIN + path, { ...init, headers }))
}

/** Create an account and return its session cookie. */
async function signUp(email: string): Promise<string> {
  const res = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Test", email, password: "correct-horse-battery" }),
  })
  expect(res.status).toBe(200)
  const cookie = res.headers.get("set-cookie")
  expect(cookie).toBeTruthy()
  return cookie!.split(";")[0]
}

const myBudget: Budget = {
  rate: 24.5,
  period: "week",
  nextId: 10,
  tags: [{ id: "t1", name: "Apartment" }],
  income: [{ id: "i1", name: "Rent", amount: 500, cur: "AUD", freq: "week", tags: ["t1"] }],
  expense: [
    { id: "e1", name: "Body corporate", amount: 600, cur: "AUD", freq: "quarter", tags: ["t1"] },
    { id: "e2", name: "Food", amount: 500, cur: "THB", freq: "day", tags: [] },
  ],
}

describe("worker", () => {
  it("answers health checks", async () => {
    const res = await call("/api/health")
    expect(await res.json()).toEqual({ ok: true })
  })

  it("refuses budget calls without a session", async () => {
    const res = await call("/api/budget")
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" })
  })

  it("gives a new account the starting figures", async () => {
    const cookie = await signUp("new@example.com")
    const res = await call("/api/budget", {}, cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ budget: START, isNew: true, savedAt: null })
  })

  it("saves and loads a budget over REST, in order, with tags", async () => {
    const cookie = await signUp("saver@example.com")
    const put = await call("/api/budget", { method: "PUT", body: JSON.stringify(myBudget) }, cookie)
    expect(put.status).toBe(200)
    const got = await (await call("/api/budget", {}, cookie)).json()
    expect(got).toMatchObject({ budget: myBudget, isNew: false })
    expect(Date.parse((got as { savedAt: string }).savedAt)).toBeGreaterThan(Date.now() - 60_000)
  })

  it("keeps the latest edit when an older one arrives later (offline device)", async () => {
    const cookie = await signUp("two-devices@example.com")
    const put = (rate: number, editedAt: string) =>
      call("/api/budget", { method: "PUT", body: JSON.stringify({ ...myBudget, rate, editedAt }) }, cookie)
    const newer = await (await put(30, "2026-10-16T10:30:00.000Z")).json()
    expect(newer).toEqual({ savedAt: "2026-10-16T10:30:00.000Z", applied: true })
    const older = await (await put(20, "2026-10-16T10:00:00.000Z")).json()
    expect(older).toEqual({ savedAt: "2026-10-16T10:30:00.000Z", applied: false })
    const got = await (await call("/api/budget", {}, cookie)).json<{ budget: { rate: number }; savedAt: string }>()
    expect(got.budget.rate).toBe(30)
    expect(got.savedAt).toBe("2026-10-16T10:30:00.000Z")
  })

  describe("exchange rate", () => {
    afterEach(() => { vi.restoreAllMocks() })

    it("returns today's rate from the source", async () => {
      const source = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => // built inside the request, as Workers require
        Response.json({ amount: 1, base: "AUD", date: "2026-10-15", rates: { THB: 23.179 } }))
      const res = await call("/api/rate")
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ rate: 23.179, date: "2026-10-15" })
      expect(String(source.mock.calls[0][0])).toContain("base=AUD&symbols=THB")
    })

    it("says unavailable when the source fails", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => new Response("down", { status: 502 }))
      vi.spyOn(console, "error").mockImplementation(() => {})
      const res = await call("/api/rate")
      expect(res.status).toBe(503)
    })
  })

  it("keeps each person's budget separate", async () => {
    const a = await signUp("a@example.com")
    const b = await signUp("b@example.com")
    await call("/api/budget", { method: "PUT", body: JSON.stringify(myBudget) }, a)
    const theirs = await (await call("/api/budget", {}, b)).json<{ isNew: boolean }>()
    expect(theirs.isNew).toBe(true)
  })

  it("rejects an invalid budget", async () => {
    const cookie = await signUp("bad@example.com")
    const bad = { ...myBudget, income: [{ ...myBudget.income[0], amount: -5 }] }
    const res = await call("/api/budget", { method: "PUT", body: JSON.stringify(bad) }, cookie)
    expect(res.status).toBe(400)
  })

  it("serves the OpenAPI spec for the contract", async () => {
    const spec = await (await call("/api/spec.json")).json<{ paths: Record<string, object> }>()
    expect(Object.keys(spec.paths).sort()).toEqual(["/budget", "/config", "/me", "/rate"])
  })

  it("does not offer guest sign-in when GUEST_SIGN_IN is off", async () => {
    expect(await (await call("/api/config")).json()).toEqual({ guestSignIn: false })
    const res = await call("/api/auth/sign-in/anonymous", { method: "POST", body: "{}" })
    expect(res.status).toBe(404)
  })

  it("allows guest sign-in on localhost, with a working budget", async () => {
    const local = (path: string, init: RequestInit = {}, cookie?: string) => {
      const headers = new Headers(init.headers)
      headers.set("origin", "http://localhost")
      if (cookie) headers.set("cookie", cookie)
      if (init.body) headers.set("content-type", "application/json")
      return worker.fetch(new Request("http://localhost" + path, { ...init, headers }))
    }
    expect(await (await local("/api/config")).json()).toEqual({ guestSignIn: true })
    const res = await local("/api/auth/sign-in/anonymous", { method: "POST", body: "{}" })
    expect(res.status).toBe(200)
    const cookie = res.headers.get("set-cookie")!.split(";")[0]
    expect(await (await local("/api/me", {}, cookie)).json()).toMatchObject({ isGuest: true })
    const put = await local("/api/budget", { method: "PUT", body: JSON.stringify(myBudget) }, cookie)
    expect(put.status).toBe(200)
  })
})
