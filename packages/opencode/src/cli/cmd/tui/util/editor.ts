import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

type EditorOptions = {
  value: string
  renderer: CliRenderer
}

async function openEditor(opts: EditorOptions): Promise<string | undefined> {
  const editor = process.env["VISUAL"] || process.env["EDITOR"]
  if (!editor) return

  const filepath = join(tmpdir(), `${Date.now()}.md`)
  await Filesystem.write(filepath, opts.value)
  opts.renderer.suspend()
  opts.renderer.currentRenderBuffer.clear()

  try {
    const parts = editor.split(" ")
    const proc = Process.spawn([...parts, filepath], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    await proc.exited
    const content = await Filesystem.readText(filepath)
    return content || undefined
  } finally {
    opts.renderer.currentRenderBuffer.clear()
    opts.renderer.resume()
    opts.renderer.requestRender()
    await rm(filepath, { force: true })
  }
}

export const Editor = {
  open: openEditor,
}
