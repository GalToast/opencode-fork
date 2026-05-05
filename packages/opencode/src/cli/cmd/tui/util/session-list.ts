import type { Session } from "@opencode-ai/sdk/v2"

export function buildSessionListSearchQuery(query: string) {
  return {
    search: query,
    limit: 30,
    roots: true,
  }
}

export function sortRootSessions<T extends Pick<Session, "id" | "parentID" | "time">>(sessions: T[]) {
  return sessions
    .filter((session) => session.parentID === undefined)
    .toSorted((a, b) => b.time.updated - a.time.updated)
}
