import { test, expect } from "bun:test"
import { Global } from "../src/global"
import { Database } from "../src/storage/db"
import path from "path"
import os from "os"

test("verify global paths", () => {
  console.log("XDG_DATA_HOME:", process.env.XDG_DATA_HOME)
  console.log("Global.Path.data:", Global.Path.data)
  console.log("Database.Path:", Database.Path)
  expect(Global.Path.data).toContain("opencode-test-data")
})
