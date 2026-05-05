import { describe, test, expect, mock, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { SnapshotRevertTool } from "../../src/tool/snapshot_revert"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test-snapshot-revert" as any,
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.snapshot_revert", () => {
  afterEach(() => {
    mock.restore()
  })

  test("creates a snapshot and reverts to it", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "test.txt")
    await fs.writeFile(filepath, "initial content", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sr = await SnapshotRevertTool.init()
        
        // 1. Snapshot
        await sr.execute(
          {
            action: "snapshot",
            filePath: filepath,
            snapshotName: "my_snap"
          },
          // @ts-ignore
          ctx,
        )

        // 2. Modify
        await fs.writeFile(filepath, "bad changes", "utf-8")
        expect(await fs.readFile(filepath, "utf-8")).toBe("bad changes")

        // 3. Revert
        await sr.execute(
          {
            action: "revert",
            filePath: filepath,
            snapshotName: "my_snap"
          },
          // @ts-ignore
          ctx,
        )

        // 4. Verify
        expect(await fs.readFile(filepath, "utf-8")).toBe("initial content")
      },
    })
  })

  test("lists all snapshots", async () => {
    await using tmp = await tmpdir()
    const file1 = path.join(tmp.path, "file1.txt")
    const file2 = path.join(tmp.path, "file2.txt")
    await fs.writeFile(file1, "content1", "utf-8")
    await fs.writeFile(file2, "content2", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sr = await SnapshotRevertTool.init()
        
        // Create two snapshots
        // @ts-ignore
        await sr.execute({ action: "snapshot", filePath: file1, snapshotName: "snap1" }, ctx)
        // @ts-ignore
        await sr.execute({ action: "snapshot", filePath: file2, snapshotName: "snap2" }, ctx)

        // List snapshots
        // @ts-ignore
        const result = await sr.execute({ action: "list" }, ctx)
        
        expect(result.metadata.action).toBe("list")
        expect(result.metadata.count).toBe(2)
        expect(result.output).toContain("snap1")
        expect(result.output).toContain("snap2")
      },
    })
  })

  test("cleanup removes old snapshots when maxAge is 0", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "test.txt")
    await fs.writeFile(filepath, "content", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sr = await SnapshotRevertTool.init()
        
        // Create a snapshot
        // @ts-ignore
        await sr.execute({ action: "snapshot", filePath: filepath, snapshotName: "old_snap" }, ctx)
        
        // Verify it exists
        // @ts-ignore
        let listResult = await sr.execute({ action: "list" }, ctx)
        expect(listResult.metadata.count).toBe(1)
        
        // Cleanup with maxAge=0 (should remove all)
        // @ts-ignore
        const cleanupResult = await sr.execute({ action: "cleanup", maxAge: 0 }, ctx)
        expect(cleanupResult.metadata.cleaned).toBe(1)
        
        // Verify it's gone
        // @ts-ignore
        listResult = await sr.execute({ action: "list" }, ctx)
        expect(listResult.metadata.count).toBe(0)
      },
    })
  })
})
