import { describe, it, expect } from "bun:test"
import { parsePatchReview, parseSectionLines, reviewVerifySuggestions } from "../../src/harness/review"

describe("review module - parseSectionLines", () => {
  it("returns empty array when header is missing", () => {
    const raw = "VERDICT: APPROVE\nSUMMARY: test\n"
    expect(parseSectionLines(raw, "CONCERNS")).toEqual([])
    expect(parseSectionLines(raw, "VERIFY")).toEqual([])
  })

  it("parses hyphen-prefixed items under header", () => {
    const raw = "CONCERNS:\n- concern one\n- concern two\n"
    expect(parseSectionLines(raw, "CONCERNS")).toEqual(["concern one", "concern two"])
  })

  it("skips non-hyphen lines", () => {
    const raw = "CONCERNS:\nnot a bullet\n- actual concern\n"
    expect(parseSectionLines(raw, "CONCERNS")).toEqual(["actual concern"])
  })

  it("stops parsing when another SECTION: header appears", () => {
    const raw = "CONCERNS:\n- first\n- second\nVERIFY:\n- should not appear\n"
    expect(parseSectionLines(raw, "CONCERNS")).toEqual(["first", "second"])
  })

  it("filters out 'none' case-insensitively", () => {
    const raw = "CONCERNS:\n- None\n- actual\n- NONE\n"
    expect(parseSectionLines(raw, "CONCERNS")).toEqual(["actual"])
  })

  it("skips blank lines between items", () => {
    const raw = "CONCERNS:\n- one\n\n- two\n"
    expect(parseSectionLines(raw, "CONCERNS")).toEqual(["one", "two"])
  })

  it("trims whitespace from each value", () => {
    const raw = "VERIFY:\n-   spaced out  \n"
    expect(parseSectionLines(raw, "VERIFY")).toEqual(["spaced out"])
  })
})

describe("review module - parsePatchReview", () => {
  it("parses APPROVE verdict", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: Patch looks good and addresses the proposal
CONCERNS:
- none
VERIFY:
- bun test test/harness/healer.test.ts`

    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("approve")
    expect(result.approved).toBe(true)
    expect(result.summary).toBe("Patch looks good and addresses the proposal")
    expect(result.concerns).toEqual([])
    expect(result.verifySuggestions).toEqual(["bun test test/harness/healer.test.ts"])
  })

  it("parses REJECT verdict", () => {
    const raw = `VERDICT: REJECT
SUMMARY: Patch is too broad and risks regression
CONCERNS:
- removes safety checks
- changes unrelated code
VERIFY:
- none`

    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("reject")
    expect(result.approved).toBe(false)
    expect(result.summary).toBe("Patch is too broad and risks regression")
    expect(result.concerns).toEqual(["removes safety checks", "changes unrelated code"])
    expect(result.verifySuggestions).toEqual([])
  })

  it("handles case insensitive verdict", () => {
    const raw = `VERDICT: approve
SUMMARY: test
CONCERNS:
VERIFY:
`

    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("approve")
    expect(result.approved).toBe(true)
  })

  it("defaults to reject when verdict is unrecognized", () => {
    const raw = `VERDICT: MAYBE
SUMMARY: unsure
CONCERNS:
VERIFY:
`
    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("reject")
    expect(result.approved).toBe(false)
  })

  it("defaults to reject when verdict line is missing", () => {
    const raw = `SUMMARY: no verdict line
CONCERNS:
VERIFY:
`
    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("reject")
    expect(result.approved).toBe(false)
  })

  it("handles concerns with hyphens", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: test
CONCERNS:
- this is a concern
- another concern
VERIFY:
`

    const result = parsePatchReview(raw)
    expect(result.concerns).toEqual(["this is a concern", "another concern"])
  })

  it("filters out 'none' values from concerns", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: test
CONCERNS:
- none
VERIFY:
`

    const result = parsePatchReview(raw)
    expect(result.concerns).toEqual([])
  })

  it("filters out 'none' values from verify suggestions", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: test
CONCERNS:
VERIFY:
- none`

    const result = parsePatchReview(raw)
    expect(result.verifySuggestions).toEqual([])
  })

  it("handles empty concerns and verify sections", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: minimal patch
CONCERNS:
VERIFY:`

    const result = parsePatchReview(raw)
    expect(result.concerns).toEqual([])
    expect(result.verifySuggestions).toEqual([])
  })

  it("stops parsing at next section header", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: test
CONCERNS:
- concern 1
VERIFY:
- verify 1
EXTRA SECTION:
- should not be parsed`

    const result = parsePatchReview(raw)
    expect(result.concerns).toEqual(["concern 1"])
    expect(result.verifySuggestions).toEqual(["verify 1"])
  })

  it("handles summary with content after colon", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: This is a longer single line summary
CONCERNS:
VERIFY:
`

    const result = parsePatchReview(raw)
    expect(result.summary).toBe("This is a longer single line summary")
  })

  it("handles verify suggestions on multiple lines", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: test
CONCERNS:
VERIFY:
- bun test test/harness/a.test.ts
- bun test test/harness/b.test.ts
- bun test test/harness/c.test.ts`

    const result = parsePatchReview(raw)
    expect(result.verifySuggestions).toEqual([
      "bun test test/harness/a.test.ts",
      "bun test test/harness/b.test.ts",
      "bun test test/harness/c.test.ts",
    ])
  })

  it("provides default summary when missing", () => {
    const raw = `VERDICT: APPROVE
CONCERNS:
VERIFY:
`

    const result = parsePatchReview(raw)
    expect(result.summary).toBe("No review summary provided.")
  })

  it("handles whitespace around verdict value", () => {
    const raw = `VERDICT:   APPROVE
SUMMARY: test
CONCERNS:
VERIFY:
`

    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("approve")
    expect(result.approved).toBe(true)
  })

  it("handles minimal input with only verdict", () => {
    const raw = "VERDICT: REJECT"
    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("reject")
    expect(result.approved).toBe(false)
    expect(result.summary).toBe("No review summary provided.")
    expect(result.concerns).toEqual([])
    expect(result.verifySuggestions).toEqual([])
  })

  it("handles CRLF line endings", () => {
    const raw = "VERDICT: APPROVE\r\nSUMMARY: crlf test\r\nCONCERNS:\r\nVERIFY:\r\n"
    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("approve")
    expect(result.summary).toBe("crlf test")
  })

  it("parses mixed case section headers", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: test
concerns:
- lowercase header
verify:
- also lowercase`
    const result = parsePatchReview(raw)
    expect(result.concerns).toEqual(["lowercase header"])
    expect(result.verifySuggestions).toEqual(["also lowercase"])
  })

  it("handles raw text with no structured sections", () => {
    const raw = "this is just plain text with no structure"
    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("reject")
    expect(result.approved).toBe(false)
    expect(result.summary).toBe("No review summary provided.")
    expect(result.concerns).toEqual([])
    expect(result.verifySuggestions).toEqual([])
  })

  it("handles summary containing VERDICT: keyword", () => {
    const raw = `VERDICT: APPROVE
SUMMARY: The VERDICT: was wrong before
CONCERNS:
VERIFY:`
    const result = parsePatchReview(raw)
    expect(result.verdict).toBe("approve")
    expect(result.summary).toBe("The VERDICT: was wrong before")
  })

  it("handles empty string input", () => {
    const result = parsePatchReview("")
    expect(result.verdict).toBe("reject")
    expect(result.approved).toBe(false)
  })
})

describe("review module - reviewVerifySuggestions", () => {
  it("returns existing suggestions when rejected", () => {
    const result = reviewVerifySuggestions({
      approved: false,
      patchText: "*** Begin Patch\n*** End Patch",
      verifySuggestions: ["manual review needed"],
    })
    expect(result).toEqual(["manual review needed"])
  })

  it("returns existing suggestions when approved with suggestions", () => {
    const result = reviewVerifySuggestions({
      approved: true,
      patchText: "*** Begin Patch\n*** End Patch",
      verifySuggestions: ["run tests"],
    })
    expect(result).toEqual(["run tests"])
  })

  it("falls back to default commands when approved with no suggestions", () => {
    const patchText = `*** Begin Patch
*** Update File: packages/opencode/src/harness/review.ts
@@ @@
-old line
+new line
*** End Patch`
    const result = reviewVerifySuggestions({
      approved: true,
      patchText,
      verifySuggestions: [],
    })
    // Should derive commands from changed files in the patch
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  it("returns empty array when no default commands match patch files", () => {
    const patchText = `*** Begin Patch
*** Update File: some/unrelated/file.txt
@@ @@
-old
+new
*** End Patch`
    const result = reviewVerifySuggestions({
      approved: true,
      patchText,
      verifySuggestions: [],
    })
    expect(result).toEqual([])
  })
})
