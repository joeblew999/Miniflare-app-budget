import { defineConfig } from "drizzle-kit"

// Generates SQL migrations from worker/db/schema.ts into migrations/ (npm run db:gen).
// Wrangler applies them to D1: locally by the db:migrate step (npm run app:dev), remotely by deploys.
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  out: "./migrations",
})
