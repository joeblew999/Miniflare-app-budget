// Zod schemas for the budget. The single source of truth for its shape:
// the oRPC contract validates with these, and the TypeScript types are inferred from them.
import * as z from "zod"

export const CurrencySchema = z.enum(["THB", "AUD"])
export const FreqSchema = z.enum(["day", "week", "month", "quarter", "year"])
export const PeriodSchema = z.enum(["week", "month", "year"])
export const KindSchema = z.enum(["income", "expense"])

const Id = z.string().min(1).max(64)

export const TagSchema = z.object({
  id: Id,
  name: z.string().max(100),
})

export const LineSchema = z.object({
  id: Id,
  name: z.string().max(200),
  amount: z.number().min(0),
  cur: CurrencySchema,
  freq: FreqSchema,
  tags: z.array(Id).max(50),
})

export const BudgetSchema = z.object({
  rate: z.number().min(0).describe("Thai baht per 1 Australian dollar"),
  period: PeriodSchema,
  nextId: z.number().int().min(0),
  tags: z.array(TagSchema).max(200),
  income: z.array(LineSchema).max(500),
  expense: z.array(LineSchema).max(500),
})

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
})

export type Currency = z.infer<typeof CurrencySchema>
export type Freq = z.infer<typeof FreqSchema>
export type Period = z.infer<typeof PeriodSchema>
export type Kind = z.infer<typeof KindSchema>
export type Tag = z.infer<typeof TagSchema>
export type Line = z.infer<typeof LineSchema>
export type Budget = z.infer<typeof BudgetSchema>
export type User = z.infer<typeof UserSchema>
