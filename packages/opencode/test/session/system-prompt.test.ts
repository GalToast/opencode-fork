import path from "path"
import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function model(providerID: string, id: string) {
  return {
    providerID,
    api: { id },
  } as any
}

async function readPrompt(name: string) {
  const file = path.join(import.meta.dir, "../../src/session/prompt", name)
  return Bun.file(file).text()
}

describe("session.system prompt contracts", () => {
  test("codex header teaches tracker-aware coordination and managed terminals", async () => {
    const text = await readPrompt("codex_header.txt")
    expect(text).toContain("tracker tools")
    expect(text).toContain("Batch")
    expect(text).toContain("LSP")
    expect(text).toContain("multiple mutation tools")
    expect(text).toContain("optional code intelligence")
    expect(text).toContain("Terminal")
    expect(text).toContain("RetrievalStatus")
    expect(text).toContain("List")
    expect(text).toContain("bash -lc")
    expect(text).toContain("Do not infer the host OS or shell from one failed command")
  })

  test("bash tool description explains the legacy tool name on Windows", async () => {
    const text = await readPrompt("../../tool/bash.txt")
    expect(text).toContain("Legacy naming note")
    expect(text).toContain("preferred system shell")
  })

  test("beast prompt carries the same batch and lsp safety guidance", async () => {
    const text = await readPrompt("beast.txt")
    expect(text).toContain("Prefer **Batch** only for independent read-only")
    expect(text).toContain("Treat **LSP** as optional code intelligence")
  })

  test("alibaba prompt carries the same rollback safety guidance", async () => {
    const text = await readPrompt("alibaba.txt")
    expect(text).toContain("Prefer `snapshot_revert` before complex or risky multi-file edits")
    expect(text).toContain("Prefer `list` when you already know the directory")
    expect(text).toContain("Use `retrieval_status` when recall quality seems weak")
    expect(text).toContain("Do not force `task` for every codebase lookup")
    expect(text).toContain("Prefer `batch` only for independent read-only")
    expect(text).toContain("Treat `lsp` as optional code intelligence")
    expect(text).toContain("Prefer `terminal` over `shell`")
  })

  test("qwen fallback prompt carries the same rollback safety guidance", async () => {
    const text = await readPrompt("qwen.txt")
    expect(text).toContain("Prefer `snapshot_revert` before complex or risky multi-file edits")
    expect(text).toContain("Prefer `list` when you already know the directory")
    expect(text).toContain("Use `retrieval_status` when recall quality seems weak")
    expect(text).toContain("Do not force `task` for every codebase lookup")
    expect(text).toContain("Prefer `batch` only for independent read-only")
    expect(text).toContain("Treat `lsp` as optional code intelligence")
    expect(text).toContain("Prefer `terminal` over `shell`")
  })

  test("anthropic prompt teaches balanced task selection instead of forcing task or todo for everything", async () => {
    const text = await readPrompt("anthropic.txt")
    expect(text).toContain("Do not force Task for every codebase lookup")
    expect(text).toContain("Do not infer the host OS or shell from one failed command")
    expect(text).toContain("Prefer `snapshot_revert` before complex or risky multi-file edits")
    expect(text).toContain("Prefer `batch` only for independent read-only")
    expect(text).toContain("Treat `lsp` as optional code intelligence")
    expect(text).toContain("retrieval_status")
    expect(text).toContain("blackboard")
    expect(text).toContain("tracker tools")
    expect(text).not.toContain("IMPORTANT: Always use the TodoWrite tool to plan and track tasks throughout the conversation.")
  })

  test("anthropic 20250930 prompt carries the same modern tool guidance", async () => {
    const text = await readPrompt("anthropic-20250930.txt")
    expect(text).toContain("Do not force Task for every codebase lookup")
    expect(text).toContain("Do not infer the host OS or shell from one failed command")
    expect(text).toContain("Prefer `snapshot_revert` before complex or risky multi-file edits")
    expect(text).toContain("Prefer `batch` only for independent read-only")
    expect(text).toContain("Treat `lsp` as optional code intelligence")
    expect(text).toContain("retrieval_status")
    expect(text).toContain("blackboard")
    expect(text).toContain("tracker tools")
    expect(text).toContain("Runtime environment details")
    expect(text).not.toContain("Working directory: /home/")
    expect(text).not.toContain("Today's date: 2025-09-30")
    expect(text).not.toContain("IMPORTANT: Always use the TodoWrite tool to plan and track tasks throughout the conversation.")
  })

  test("gemini prompt teaches tracker fit alongside blackboard and terminal guidance", async () => {
    const text = await readPrompt("gemini.txt")
    expect(text).toContain("Coordination Fit")
    expect(text).toContain("Batch Fit")
    expect(text).toContain("LSP Fit")
    expect(text).toContain("Rollback Safety")
    expect(text).toContain("multiple mutation tools")
    expect(text).toContain("optional code intelligence")
    expect(text).toContain("tracker tools")
    expect(text).toContain("blackboard")
    expect(text).toContain("terminal")
    expect(text).toContain("Do not infer the host OS or shell from one failed command")
    expect(text).not.toContain("Should I proceed?")
  })

  test("SystemPrompt.environment includes windows shell guidance in this runtime", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lines = await SystemPrompt.environment(model("anthropic", "claude-sonnet-4-5-20250929"))
        const text = lines.join("\n")
        expect(text).toContain("preferred_shell=")
        expect(text).toContain("shell_command_tool=")
        expect(text).toContain("Windows-native session")
        expect(text).toContain("`bash` is a legacy alias")
      },
    })
  })

  test("SystemPrompt.provider returns the expected provider families", () => {
    expect(SystemPrompt.provider(model("anthropic", "claude-sonnet-4-5-20250929")).join("\n")).toContain("TodoWrite")
    expect(SystemPrompt.provider(model("google", "gemini-2.5-pro")).join("\n")).toContain("Coordination Fit")
    expect(SystemPrompt.provider(model("alibaba-coding-plan", "qwen3.5-plus")).join("\n")).toContain("TodoWrite")
    expect(SystemPrompt.provider(model("opencode", "some-unknown-free-model")).join("\n")).toContain("snapshot_revert")
  })
})
