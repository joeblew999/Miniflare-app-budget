// Reads and writes one user's budget in D1.
import { START } from "@shared/budget"
import type { Budget, Line } from "@shared/schema"
import { asc, eq } from "drizzle-orm"
import type { DB } from "./db"
import { budgetSettings, line, lineTag, tag } from "./db/schema"

export async function loadBudget(db: DB, userId: string): Promise<{ budget: Budget; isNew: boolean; savedAt: string | null }> {
  const [settings, tags, lines, links] = await db.batch([
    db.select().from(budgetSettings).where(eq(budgetSettings.userId, userId)),
    db.select().from(tag).where(eq(tag.userId, userId)).orderBy(asc(tag.position)),
    db.select().from(line).where(eq(line.userId, userId)).orderBy(asc(line.position)),
    db.select().from(lineTag).where(eq(lineTag.userId, userId)),
  ])
  const s = settings[0]
  if (!s) return { budget: structuredClone(START), isNew: true, savedAt: null }

  const tagsByLine = new Map<string, string[]>()
  for (const l of links) tagsByLine.set(l.lineId, [...(tagsByLine.get(l.lineId) ?? []), l.tagId])
  const toLine = (r: typeof line.$inferSelect): Line => ({
    id: r.id, name: r.name, amount: r.amount, cur: r.currency, freq: r.freq, tags: tagsByLine.get(r.id) ?? [],
  })

  return {
    isNew: false,
    savedAt: s.updatedAt.toISOString(),
    budget: {
      rate: s.rate,
      period: s.period,
      nextId: s.nextId,
      tags: tags.map((t) => ({ id: t.id, name: t.name })),
      income: lines.filter((l) => l.kind === "income").map(toLine),
      expense: lines.filter((l) => l.kind === "expense").map(toLine),
    },
  }
}

/**
 * Replace the user's whole budget in one D1 batch (all-or-nothing), unless the saved one is newer.
 * `editedAt` is when the edit was made, so an edit queued offline doesn't overwrite a later save from another device.
 */
export async function saveBudget(db: DB, userId: string, b: Budget, editedAt?: string): Promise<{ savedAt: Date; applied: boolean }> {
  const savedAt = editedAt ? new Date(editedAt) : new Date()
  if (editedAt) {
    const [current] = await db.select({ updatedAt: budgetSettings.updatedAt }).from(budgetSettings).where(eq(budgetSettings.userId, userId))
    if (current && current.updatedAt > savedAt) return { savedAt: current.updatedAt, applied: false }
  }
  const tagIds = new Set(b.tags.map((t) => t.id))
  const lines = [
    ...b.income.map((l, i) => ({ ...l, kind: "income" as const, position: i })),
    ...b.expense.map((l, i) => ({ ...l, kind: "expense" as const, position: i })),
  ]
  // Drop links to tags that no longer exist, and duplicates
  const links = [...new Map(lines.flatMap((l) => l.tags.filter((t) => tagIds.has(t))
    .map((t) => [`${l.id}\u0000${t}`, { userId, lineId: l.id, tagId: t }] as const))).values()]

  const settingsRow = { userId, rate: b.rate, period: b.period, nextId: b.nextId, updatedAt: savedAt }
  await db.batch([
    db.insert(budgetSettings).values(settingsRow)
      .onConflictDoUpdate({ target: budgetSettings.userId, set: settingsRow }),
    db.delete(lineTag).where(eq(lineTag.userId, userId)),
    db.delete(line).where(eq(line.userId, userId)),
    db.delete(tag).where(eq(tag.userId, userId)),
    ...b.tags.map((t, i) => db.insert(tag).values({ userId, id: t.id, name: t.name, position: i })),
    ...lines.map((l) => db.insert(line).values({
      userId, id: l.id, kind: l.kind, name: l.name, amount: l.amount, currency: l.cur, freq: l.freq, position: l.position,
    })),
    ...links.map((l) => db.insert(lineTag).values(l)),
  ])
  return { savedAt, applied: true }
}
