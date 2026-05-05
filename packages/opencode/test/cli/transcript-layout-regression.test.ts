import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("transcript layout regression", () => {
  const root = join(__dirname, "..", "..")
  const source = readFileSync(
    join(root, "src/cli/cmd/tui/routes/session/index.tsx"),
    "utf-8",
  )

  test("keeps live reasoning inline instead of making it an expandable card", () => {
    const start = source.indexOf("function MessageReasoningPart(")
    const end = source.indexOf("function MessageTextPart(", start)
    const segment = source.slice(start, end)

    expect(segment).toContain("when={!reasoningLive()}")
    expect(segment).toContain('wrapMode="word"')
    expect(segment).not.toContain("Click to open the veil")
    expect(segment).not.toContain("Click to fold the veil")
    expect(segment).not.toContain("const [expanded, setExpanded] = createSignal(false)")
  })

  test("relaxes transcript width caps for wider terminals without going full width", () => {
    const start = source.indexOf("function deriveReadableTranscriptWidth(")
    const end = source.indexOf("function GenericTool(", start)
    const segment = source.slice(start, end)

    expect(source).toContain("preferred: 80")
    expect(source).toContain("wideCap: 100")
    expect(segment).toContain("input.preferred + 12")
    expect(segment).toContain("input.preferred + 6")
  })

  test("renders assistant parts with stable indexed children during live tool churn", () => {
    const start = source.indexOf("function SessionAssistantMessage(")
    const end = source.indexOf("function MessageTextPart(", start)
    const segment = source.slice(start, end)

    expect(source).toContain("Index,")
    expect(segment).toContain("<Index each={props.parts}>")
    expect(segment).not.toContain("<For each={props.parts}>")
  })

  test("keeps the live assistant activity banner on one mounted spinner shell", () => {
    const start = source.indexOf("function SessionAssistantMessage(")
    const bannerStart = source.indexOf("<Show when={showActivity() && activity()}>", start)
    const bannerEnd = source.indexOf("<Index each={props.parts}>", bannerStart)
    const segment = source.slice(bannerStart, bannerEnd)

    expect(segment).toContain("<Spinner")
    expect(segment).toContain('elapsed={item().spinner ? activityElapsed() : undefined}')
    expect(segment).not.toContain("<Switch>")
    expect(segment).not.toContain("<Match when={item().spinner}>")
  })

  test("renders in-flight assistant shells once the step starts, while still hiding truly empty shells", () => {
    expect(source).toContain("const shouldRenderTimelineMessage = (message: Message) => {")
    expect(source).toContain("const visibleTimelineMessages = createMemo(() =>")
    expect(source).toContain('if (message.role !== "assistant") return true')
    expect(source).toContain("const hasInFlightAssistantShell = (parts: Part[] | undefined) => {")
    expect(source).toContain('return parts.some((part) => part.type === "step-start")')
    expect(source).toContain("hasDisplayableTranscriptPart(parts)")
    expect(source).toContain("hasTranscriptActivityPart(parts)")
    expect(source).toContain("hasInFlightAssistantShell(parts)")
    expect(source).toContain("const latestVisibleMessageID = createMemo(() => visibleTimelineMessages().at(-1)?.id)")
    expect(source).toContain('return visibleTimelineMessages().findLast((x) => x.role === "assistant")')

    const start = source.indexOf("const liveTranscriptWindow = createMemo(() => {")
    const end = source.indexOf("createEffect(() => {", start)
    const segment = source.slice(start, end)

    expect(segment).not.toContain("const visibleMessages = timelineMessages().filter((message) => shouldRenderTimelineMessage(message))")
    expect(segment).toContain("resolveLiveTranscriptWindow(visibleTimelineMessages(), LIVE_TRANSCRIPT_RENDER_LIMIT)")
    expect(segment).toContain("visibleTimelineMessages(), omittedCount: 0")
  })
})
