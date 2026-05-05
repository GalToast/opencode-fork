import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
  workspaceID?: string
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
}

export type PluginRoute = {
  type: "plugin"
  id: string
  data?: Record<string, unknown>
}

export type Route = HomeRoute | SessionRoute | PluginRoute

function readInitialRoute(): Route {
  const raw = process.env["OPENCODE_ROUTE"]
  if (!raw) return { type: "home" }
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return { type: "home" }

  const type = (parsed as { type?: unknown }).type
  if (type === "home") return parsed as HomeRoute
  if (type === "session") return parsed as SessionRoute
  if (type === "plugin") return parsed as PluginRoute
  return { type: "home" }
}

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [store, setStore] = createStore<Route>(readInitialRoute())

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        setStore(route)
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(_type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof _type }>
}
