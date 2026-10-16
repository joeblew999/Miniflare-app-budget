// Better Auth on D1. Email + password sign-in; sessions in cookies under /api/auth/*.
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import type { DB } from "./db"
import * as schema from "./db/schema"

export function createAuth(env: Env, db: DB, origin: string) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origin,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
  })
}

export type Auth = ReturnType<typeof createAuth>
