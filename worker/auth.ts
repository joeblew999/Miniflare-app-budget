// Better Auth on D1. Email + password sign-in; sessions in cookies under /api/auth/*.
// Guest sign-in (the anonymous plugin) is on where GUEST_SIGN_IN is "true" (wrangler.jsonc) and on localhost.
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { anonymous } from "better-auth/plugins"
import type { DB } from "./db"
import * as schema from "./db/schema"

/** Guest sign-in is allowed when the Worker's GUEST_SIGN_IN var is "true", or on localhost (local dev). */
export function guestSignInAllowed(env: Env, url: URL): boolean {
  return env.GUEST_SIGN_IN === "true" || url.hostname === "localhost" || url.hostname === "127.0.0.1"
}

export function createAuth(env: Env, db: DB, url: URL) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: url.origin,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    plugins: guestSignInAllowed(env, url) ? [anonymous({ emailDomainName: "guest.invalid" })] : [],
  })
}

export type Auth = ReturnType<typeof createAuth>
