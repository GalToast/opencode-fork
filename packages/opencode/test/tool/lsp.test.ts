import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { LspTool } from "../../src/tool/lsp"
import { LSP } from "../../src/lsp"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("tool.lsp", () => {
  afterEach(() => {
    mock.restore()
  })

  test("requests lsp permission and returns JSON results", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "example.ts")
    await fs.writeFile(file, "export const answer = 42\n", "utf-8")

    const ask = spyOn({ ask: async () => {} }, "ask").mockResolvedValue(undefined)
    spyOn(LSP, "hasClients").mockResolvedValue(true)
    spyOn(LSP, "touchFile").mockResolvedValue(undefined as any)
    spyOn(LSP, "definition").mockResolvedValue([
      {
        uri: "file://" + file.replace(/\\/g, "/"),
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 19 },
        },
      },
    ] as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LspTool.init()
        const result = await tool.execute(
          {
            operation: "goToDefinition",
            filePath: "example.ts",
            line: 1,
            character: 15,
          },
          {
            sessionID: "test-lsp" as any,
            // @ts-ignore
            messageID: "",
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: ask as any,
          },
        )

        expect(ask).toHaveBeenCalledWith(
          expect.objectContaining({
            permission: "lsp",
            patterns: ["*"],
          }),
        )
        expect(result.title).toContain("goToDefinition")
        expect(result.title).toEndWith("example.ts:1:15")
        expect(result.output).toContain("\"uri\"")
        expect(result.metadata).toMatchObject({
          result: expect.any(Array),
        })
      },
    })
  })

  test("fails clearly when no lsp server is available for the file type", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "example.ts")
    await fs.writeFile(file, "export const answer = 42\n", "utf-8")

    spyOn(LSP, "hasClients").mockResolvedValue(false)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LspTool.init()
        await expect(
          tool.execute(
            {
              operation: "hover",
              filePath: "example.ts",
              line: 1,
              character: 1,
            },
            {
              sessionID: "test-lsp-no-server" as any,
              // @ts-ignore
              messageID: "",
              callID: "",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => {},
              ask: async () => {},
            },
          ),
        ).rejects.toThrow("No LSP server available for this file type. Try structural_read, grep, or read for a non-LSP fallback.")
      },
    })
  })

  test("adds fallback guidance when an lsp operation returns no results", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "example.ts")
    await fs.writeFile(file, "export const answer = 42\n", "utf-8")

    spyOn(LSP, "hasClients").mockResolvedValue(true)
    spyOn(LSP, "touchFile").mockResolvedValue(undefined as any)
    spyOn(LSP, "documentSymbol").mockResolvedValue([] as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LspTool.init()
        const result = await tool.execute(
          {
            operation: "documentSymbol",
            filePath: "example.ts",
            line: 1,
            character: 1,
          },
          {
            sessionID: "test-lsp-empty" as any,
            // @ts-ignore
            messageID: "",
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
        )

        expect(result.output).toContain("No results found for documentSymbol.")
        expect(result.output).toContain("Try structural_read for a file outline, or read for direct source inspection.")
      },
    })
  })
})
