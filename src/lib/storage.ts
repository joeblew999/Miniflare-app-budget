// Browser storage for the budget. Will be replaced by the Worker API (D1) later.
import { type Budget, START } from "@shared/budget"

const KEY = "baht-dollar-budget-v3"

export function load(): Budget {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as Budget
      if (Array.isArray(s.income) && Array.isArray(s.expense) && Array.isArray(s.tags)) return s
    }
  } catch {
    /* storage unavailable: fall through to starting figures */
  }
  return structuredClone(START)
}

export function save(b: Budget): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b))
  } catch {
    /* ignore */
  }
}
