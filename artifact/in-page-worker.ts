// Runs the real Worker inside the page, for the artifact build (`npm run app:artifact`).
// A Claude artifact can't reach any server, so:
//   - D1 is SQLite in the page (sql.js), set up from the repo's migrations/ and kept in localStorage;
//   - API calls from the oRPC client go straight to the router (artifact/link.ts), with no HTTP;
//   - other /api/* fetches (Better Auth's client) are answered by worker/index.ts in the page,
//     with session cookies in a small jar, because a page can't set cookies on its own fetches.
// Nothing else changes: the React app, the contract, the router, Better Auth and the D1 queries are the real ones.
import initSqlJs from "sql.js"
import type { Database } from "sql.js"
import worker from "../worker/index"
import { d1 } from "./d1"

declare global {
  interface ImportMeta {
    glob<T>(pattern: string, opts: { query: string; import: string; eager: true }): Record<string, T>
  }
}

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }
const store: Store | undefined = (() => {
  try { return (globalThis as unknown as { localStorage?: Store }).localStorage } catch { return undefined }
})()
const load = (k: string) => { try { return store?.getItem(k) ?? null } catch { return null } }
const save = (k: string, v: string) => { try { store?.setItem(k, v) } catch { /* storage full or blocked: keep going in memory */ } }

const DB_KEY = "artifact-db"
const COOKIE_KEY = "artifact-cookies"
const SECRET_KEY = "artifact-auth-secret"

const migrations = import.meta.glob<string>("../migrations/*.sql", { query: "?raw", import: "default", eager: true })

const toBase64 = (b: Uint8Array) => { let s = ""; for (const c of b) s += String.fromCharCode(c); return btoa(s) }
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export const ready: Promise<{ db: Database; env: Env }> = (async () => {
  const SQL = await initSqlJs()
  const saved = load(DB_KEY)
  const db = saved ? new SQL.Database(fromBase64(saved)) : new SQL.Database()
  // Apply migrations in order, once each (same idea as wrangler's d1_migrations table).
  db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (name TEXT PRIMARY KEY)")
  for (const file of Object.keys(migrations).sort()) {
    const name = file.split("/").pop()!
    if (db.exec("SELECT 1 FROM d1_migrations WHERE name = ?", [name]).length) continue
    db.exec(migrations[file].replaceAll("--> statement-breakpoint", ""))
    db.run("INSERT INTO d1_migrations (name) VALUES (?)", [name])
  }
  let secret = load(SECRET_KEY)
  if (!secret) { secret = toBase64(crypto.getRandomValues(new Uint8Array(32))); save(SECRET_KEY, secret) }
  const env = { DB: d1(db), GUEST_SIGN_IN: "true", BETTER_AUTH_SECRET: secret } as unknown as Env
  return { db, env }
})()

// ---- Cookie jar ----
const jar = new Map<string, string>(Object.entries(JSON.parse(load(COOKIE_KEY) ?? "{}") as Record<string, string>))
function storeCookies(setCookies: string[]) {
  for (const line of setCookies) {
    const [pair, ...attrs] = line.split(";")
    const eq = pair.indexOf("=")
    const name = pair.slice(0, eq).trim(), value = pair.slice(eq + 1).trim()
    const expired = attrs.some((a) => {
      const [k, v = ""] = a.split("=").map((s) => s.trim().toLowerCase())
      return (k === "max-age" && Number(v) <= 0) || (k === "expires" && Date.parse(v) < Date.now())
    })
    if (expired || !value) jar.delete(name); else jar.set(name, value)
  }
  save(COOKIE_KEY, JSON.stringify(Object.fromEntries(jar)))
}

// A Response built by script drops Set-Cookie (a forbidden header), so record it from the init headers first.
const NativeResponse = globalThis.Response
const setCookies = new WeakMap<Response, string[]>()
class RecordingResponse extends NativeResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init)
    if (init?.headers) setCookies.set(this, new Headers(init.headers).getSetCookie())
  }
  static override [Symbol.hasInstance](x: unknown) { return x instanceof NativeResponse }
}
globalThis.Response = RecordingResponse

// A Request built by script drops Cookie and Origin too, so it carries its own headers.
class InPageRequest extends Request {
  #headers: Headers
  constructor(input: Request, headers: Headers) { super(input); this.#headers = headers }
  override get headers() { return this.#headers }
}

const nativeFetch = globalThis.fetch.bind(globalThis)
export const origin = (globalThis as unknown as { location: { origin: string } }).location.origin

/** Headers a same-origin request would carry: Origin plus the session cookies. */
export function requestHeaders(from?: Headers): Headers {
  const headers = new Headers(from)
  headers.set("origin", origin)
  if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "))
  return headers
}

/** Save the database to localStorage after a write. */
export async function persist(): Promise<void> {
  const { db } = await ready
  save(DB_KEY, toBase64(db.export()))
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) return nativeFetch(input, init)

  const { env } = await ready
  const response = await worker.fetch(new InPageRequest(request, requestHeaders(request.headers)) as Parameters<typeof worker.fetch>[0], env)
  storeCookies(setCookies.get(response) ?? [])
  if (request.method !== "GET") await persist()
  return response
}
