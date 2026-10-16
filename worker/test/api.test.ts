import { exports } from "cloudflare:workers"
import { START } from "@shared/budget"
import type { Budget } from "@shared/schema"
import { describe, expect, it } from "vitest"

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
    expect(await res.json()).toEqual({ budget: START, isNew: true })
  })

  it("saves and loads a budget over REST, in order, with tags", async () => {
    const cookie = await signUp("saver@example.com")
    const put = await call("/api/budget", { method: "PUT", body: JSON.stringify(myBudget) }, cookie)
    expect(put.status).toBe(200)
    const got = await (await call("/api/budget", {}, cookie)).json()
    expect(got).toEqual({ budget: myBudget, isNew: false })
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
    expect(Object.keys(spec.paths).sort()).toEqual(["/budget", "/config", "/me"])
  })

  it("does not offer guest sign-in on a normal host (production)", async () => {
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
