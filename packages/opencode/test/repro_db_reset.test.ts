import { test, expect, afterEach } from "bun:test"
import { Database } from "../src/storage/db"
import { ProjectTable } from "../src/storage/schema"
import { resetDatabase } from "./fixture/db"

afterEach(async () => {
  await resetDatabase()
})

test("test 1", async () => {
  const db = Database.Client()
  await db.insert(ProjectTable).values({
    id: "p1",
    name: "p1", 
    worktree: "/tmp/p1",
    sandboxes: [],
  }).run()
  const p = await db.select().from(ProjectTable).all()
  expect(p.length).toBe(1)
})

test("test 2", async () => {
  const db = Database.Client()
  await db.insert(ProjectTable).values({
    id: "p2",
    name: "p2", 
    worktree: "/tmp/p2",
    sandboxes: [],
  }).run()
  const p = await db.select().from(ProjectTable).all()
  expect(p.length).toBe(1)
})
