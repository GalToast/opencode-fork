import { describe, expect, test } from "bun:test"
import { buildSessionListSearchQuery, sortRootSessions } from "../../src/cli/cmd/tui/util/session-list"

describe("DialogSessionList helpers", () => {
  test("builds a root-only session search query", () => {
    expect(buildSessionListSearchQuery("alpha")).toEqual({
      search: "alpha",
      limit: 30,
      roots: true,
    })
  })

  test("sorts only root sessions by updated time", () => {
    const rows = sortRootSessions([
      {
        id: "child",
        parentID: "root-new",
        title: "child",
        time: { updated: 300, created: 300 },
      },
      {
        id: "root-old",
        title: "root-old",
        time: { updated: 100, created: 100 },
      },
      {
        id: "root-new",
        title: "root-new",
        time: { updated: 200, created: 200 },
      },
    ])

    expect(rows.map((row) => row.id)).toEqual(["root-new", "root-old"])
  })
})
