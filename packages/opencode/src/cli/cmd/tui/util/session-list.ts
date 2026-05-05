import type { Session as SessionApi } from "@/session"

type SessionRow = SessionApi.Info

export function buildSessionListSearchQuery(query: string) {
  return {
    search: query,
    limit: 30,
    roots: true,
  }
}

export function sortRootSessions<T extends SessionRow>(sessions: T[]) {
  return sessions
    .filter((session) => session.parentID === undefined)
    .toSorted((a, b) => b.time.updated - a.time.updated)
}
