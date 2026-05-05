import { Context } from "../util/context"

interface WorkspaceContextState {
  workspaceID?: string
}

const context = Context.create<WorkspaceContextState>("workspace")

export const WorkspaceContext = {
  provide<R>(input: { workspaceID?: string; fn: () => R | Promise<R> }): Promise<R> {
    return context.provide({ workspaceID: input.workspaceID }, input.fn) as Promise<R>
  },

  get workspaceID() {
    try {
      return context.use().workspaceID
    } catch (_e) {
      return undefined
    }
  },
}
