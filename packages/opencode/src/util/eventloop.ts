import { Log } from "./log"

type ProcessWithActiveState = NodeJS.Process & {
  _getActiveHandles(): unknown[]
  _getActiveRequests(): unknown[]
}

function getProcessActiveState() {
  const runtime = process as ProcessWithActiveState
  return {
    handles: runtime._getActiveHandles(),
    requests: runtime._getActiveRequests(),
  }
}

async function wait() {
  return new Promise<void>((resolve) => {
    const check = () => {
      const active = getProcessActiveState()
      Log.Default.info("eventloop", {
        active: [...active.handles, ...active.requests],
      })
      if (active.handles.length === 0 && active.requests.length === 0) {
        resolve()
      } else {
        setImmediate(check)
      }
    }
    check()
  })
}

export const EventLoop = {
  wait,
}
