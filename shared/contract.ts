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
  config: {
    get: oc
      .meta(openapi({ method: "GET", path: "/config", tags: ["App"], summary: "Public settings for this deployment" }))
      .output(z.object({
        guestSignIn: z.boolean().describe("Whether \"Continue as guest\" is offered (Previews and local dev only)"),
      })),
  },
  rate: {
    get: oc
      .errors({ SERVICE_UNAVAILABLE: { message: "The exchange rate can't be fetched right now" } })
      .meta(openapi({ method: "GET", path: "/rate", tags: ["App"], summary: "Today's exchange rate, Thai baht per Australian dollar" }))
      .output(z.object({
        rate: z.number().positive().describe("Thai baht per Australian dollar"),
        date: z.iso.date().describe("The working day the rate is for"),
        source: z.string(),
      })),
  },
  me: {
    get: authed
      .meta(openapi({ method: "GET", path: "/me", tags: ["Account"], summary: "The signed-in user" }))
      .output(UserSchema.extend({ isGuest: z.boolean() })),
  },
  budget: {
    get: authed
      .meta(openapi({ method: "GET", path: "/budget", tags: ["Budget"], summary: "Get your budget" }))
      .output(z.object({
        budget: BudgetSchema,
        isNew: z.boolean().describe("True when no budget was saved yet and starting figures were returned"),
        savedAt: z.string().nullable().describe("ISO timestamp of the last save, or null when there isn't one"),
      })),
    save: authed
      .meta(openapi({ method: "PUT", path: "/budget", tags: ["Budget"], summary: "Replace your budget" }))
      .input(BudgetSchema.extend({
        editedAt: z.iso.datetime().optional()
          .describe("When this edit was made (ISO). If the saved budget is newer, this edit is not applied. Defaults to now."),
      }))
      .output(z.object({
        savedAt: z.string().describe("ISO timestamp of the budget now saved"),
        applied: z.boolean().describe("False when a newer save was already there (e.g. from another device), so this edit was dropped"),
      })),
  },
}

export type Contract = typeof contract
