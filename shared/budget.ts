// Budget domain: data model and currency maths. Shared by the React app and the Worker.

export type Currency = "THB" | "AUD"
export type Freq = "day" | "week" | "month" | "quarter" | "year"
export type Period = "week" | "month" | "year"
export type Kind = "income" | "expense"

export interface Tag {
  id: string
  name: string
}

export interface Line {
  id: string
  name: string
  amount: string | number
  cur: Currency
  freq: Freq
  tags: string[]
}

export interface Budget {
  rate: number // THB per 1 AUD
  period: Period
  nextId: number
  tags: Tag[]
  income: Line[]
  expense: Line[]
}

export const FREQ_LABEL: Record<Freq, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  quarter: "Quarterly",
  year: "Yearly",
}

// How many of each frequency fit in one month (365 days, 52 weeks, 4 quarters a year)
export const PER_MONTH: Record<Freq, number> = {
  day: 365 / 12,
  week: 52 / 12,
  month: 1,
  quarter: 1 / 3,
  year: 1 / 12,
}

export const FROM_MONTH: Record<Period, number> = { week: 12 / 52, month: 1, year: 12 }
export const PERIOD_WORD: Record<Period, string> = { week: "a week", month: "a month", year: "a year" }

export const START: Budget = {
  rate: 23.3,
  period: "month",
  nextId: 100,
  tags: [
    { id: "t1", name: "Apartment" },
    { id: "t2", name: "Living" },
    { id: "t3", name: "Bills" },
  ],
  income: [{ id: "i1", name: "Apartment rent", amount: 500, cur: "AUD", freq: "week", tags: ["t1"] }],
  expense: [
    { id: "e1", name: "Body corporate (apartment)", amount: 600, cur: "AUD", freq: "quarter", tags: ["t1", "t3"] },
    { id: "e2", name: "Food", amount: 500, cur: "THB", freq: "day", tags: ["t2"] },
    { id: "e3", name: "Electricity & water (example)", amount: 2500, cur: "THB", freq: "month", tags: ["t2", "t3"] },
    { id: "e4", name: "Phone & internet (example)", amount: 1200, cur: "THB", freq: "month", tags: ["t3"] },
    { id: "e5", name: "Fuel & transport (example)", amount: 3000, cur: "THB", freq: "month", tags: ["t2"] },
    { id: "e6", name: "Health insurance (example)", amount: 45000, cur: "THB", freq: "year", tags: ["t3"] },
  ],
}

export function convert(v: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return v
  return from === "AUD" ? v * rate : v / (rate || 1)
}

/** A line's value per month, in baht. */
export function monthlyTHB(line: Line, rate: number): number {
  return convert((Number(line.amount) || 0) * PER_MONTH[line.freq], line.cur, "THB", rate)
}

export function fmt(v: number, cur: Currency): string {
  const sign = v < 0 ? "−" : ""
  const sym = cur === "THB" ? "฿" : "A$"
  return sign + sym + Math.abs(v).toLocaleString("en-AU", { maximumFractionDigits: 0 })
}
