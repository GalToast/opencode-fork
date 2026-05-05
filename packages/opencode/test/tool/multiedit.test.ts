import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { MultiEditTool } from "../../src/tool/multiedit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { FileTime } from "../../src/file/time"
import { MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: "test-multiedit-session" as any,
  messageID: MessageID.make("message_test_multiedit"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.multiedit", () => {
  afterEach(() => {
    // No explicit mock cleanup needed here; tests only mutate file fixtures.
  })

  test("applies multiple edits to the same file in sequence", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.ts")
    await fs.writeFile(filepath, "const alpha = 1\nconst beta = alpha + 1\n", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)

        const multiedit = await MultiEditTool.init()
        const result = await multiedit.execute(
          {
            filePath: filepath,
            edits: [
              // @ts-ignore
              { oldString: "alpha", newString: "gamma", replaceAll: true },
              // @ts-ignore
              { oldString: "const beta = gamma + 1", newString: "const beta = gamma + 2" },
            ],
          },
          ctx,
        )

        expect(result.title).toEndWith("file.ts")
        expect(result.output).toContain("Edit applied successfully")
        expect((result.metadata as any).results).toHaveLength(2)
        expect(await fs.readFile(filepath, "utf-8")).toBe("const gamma = 1\nconst beta = gamma + 2\n")
      },
    })
  })

  test("rolls back all edits when a later replacement fails", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "atomic.txt")
    const original = "first line\nsecond line\n"
    await fs.writeFile(filepath, original, "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)

        const multiedit = await MultiEditTool.init()
        await expect(
          multiedit.execute(
            {
              filePath: filepath,
              edits: [
                // @ts-ignore
                { oldString: "first line", newString: "updated line" },
                // @ts-ignore
                { oldString: "missing line", newString: "should fail" },
              ],
            },
            ctx,
          ),
        ).rejects.toThrow()

        expect(await fs.readFile(filepath, "utf-8")).toBe(original)
      },
    })
  })
})
