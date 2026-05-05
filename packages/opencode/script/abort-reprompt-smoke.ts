// @ts-nocheck - TODO: fix after API stabilization
import { bootstrap } from "../src/cli/bootstrap"
import { Log } from "../src/util/log"
import { Session } from "../src/session"
import { SessionPrompt } from "../src/session/prompt"

type Options = {
  agent: string
  runs: number
  startTimeoutMs: number
  settleTimeoutMs: number
}

type AttemptResult = {
  run: number
  ok: boolean
  agent: string
  sessionID: string
  firstToken: string
  secondToken: string
  sawFirstActivity: boolean
  latestAssistantText: string
  latestAssistantErrored: boolean
  firstAssistantHasAbortError: boolean
  reason?: string
}

function parseArgs(argv: string[]): Options {
  const result: Options = {
    agent: "plan",
    runs: 1,
    startTimeoutMs: 45000,
    settleTimeoutMs: 120000,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--agent" && argv[i + 1]) result.agent = argv[++i]!
    else if (arg === "--runs" && argv[i + 1]) result.runs = Number(argv[++i]!)
    else if (arg === "--start-timeout-ms" && argv[i + 1]) result.startTimeoutMs = Number(argv[++i]!)
    else if (arg === "--settle-timeout-ms" && argv[i + 1]) result.settleTimeoutMs = Number(argv[++i]!)
  }

  if (!Number.isFinite(result.runs) || result.runs < 1) throw new Error("Invalid --runs value")
  if (!Number.isFinite(result.startTimeoutMs) || result.startTimeoutMs < 1000) {
    throw new Error("Invalid --start-timeout-ms value")
  }
  if (!Number.isFinite(result.settleTimeoutMs) || result.settleTimeoutMs < 1000) {
    throw new Error("Invalid --settle-timeout-ms value")
  }

  return result
}

function textFromMessage(message: any) {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  return parts
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim()
}

function roleOf(message: any) {
  return message?.info?.role
}

function isCompleted(message: any) {
  return Boolean(message?.info?.time?.completed)
}

function hasAbortError(message: any) {
  const error = message?.info?.error
  if (!error || typeof error !== "object") return false
  const name = "name" in error ? String((error as any).name) : ""
  const messageText = "message" in error ? String((error as any).message) : ""
  return /aborted/i.test(name) || /aborted/i.test(messageText)
}

async function waitForSessionIdle(
  sessionID: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const messages = await Session.messages({ sessionID })
    const pending = messages.some((message) => roleOf(message) === "assistant" && !isCompleted(message))
    if (!pending) return
    await Bun.sleep(500)
  }
  throw new Error(`Timed out waiting for session ${sessionID} to become idle`)
}

async function waitForAssistantAfterUser(
  sessionID: string,
  userToken: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rows = (await Session.messages({ sessionID })) as any[]
    const userIndex = rows.findIndex((message) => roleOf(message) === "user" && textFromMessage(message).includes(userToken))
    if (userIndex >= 0) {
      const assistant = rows.slice(userIndex + 1).find((message) => roleOf(message) === "assistant")
      if (assistant && isCompleted(assistant)) {
        return {
          rows,
          assistant,
        }
      }
    }
    await Bun.sleep(500)
  }
  throw new Error(`Timed out waiting for assistant after user token ${userToken}`)
}

async function waitForAssistantStartAfterUser(
  sessionID: string,
  userToken: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rows = (await Session.messages({ sessionID })) as any[]
    const userIndex = rows.findIndex((message) => roleOf(message) === "user" && textFromMessage(message).includes(userToken))
    if (userIndex >= 0) {
      const assistant = rows.slice(userIndex + 1).find((message) => roleOf(message) === "assistant")
      if (assistant) {
        return {
          rows,
          assistant,
        }
      }
    }
    await Bun.sleep(250)
  }
  throw new Error(`Timed out waiting for assistant start after user token ${userToken}`)
}

async function runAttempt(
  agent: string,
  run: number,
  opts: Options,
): Promise<AttemptResult> {
  const firstToken = `ABORT_OLD_${agent}_${run}_${Date.now()}`
  const secondToken = `ABORT_NEW_${agent}_${run}_${Date.now()}`
  const session = await Session.create({ title: `abort-reprompt-${agent}-${run}` })
  const sessionID = session.id

  const firstIngress = await SessionMission.recordIngress({
    sessionID,
    agent,
    parts: [
      {
        type: "text",
        text:
          `Diagnostic warm-up for the session scheduler. Session marker: ${firstToken}. ` +
          `Please write a detailed response with at least 12 short bullet points explaining what an always-responsive coding orchestrator should do while background work is running.`,
      },
    ],
  })
  void SessionPrompt.loop(firstIngress.loopInput!)

  await waitForAssistantStartAfterUser(sessionID, firstToken, opts.startTimeoutMs)
  const sawFirstActivity = true
  await SessionPrompt.cancel(sessionID)
  const firstTurn = await waitForAssistantAfterUser(sessionID, firstToken, opts.settleTimeoutMs)
  const secondIngress = await SessionMission.recordIngress({
    sessionID,
    agent,
    steer: true,
    priority: "steer",
    parts: [
      {
        type: "text",
        text:
          `Diagnostic connectivity check for the harness after an interrupted turn. ` +
          `Reply with exactly ${secondToken} and no other text.`,
      },
    ],
  })
  void SessionPrompt.loop(secondIngress.loopInput!)

  await waitForSessionIdle(sessionID, opts.settleTimeoutMs)
  const secondTurn = await waitForAssistantAfterUser(sessionID, secondToken, opts.settleTimeoutMs)
  const latestAssistant = secondTurn.assistant
  const latestAssistantText = textFromMessage(latestAssistant)
  const latestAssistantErrored = Boolean((latestAssistant as any)?.info?.error)
  const firstAssistant = firstTurn.assistant
  const firstAssistantHasAbortError = hasAbortError(firstAssistant)
  const latestIncludesSecond = latestAssistantText.includes(secondToken)
  const latestIncludesFirst = latestAssistantText.includes(firstToken)
  const ok = sawFirstActivity && firstAssistantHasAbortError && latestIncludesSecond && !latestIncludesFirst

  return {
    run,
    ok,
    agent,
    sessionID,
    firstToken,
    secondToken,
    sawFirstActivity,
    latestAssistantText,
    latestAssistantErrored,
    firstAssistantHasAbortError,
    reason: ok
      ? undefined
      : JSON.stringify({
          sawFirstActivity,
          firstAssistantHasAbortError,
          latestAssistantErrored,
          latestIncludesSecond,
          latestIncludesFirst,
          latestAssistantText,
        }),
  }
}

const opts = parseArgs(process.argv.slice(2))

await Log.init({
  print: false,
  dev: true,
  level: "ERROR",
})

await bootstrap(process.cwd(), async () => {
  const results: AttemptResult[] = []

  for (let run = 1; run <= opts.runs; run++) {
    const result = await runAttempt(opts.agent, run, opts).catch((error) => {
      const err = error instanceof Error ? error.message : String(error)
      return {
        run,
        ok: false,
        agent: opts.agent,
        sessionID: "",
        firstToken: "",
        secondToken: "",
        sawFirstActivity: false,
        latestAssistantText: "",
        latestAssistantErrored: false,
        firstAssistantHasAbortError: false,
        reason: err,
      } satisfies AttemptResult
    })
    results.push(result)
    console.log(
      JSON.stringify(
        {
          type: "attempt",
          run: result.run,
          ok: result.ok,
          sessionID: result.sessionID,
          reason: result.reason,
          latestAssistantText: result.latestAssistantText,
        },
        null,
        2,
      ),
    )
  }

  const okCount = results.filter((item) => item.ok).length
  console.log(
    JSON.stringify(
      {
        type: "summary",
        agent: opts.agent,
        runs: opts.runs,
        passed: okCount,
        failed: results.length - okCount,
      },
      null,
      2,
    ),
  )

  if (okCount !== results.length) process.exitCode = 1
})
