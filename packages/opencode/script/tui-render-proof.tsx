/** @jsxImportSource @opentui/solid */
/**
 * Deterministic TUI render proof for the real Plan and Tracker dialogs.
 *
 * This is intentionally no-model and no-network. It imports the real
 * DialogPlan and DialogTracker modules after installing Bun module mocks for
 * their TUI runtime contexts.
 */

import { mock } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { For, createSignal, onMount, type JSX } from "solid-js"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

const OUT_DIR = join(process.cwd(), "tmp", "tui-render-proof")
const SESSION_ID = "child-session"
const ROOT_SESSION_ID = "root-session"

const theme = {
  text: RGBA.fromHex("#e7edf3"),
  textMuted: RGBA.fromHex("#99a6b8"),
  accent: RGBA.fromHex("#69d2ff"),
  primary: RGBA.fromHex("#69d2ff"),
  success: RGBA.fromHex("#8ee88e"),
  error: RGBA.fromHex("#ff7a7a"),
  warning: RGBA.fromHex("#ffd166"),
  backgroundPanel: RGBA.fromHex("#171b22"),
  backgroundElement: RGBA.fromHex("#202633"),
  border: RGBA.fromHex("#303846"),
}

const syncData = {
  session: [
    { id: ROOT_SESSION_ID, parentID: undefined },
    { id: SESSION_ID, parentID: ROOT_SESSION_ID },
  ],
  plan_state: {
    [ROOT_SESSION_ID]: {
      rootSessionID: ROOT_SESSION_ID,
      sessionID: SESSION_ID,
      mode: "awaiting_approval",
      pendingPlanPath: "plans/opencodex/tui-proof-plan.md",
      approvedPlanPath: "plans/opencodex/approved-restoration-plan.md",
      feedback: "Tighten proof path and capture real TUI surfaces.",
      updatedAt: Date.UTC(2026, 4, 1, 15, 0, 0),
    },
  },
  planner_preview: {
    [ROOT_SESSION_ID]: {
      rootSessionID: ROOT_SESSION_ID,
      sessionID: SESSION_ID,
      mode: "plan",
      planPath: "plans/opencodex/tui-proof-plan.md",
      exists: true,
      hint: "mocked root-session surface",
      updatedAt: Date.UTC(2026, 4, 1, 15, 0, 0),
    },
  },
  workgraph: {
    [ROOT_SESSION_ID]: {
      rootSessionID: ROOT_SESSION_ID,
      sessionID: SESSION_ID,
      objectiveCount: 4,
      activeObjectiveCount: 2,
      laneCount: 3,
      activeLaneCount: 2,
      artifactCount: 5,
      updatedAt: Date.UTC(2026, 4, 1, 15, 0, 0),
    },
  },
  tracker_summary: {
    [ROOT_SESSION_ID]: {
      rootSessionID: ROOT_SESSION_ID,
      sessionID: SESSION_ID,
      taskCount: 6,
      openCount: 2,
      inProgressCount: 2,
      blockedCount: 1,
      closedCount: 1,
      recentCount: 4,
      trackerPath: ".opencode/tracker/root-session.json",
      updatedAt: Date.UTC(2026, 4, 1, 15, 0, 0),
      tasks: [
        {
          id: "aa0001",
          title: "Restore TUI proof path",
          description: "Launch, render, and capture real TUI proof surfaces.",
          type: "epic",
          status: "in_progress",
          dependencies: [],
          requiredSkills: ["typescript", "opentui"],
          artifacts: ["tmp/tui-render-proof/proof-frame.html"],
        },
        {
          id: "aa0002",
          title: "Capture DialogPlan",
          description: "Render plan state with mocked sync data.",
          type: "task",
          status: "closed",
          dependencies: ["aa0001"],
          requiredSkills: ["solid"],
        },
        {
          id: "aa0003",
          title: "Capture DialogTracker",
          description: "Render tracker summary and task list.",
          type: "task",
          status: "in_progress",
          dependencies: ["aa0001"],
          requiredSkills: ["solid", "dag"],
        },
        {
          id: "aa0004",
          title: "Wire screenshot artifact",
          description: "Create browser-safe HTML and PNG proof output.",
          type: "task",
          status: "blocked",
          dependencies: ["aa0002", "aa0003"],
          requiredSkills: ["playwright"],
        },
      ],
    },
  },
}

let mocksInstalled = false
let activeProofDialog:
  | {
      stack: unknown[]
      clear: () => void
      replace: (input: JSX.Element | (() => JSX.Element)) => void
      setSize: (size: "medium" | "large" | "xlarge") => void
    }
  | undefined

function proofDialogFallback() {
  return {
    stack: [],
    clear() {},
    replace(_input: JSX.Element | (() => JSX.Element)) {},
    setSize(_size: "medium" | "large" | "xlarge") {},
  }
}

export function setupTuiProofMocks() {
  if (mocksInstalled) return
  mocksInstalled = true

  mock.module("@tui/context/sync", () => ({
    useSync: () => ({ data: syncData }),
    getRootSessionID: (sessions: Array<{ id: string; parentID?: string }>, sessionID: string) => {
      const byID = new Map(sessions.map((session) => [session.id, session]))
      let current = byID.get(sessionID)
      let root = current?.id ?? sessionID
      while (current?.parentID) {
        const parent = byID.get(current.parentID)
        if (!parent) break
        root = parent.id
        current = parent
      }
      return root
    },
  }))

  mock.module("@tui/ui/dialog", () => ({
    Dialog: (props: { children?: unknown }) => props.children,
    DialogProvider: (props: { children?: unknown }) => props.children,
    useDialog: () => activeProofDialog ?? proofDialogFallback(),
  }))

  mock.module("../../ui/dialog", () => ({
    Dialog: (props: { children?: unknown }) => props.children,
    DialogProvider: (props: { children?: unknown }) => props.children,
    useDialog: () => activeProofDialog ?? proofDialogFallback(),
  }))

  mock.module("@tui/context/keybind", () => ({
    KeybindProvider: (props: { children?: unknown }) => props.children,
    useKeybind: () => ({
      all: {},
      leader: false,
      parse: (_evt: unknown) => ({}),
      match: (_key: string, _evt: unknown) => false,
      print: (key: string) => key,
    }),
  }))

  mock.module("@tui/ui/toast", () => ({
    Toast: () => null,
    ToastProvider: (props: { children?: unknown }) => props.children,
    useToast: () => ({
      currentToast: null,
      show(_input: unknown) {},
      error(_input: unknown) {},
    }),
  }))

  mock.module("@tui/context/theme", () => ({
    DEFAULT_THEMES: {
      opencode: { theme: {} },
    },
    ThemeProvider: (props: { children?: unknown }) => props.children,
    allThemes: () => ({ opencode: { theme: {} } }),
    hasTheme: (name: string) => name === "opencode",
    addTheme: () => true,
    upsertTheme: () => true,
    resolveTheme: () => theme,
    useTheme: () => ({ theme }),
    selectedForeground: () => RGBA.fromHex("#101216"),
    tint: (base: RGBA, overlay: RGBA, alpha: number) =>
      RGBA.fromValues(
        base.r * (1 - alpha) + overlay.r * alpha,
        base.g * (1 - alpha) + overlay.g * alpha,
        base.b * (1 - alpha) + overlay.b * alpha,
        base.a,
      ),
  }))

  mock.module("@tui/util/clipboard", () => ({
    Clipboard: {
      copy: async (_value: string) => {},
    },
  }))

  mock.module("@/skill/registry", () => ({
    SkillRegistry: {
      isLoaded: (skill: string) => skill === "typescript" || skill === "solid",
    },
  }))

  // DialogSelect pulls in live keyboard/input/keybind machinery. The dialogs
  // remain real; this child is reduced to deterministic static rows.
  mock.module("@tui/ui/dialog-select", () => ({
    DialogSelect: (props: { title?: string; placeholder?: string; options: Array<{ title: string; description?: string; footer?: string }> }) => (
      <box gap={1} paddingLeft={2} paddingRight={2}>
        <text fg={theme.textMuted}>{props.placeholder ?? props.title ?? "Select"}</text>
        <For each={props.options.slice(0, 6)}>
          {(option) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme.accent}>{option.title}</text>
              <text fg={theme.textMuted}>{option.description ?? ""}</text>
              <text fg={theme.textMuted}>{option.footer ? String(option.footer) : ""}</text>
            </box>
          )}
        </For>
      </box>
    ),
  }))
}

export async function renderRealDialogFrames() {
  setupTuiProofMocks()
  const [{ DialogPlan }, { DialogTracker }] = await Promise.all([
    import("../src/cli/cmd/tui/routes/session/dialog-plan"),
    import("../src/cli/cmd/tui/routes/session/dialog-tracker"),
  ])

  const plan = await testRender(() => (
    <box width={88} height={18} paddingX={1} paddingY={1}>
      <DialogPlan sessionID={SESSION_ID} />
    </box>
  ))
  await plan.renderOnce()
  const planFrame = plan.captureCharFrame()
  plan.renderer.destroy()

  const tracker = await testRender(() => (
    <box width={108} height={24} paddingX={1} paddingY={1}>
      <DialogTracker sessionID={SESSION_ID} />
    </box>
  ))
  await tracker.renderOnce()
  const trackerFrame = tracker.captureCharFrame()
  tracker.renderer.destroy()

  return {
    planFrame,
    trackerFrame,
  }
}

/**
 * Render DialogTracker in both list and DAG mode.
 *
 * DAG mode is triggered by pressing "d" via mockInput, which hits the
 * useKeyboard("d") handler in the real module and switches viewMode to "dag".
 * A second render captures the DAG layout output.
 */
export async function renderDialogTrackerFrames() {
  setupTuiProofMocks()
  const [{ DialogTracker }] = await Promise.all([
    import("../src/cli/cmd/tui/routes/session/dialog-tracker"),
  ])

  // -- List mode (default) --
  const trackerList = await testRender(() => (
    <box width={108} height={28} paddingX={1} paddingY={1}>
      <DialogTracker sessionID={SESSION_ID} />
    </box>
  ))
  await trackerList.renderOnce()
  const listFrame = trackerList.captureCharFrame()

  // -- Switch to DAG mode via keyboard input --
  trackerList.mockInput.pressKey("d")
  await trackerList.renderOnce()
  const dagFrame = trackerList.captureCharFrame()
  trackerList.renderer.destroy()

  return {
    listFrame,
    dagFrame,
  }
}

export async function renderSlashCommandDispatchFrames() {
  setupTuiProofMocks()
  const [{ CommandProvider, useCommandDialog }, { sessionPlanTrackerCommandOptions }] = await Promise.all([
    import("../src/cli/cmd/tui/component/dialog-command"),
    import("../src/cli/cmd/tui/routes/session/plan-tracker-command-options"),
  ])

  async function renderSlash(slash: "plan" | "tracker" | "tasks") {
    const result = {
      slash,
      hasPlan: false,
      hasTracker: false,
      hasTasksAlias: false,
      triggered: false,
      replaced: false,
      size: "medium",
    }

    function DispatchProbe() {
      const command = useCommandDialog()
      command.register(() => sessionPlanTrackerCommandOptions(SESSION_ID))
      onMount(() => {
        result.hasPlan = command.hasSlash("plan")
        result.hasTracker = command.hasSlash("tracker")
        result.hasTasksAlias = command.hasSlash("tasks")
        result.triggered = command.triggerSlash(slash)
      })
      return <text fg={theme.textMuted}>slash dispatch probe: /{slash}</text>
    }

    function Harness() {
      const [dialogElement, setDialogElement] = createSignal<JSX.Element>()
      activeProofDialog = {
        stack: [],
        clear() {
          this.stack = []
          setDialogElement(undefined)
        },
        replace(input: JSX.Element | (() => JSX.Element)) {
          result.replaced = true
          this.stack = [input]
          setDialogElement(typeof input === "function" ? input() : input)
        },
        setSize(size: "medium" | "large" | "xlarge") {
          result.size = size
        },
      }

      return (
        <box width={116} height={30} paddingX={1} paddingY={1} flexDirection="column">
          <CommandProvider>
            <DispatchProbe />
          </CommandProvider>
          {dialogElement()}
        </box>
      )
    }

    const rendered = await testRender(() => <Harness />)
    await rendered.renderOnce()
    await rendered.renderOnce()
    const frame = rendered.captureCharFrame()
    rendered.renderer.destroy()
    activeProofDialog = undefined
    return { frame, result }
  }

  const plan = await renderSlash("plan")
  const tracker = await renderSlash("tracker")
  const tasksAlias = await renderSlash("tasks")

  return {
    planFrame: plan.frame,
    trackerFrame: tracker.frame,
    tasksAliasFrame: tasksAlias.frame,
    results: [plan.result, tracker.result, tasksAlias.result],
  }
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function verifySlashCommandWiring() {
  const sourceFile = "src/cli/cmd/tui/routes/session/plan-tracker-command-options.tsx"
  const routeFile = "src/cli/cmd/tui/routes/session/index.tsx"
  const source = readFileSync(join(process.cwd(), sourceFile), "utf-8")
  const routeSource = readFileSync(join(process.cwd(), routeFile), "utf-8")
  const plan = {
    importsDialog: source.includes('import { DialogPlan } from "./dialog-plan"'),
    hasSlashName: source.includes('name: "plan"'),
    hasCommandTitle: source.includes('title: "Show plan state"'),
    opensDialog: source.includes("dialog.replace(<DialogPlan sessionID={sessionID} />)"),
    sessionRouteUsesSharedOptions: routeSource.includes("...sessionPlanTrackerCommandOptions(route.sessionID)"),
  }
  const tracker = {
    importsDialog: source.includes('import { DialogTracker } from "./dialog-tracker"'),
    hasSlashName: source.includes('name: "tracker"'),
    hasAlias: source.includes('aliases: ["tasks"]'),
    hasCommandTitle: source.includes('title: "Show tracker"'),
    opensDialog: source.includes("dialog.replace(<DialogTracker sessionID={sessionID} />)"),
    sessionRouteUsesSharedOptions: routeSource.includes("...sessionPlanTrackerCommandOptions(route.sessionID)"),
  }

  return {
    sourceFile,
    routeFile,
    plan: {
      ...plan,
      verified: Object.values(plan).every(Boolean),
    },
    tracker: {
      ...tracker,
      verified: Object.values(tracker).every(Boolean),
    },
  }
}

function proofHtml(
  planFrame: string,
  trackerListFrame: string,
  trackerDagFrame: string,
  slashWiring: ReturnType<typeof verifySlashCommandWiring>,
  slashDispatch: Awaited<ReturnType<typeof renderSlashCommandDispatchFrames>>,
) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>OpenCodex Real TUI Dialog Proof</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      background: #101216;
      color: #e7edf3;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      display: grid;
      gap: 24px;
      align-content: center;
      justify-content: center;
      padding: 32px;
    }
    h1 {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 6px;
    }
    p {
      color: #99a6b8;
      margin: 0 0 10px;
      font-size: 13px;
    }
    section {
      background: #171b22;
      border: 1px solid #303846;
      border-radius: 8px;
      box-shadow: 0 16px 60px rgba(0, 0, 0, 0.35);
      padding: 18px 20px;
    }
    pre {
      margin: 0;
      font-size: 14px;
      line-height: 1.18;
      white-space: pre;
    }
  </style>
</head>
<body>
  <section>
    <h1>Real DialogPlan Module</h1>
    <p>Mocked sync/theme/dialog contexts; no model calls; deterministic root-session data.</p>
    <pre>${escapeHtml(planFrame)}</pre>
  </section>
  <section>
    <h1>Real DialogTracker Module - List Mode</h1>
    <p>Mocked sync/theme/dialog contexts; DialogSelect simplified for static capture.</p>
    <pre>${escapeHtml(trackerListFrame)}</pre>
  </section>
  <section>
    <h1>Real DialogTracker Module - DAG Mode</h1>
    <p>Same real DialogTracker instance after OpenTUI mock input presses "d".</p>
    <pre>${escapeHtml(trackerDagFrame)}</pre>
  </section>
  <section>
    <h1>Slash Command Wiring</h1>
    <p>Static verification from ${escapeHtml(slashWiring.sourceFile)}.</p>
    <pre>${escapeHtml(JSON.stringify({ plan: slashWiring.plan, tracker: slashWiring.tracker }, null, 2))}</pre>
  </section>
  <section>
    <h1>Slash Command Dispatch - /plan</h1>
    <p>Real CommandProvider triggerSlash("plan") using the shared session command options.</p>
    <pre>${escapeHtml(slashDispatch.planFrame)}</pre>
  </section>
  <section>
    <h1>Slash Command Dispatch - /tracker</h1>
    <p>Real CommandProvider triggerSlash("tracker") using the shared session command options.</p>
    <pre>${escapeHtml(slashDispatch.trackerFrame)}</pre>
  </section>
</body>
</html>
`
}

export async function writeRealDialogProofArtifacts() {
  mkdirSync(OUT_DIR, { recursive: true })
  const frames = await renderRealDialogFrames()
  const trackerModes = await renderDialogTrackerFrames()
  const slashWiring = verifySlashCommandWiring()
  const slashDispatch = await renderSlashCommandDispatchFrames()

  writeFileSync(join(OUT_DIR, "dialog-plan-frame.txt"), frames.planFrame, "utf-8")
  writeFileSync(join(OUT_DIR, "dialog-tracker-frame.txt"), frames.trackerFrame, "utf-8")
  writeFileSync(join(OUT_DIR, "dialog-tracker-list-frame.txt"), trackerModes.listFrame, "utf-8")
  writeFileSync(join(OUT_DIR, "dialog-tracker-dag-frame.txt"), trackerModes.dagFrame, "utf-8")
  writeFileSync(join(OUT_DIR, "slash-command-wiring.json"), JSON.stringify(slashWiring, null, 2), "utf-8")
  writeFileSync(join(OUT_DIR, "slash-plan-dispatch-frame.txt"), slashDispatch.planFrame, "utf-8")
  writeFileSync(join(OUT_DIR, "slash-tracker-dispatch-frame.txt"), slashDispatch.trackerFrame, "utf-8")
  writeFileSync(join(OUT_DIR, "slash-tasks-alias-dispatch-frame.txt"), slashDispatch.tasksAliasFrame, "utf-8")
  writeFileSync(join(OUT_DIR, "slash-command-dispatch.json"), JSON.stringify(slashDispatch.results, null, 2), "utf-8")
  writeFileSync(join(OUT_DIR, "real-dialog-proof.html"), proofHtml(frames.planFrame, trackerModes.listFrame, trackerModes.dagFrame, slashWiring, slashDispatch), "utf-8")
  writeFileSync(
    join(OUT_DIR, "real-dialog-proof-summary.json"),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        importsRealModules: ["DialogPlan", "DialogTracker"],
        trackerModes: ["list", "dag"],
        slashCommandWiring: {
          sourceFile: slashWiring.sourceFile,
          plan: slashWiring.plan.verified,
          tracker: slashWiring.tracker.verified,
        },
        slashCommandDispatch: slashDispatch.results.map((result) => ({
          slash: result.slash,
          triggered: result.triggered,
          replaced: result.replaced,
        })),
        mocked: ["useSync", "useDialog", "useToast", "useTheme", "useKeybind", "Clipboard", "SkillRegistry", "DialogSelect"],
        productModelCalls: false,
        networkCalls: false,
        artifacts: [
          "dialog-plan-frame.txt",
          "dialog-tracker-frame.txt",
          "dialog-tracker-list-frame.txt",
          "dialog-tracker-dag-frame.txt",
          "slash-command-wiring.json",
          "slash-plan-dispatch-frame.txt",
          "slash-tracker-dispatch-frame.txt",
          "slash-tasks-alias-dispatch-frame.txt",
          "slash-command-dispatch.json",
          "real-dialog-proof.html",
        ],
      },
      null,
      2,
    ),
    "utf-8",
  )

  return { ...frames, slashDispatch }
}

if (import.meta.main) {
  const frames = await writeRealDialogProofArtifacts()
  console.log("=== DialogPlan ===")
  console.log(frames.planFrame)
  console.log("=== DialogTracker ===")
  console.log(frames.trackerFrame)
  console.log("=== Slash Command Wiring ===")
  console.log(JSON.stringify(verifySlashCommandWiring(), null, 2))
  console.log("=== Slash Command Dispatch ===")
  console.log(JSON.stringify(frames.slashDispatch.results, null, 2))
  console.log(`Artifacts in: ${OUT_DIR}`)
}
