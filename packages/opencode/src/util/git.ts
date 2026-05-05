import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export interface GitOptions {
  cwd?: string
}

export async function git(args: string[], options?: GitOptions): Promise<string> {
  const { stdout } = await execAsync(`git ${args.join(" ")}`, {
    cwd: options?.cwd,
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout.trim()
}
