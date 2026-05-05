import { DatabaseSync } from "node:sqlite"
// @ts-expect-error node-sqlite adapter is only present in Node build dependency sets.
import { drizzle } from "drizzle-orm/node-sqlite"

export function init(path: string) {
  const sqlite = new DatabaseSync(path)
  const db = drizzle({ client: sqlite })
  return db
}
