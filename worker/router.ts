// Implements shared/contract.ts. Handlers get the D1 client and, behind requireUser, the signed-in user.
import { contract } from "@shared/contract"
import { ORPCError, implement } from "@orpc/server"
import type { Auth } from "./auth"
import { loadBudget, saveBudget } from "./budget-store"
import { fetchRate } from "./rate"
import type { DB } from "./db"

export interface Context {
  headers: Headers
  db: DB
  auth: Auth
  guestSignIn: boolean
}

const base = implement(contract).$context<Context>()

/** Resolve the session from the request cookies; fail with the contract's UNAUTHORIZED error
 *  (ORPCError is matched to the typed error of procedures that declare it). */
const requireUser = base.middleware(async ({ context, next }) => {
  const session = await context.auth.api.getSession({ headers: context.headers })
  if (!session) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to use your budget" })
  return next({ context: { user: session.user } })
})

const authed = base.use(requireUser)

export const router = base.router({
  config: {
    get: base.config.get.handler(({ context }) => ({ guestSignIn: context.guestSignIn })),
  },
  rate: {
    get: base.rate.get.handler(async ({ errors }) => {
      try {
        return await fetchRate()
      } catch (error) {
        console.error(error)
        throw errors.SERVICE_UNAVAILABLE()
      }
    }),
  },
  me: {
    get: authed.me.get.handler(({ context }) => ({
      id: context.user.id,
      email: context.user.email,
      name: context.user.name,
      isGuest: Boolean((context.user as { isAnonymous?: boolean | null }).isAnonymous),
    })),
  },
  budget: {
    get: authed.budget.get.handler(({ context }) => loadBudget(context.db, context.user.id)),
    save: authed.budget.save.handler(async ({ context, input: { editedAt, ...budget } }) => {
      const { savedAt, applied } = await saveBudget(context.db, context.user.id, budget, editedAt)
      return { savedAt: savedAt.toISOString(), applied }
    }),
  },
})

export type Router = typeof router
