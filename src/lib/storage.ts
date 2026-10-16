// Budgets saved by the earlier browser-only version. Used once, to import into a new account.
import type { DraftBudget } from "@shared/budget"

const KEY = "baht-dollar-budget-v3"

export function loadLocalBudget(): DraftBudget | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as DraftBudget
    return Array.isArray(s.income) && Array.isArray(s.expense) && Array.isArray(s.tags) ? s : null
  } catch {
    return null
  }
}

export function forgetLocalBudget(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
