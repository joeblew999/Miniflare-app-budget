import { describe, expect, it } from "vitest"
import { convert, monthlyTHB, toBudget } from "./budget"
import { START } from "./budget"

describe("budget maths", () => {
  it("converts between baht and dollars", () => {
    expect(convert(100, "AUD", "THB", 23.3)).toBeCloseTo(2330)
    expect(convert(2330, "THB", "AUD", 23.3)).toBeCloseTo(100)
  })

  it("turns any frequency into a monthly baht figure", () => {
    const line = { id: "x", name: "", cur: "AUD" as const, tags: [] }
    expect(monthlyTHB({ ...line, amount: 500, freq: "week" }, 23.3)).toBeCloseTo((500 * 52 / 12) * 23.3)
    expect(monthlyTHB({ ...line, amount: 600, freq: "quarter" }, 23.3)).toBeCloseTo(200 * 23.3)
    expect(monthlyTHB({ ...line, amount: "", freq: "month" }, 23.3)).toBe(0)
  })

  it("cleans a draft into a valid budget", () => {
    const draft = { ...START, income: [{ ...START.income[0], amount: "12.5" }], expense: [{ ...START.expense[0], amount: "" }] }
    const b = toBudget(draft)
    expect(b.income[0].amount).toBe(12.5)
    expect(b.expense[0].amount).toBe(0)
  })
})
