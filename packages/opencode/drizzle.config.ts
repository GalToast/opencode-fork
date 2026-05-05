import { defineConfig } from "drizzle-kit"
import { getDatabasePath } from "./src/storage/db-path"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: getDatabasePath(),
  },
})
