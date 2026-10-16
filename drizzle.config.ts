import { defineConfig } from "drizzle-kit"

// Generates SQL migrations from worker/db/schema.ts into migrations/ (npm run db:gen).
// Wrangler applies them to D1 (npm run db:migrate).
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  out: "./migrations",
})
