import { Worktree } from "@/worktree"
import { type Adaptor, WorkspaceInfoSchema } from "../types"

const Config = WorkspaceInfoSchema.extend({
  name: WorkspaceInfoSchema.shape.name.unwrap(),
  branch: WorkspaceInfoSchema.shape.branch.unwrap(),
  directory: WorkspaceInfoSchema.shape.directory.unwrap(),
})

export const WorktreeAdaptor: Adaptor = {
  async configure(info) {
    const worktree = await Worktree.makeWorktreeInfo(info.name ?? undefined)
    return {
      ...info,
      name: worktree.name,
      branch: worktree.branch,
      directory: worktree.directory,
    }
  },
  async create(info) {
    const config = Config.parse(info)
    await Worktree.createFromInfo({
      name: config.name,
      directory: config.directory,
      branch: config.branch,
    })
  },
  async remove(info) {
    const config = Config.parse(info)
    await Worktree.remove({ directory: config.directory })
  },
  async fetch(_info, _input: RequestInfo | URL, _init?: RequestInit) {
    throw new Error("fetch not implemented")
  },
}
