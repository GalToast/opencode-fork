import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Snapshot } from "../../src/snapshot"
import { tmpdir } from "../fixture/fixture"

test("disabled snapshots purge the project snapshot store and stop tracking", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      snapshot: false,
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const snapshotDir = path.join(Global.Path.data, "snapshot", Instance.project.id)
      await fs.mkdir(snapshotDir, { recursive: true })
      await Bun.write(path.join(snapshotDir, "stale-object"), "old snapshot data")

      const tracked = await Snapshot.track()
      expect(tracked).toBeUndefined()

      const exists = await fs
        .stat(snapshotDir)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)
    },
  })
})
