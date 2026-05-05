/* eslint-disable @typescript-eslint/no-namespace */

import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import z from "zod"

export namespace SessionPlanState {
  export const Mode = z.enum(["planning", "awaiting_approval", "approved"])

  export const Info = z.object({
    mode: Mode,
    pendingPlanPath: z.string().optional(),
    approvedPlanPath: z.string().optional(),
    feedback: z.string().optional(),
    updatedAt: z.number(),
  })

  export type Info = z.infer<typeof Info>

  function dir() {
    if (Instance.project.vcs) return path.join(Instance.worktree, ".opencode", "plans", ".state")
    return path.join(Global.Path.data, "plans", "state")
  }

  function filePath(sessionID: string) {
    return path.join(dir(), `${sessionID}.json`)
  }

  export async function get(sessionID: string) {
    const target = filePath(sessionID)
    if (!(await Filesystem.exists(target))) return undefined
    return Info.parse(await Filesystem.readJson(target))
  }

  export async function set(sessionID: string, input: Omit<Info, "updatedAt">) {
    const info: Info = {
      ...input,
      updatedAt: Date.now(),
    }
    await Filesystem.writeJson(filePath(sessionID), info)
    return info
  }
}
