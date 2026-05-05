import { describe, expect, test } from "bun:test"
import { rankAutocompleteOptions, type RankedAutocompleteOption } from "../../src/cli/cmd/tui/component/prompt/autocomplete-ranking"

const frecency = {
  getFrecency: () => 0,
}

describe("prompt autocomplete ranking", () => {
  test("prefers exact slash prefixes like /sess for /sessions", () => {
    const options: RankedAutocompleteOption[] = [
      { display: "/share", value: "/share" },
      { display: "/sessions", value: "/sessions", aliases: ["/resume", "/continue"] },
      { display: "/scheduler", value: "/scheduler" },
    ]

    const ranked = rankAutocompleteOptions({
      query: "sess",
      mode: "/",
      options,
      frecency,
    })

    expect(ranked[0]?.value).toBe("/sessions")
  })

  test("prefers matching slash aliases when the alias is the typed prefix", () => {
    const options: RankedAutocompleteOption[] = [
      { display: "/share", value: "/share" },
      { display: "/sessions", value: "/sessions", aliases: ["/resume", "/continue"] },
    ]

    const ranked = rankAutocompleteOptions({
      query: "res",
      mode: "/",
      options,
      frecency,
    })

    expect(ranked[0]?.value).toBe("/sessions")
  })

  test("prefers human shorthand aliases like /session, /sess, and /model", () => {
    const options: RankedAutocompleteOption[] = [
      { display: "/sessions", value: "/sessions", aliases: ["/resume", "/continue", "/session", "/sess"] },
      { display: "/models", value: "/models", aliases: ["/model"] },
      { display: "/share", value: "/share" },
    ]

    const sessionRanked = rankAutocompleteOptions({
      query: "session",
      mode: "/",
      options,
      frecency,
    })
    const modelRanked = rankAutocompleteOptions({
      query: "model",
      mode: "/",
      options,
      frecency,
    })

    expect(sessionRanked[0]?.value).toBe("/sessions")
    expect(modelRanked[0]?.value).toBe("/models")
  })
})
