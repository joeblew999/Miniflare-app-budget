// What the app keeps in this browser: per-user copies for offline use, and the budget saved by the
// earlier browser-only version (used once, to import into a new account).
import type { DraftBudget } from "@shared/budget"
import type { Budget } from "@shared/schema"

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

// ---- Offline: per-user copies kept in this browser ----

/** The budget as last seen on the server. Shown straight away, and when offline. */
export interface ServerCopy { budget: Budget; savedAt: string | null }
/** An edit made on this device that the server hasn't got yet. */
export interface Outbox { budget: Budget; editedAt: string }

const read = <T>(key: string): T | null => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null } catch { return null }
}
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full or blocked: still works online */ }
}
const remove = (key: string) => { try { localStorage.removeItem(key) } catch { /* ignore */ } }

export const serverCopy = {
  load: (userId: string) => read<ServerCopy>(`budget-copy:${userId}`),
  save: (userId: string, copy: ServerCopy) => write(`budget-copy:${userId}`, copy),
}
export const outbox = {
  load: (userId: string) => read<Outbox>(`budget-outbox:${userId}`),
  save: (userId: string, o: Outbox) => write(`budget-outbox:${userId}`, o),
  clear: (userId: string) => remove(`budget-outbox:${userId}`),
}

/** The signed-in user, so the app still opens offline when the session can't be checked. */
export interface KnownUser { id: string; label: string }
export const lastUser = {
  load: () => read<KnownUser>("last-user"),
  save: (u: KnownUser) => write("last-user", u),
}

/** Remove everything kept for a user (on sign-out). */
export function forgetUser(userId: string): void {
  remove("last-user")
  remove(`budget-copy:${userId}`)
  remove(`budget-outbox:${userId}`)
}
