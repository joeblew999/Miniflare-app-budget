// Implements shared/contract.ts. Handlers get the D1 client and, behind requireUser, the signed-in user.
import { contract } from "@shared/contract"
import { implement } from "@orpc/server"
import type { Auth } from "./auth"
import { loadBudget, saveBudget } from "./budget-store"
import type { DB } from "./db"

export interface Context {
  headers: Headers
  db: DB
  auth: Auth
}

const base = implement(contract).$context<Context>()

/** Resolve the session from the request cookies; fail with the contract's UNAUTHORIZED error. */
const requireUser = base.middleware(async ({ context, next, errors }) => {
  const session = await context.auth.api.getSession({ headers: context.headers })
  if (!session) throw errors.UNAUTHORIZED()
  return next({ context: { user: session.user } })
})

const authed = base.use(requireUser)

export const router = base.router({
  me: {
    get: authed.me.get.handler(({ context }) => ({
      id: context.user.id,
      email: context.user.email,
      name: context.user.name,
    })),
  },
  budget: {
    get: authed.budget.get.handler(({ context }) => loadBudget(context.db, context.user.id)),
    save: authed.budget.save.handler(async ({ context, input }) => ({
      savedAt: (await saveBudget(context.db, context.user.id, input)).toISOString(),
    })),
  },
})

export type Router = typeof router
