// Builds the per-request context the router needs. Used by the Worker (worker/index.ts)
// and by the artifact build, which calls the router in the page (artifact/link.ts).
import { createAuth, guestSignInAllowed } from "./auth"
import { createDb } from "./db"
import type { Context } from "./router"

export function createContext(env: Env, url: URL, headers: Headers): Context {
  const db = createDb(env.DB)
  return { headers, db, auth: createAuth(env, db, url), guestSignIn: guestSignInAllowed(env, url) }
}
