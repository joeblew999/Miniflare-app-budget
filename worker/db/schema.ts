// D1 tables (Drizzle). Change this file, then `npm run db:gen` to write a migration.
import { sql } from "drizzle-orm"
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

const now = sql`(unixepoch() * 1000)`
const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
}

// ---- Better Auth core tables (fields as required by better-auth 1.7) ----

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  // Better Auth anonymous plugin: true for guest accounts
  isAnonymous: integer("is_anonymous", { mode: "boolean" }),
  ...timestamps,
})

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  ...timestamps,
}, (t) => [index("session_user_idx").on(t.userId)])

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps,
}, (t) => [index("account_user_idx").on(t.userId)])

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ...timestamps,
}, (t) => [index("verification_identifier_idx").on(t.identifier)])

// ---- Budget tables. Every row belongs to one user; ids are unique per user. ----

export const budgetSettings = sqliteTable("budget_settings", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  rate: real("rate").notNull(),
  period: text("period", { enum: ["week", "month", "year"] }).notNull(),
  nextId: integer("next_id").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
})

export const tag = sqliteTable("tag", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.id] })])

export const line = sqliteTable("line", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  kind: text("kind", { enum: ["income", "expense"] }).notNull(),
  name: text("name").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency", { enum: ["THB", "AUD"] }).notNull(),
  freq: text("freq", { enum: ["day", "week", "month", "quarter", "year"] }).notNull(),
  position: integer("position").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.id] })])

export const lineTag = sqliteTable("line_tag", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  lineId: text("line_id").notNull(),
  tagId: text("tag_id").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.lineId, t.tagId] })])
