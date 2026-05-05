import { LSP } from "../lsp"

type Diagnostics = Awaited<ReturnType<typeof LSP.diagnostics>>

export async function collectDiagnostics(timeoutMs = 1500): Promise<Diagnostics> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      LSP.diagnostics(),
      new Promise<Diagnostics>((resolve) => {
        timer = setTimeout(() => resolve({}), timeoutMs)
      }),
    ])
  } catch {
    return {}
  } finally {
    if (timer) clearTimeout(timer)
  }
}
