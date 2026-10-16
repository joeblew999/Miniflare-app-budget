// The API contract: the single definition both sides build from.
// The Worker implements it (worker/router.ts); the React app calls it (src/lib/api.ts).
// Every procedure is also exposed as REST via its openapi() route, documented at /api/docs.
import { oc } from "@orpc/contract"
import { openapi } from "@orpc/openapi"
import * as z from "zod"
import { BudgetSchema, UserSchema } from "./schema"

/** Procedures that need a signed-in user. */
const authed = oc.errors({
  UNAUTHORIZED: { message: "Sign in to use your budget" },
})

export const contract = {
  me: {
    get: authed
      .meta(openapi({ method: "GET", path: "/me", tags: ["Account"], summary: "The signed-in user" }))
      .output(UserSchema),
  },
  budget: {
    get: authed
      .meta(openapi({ method: "GET", path: "/budget", tags: ["Budget"], summary: "Get your budget" }))
      .output(z.object({
        budget: BudgetSchema,
        isNew: z.boolean().describe("True when no budget was saved yet and starting figures were returned"),
      })),
    save: authed
      .meta(openapi({ method: "PUT", path: "/budget", tags: ["Budget"], summary: "Replace your budget" }))
      .input(BudgetSchema)
      .output(z.object({ savedAt: z.string().describe("ISO timestamp") })),
  },
}

export type Contract = typeof contract
