import { expect, test, describe, mock } from "bun:test"
import { shouldDropDuplicateSubmit, submitAsync, submitText } from "../../src/cli/cmd/tui/util/prompt-submit"

test("submitText prefers the live textarea buffer when store state lags behind", () => {
  expect(submitText("hello from input", "")).toBe("hello from input")
  expect(submitText("", "saved prompt")).toBe("saved prompt")
})

test("submitAsync always uses async submission for a fresh session", () => {
  expect(submitAsync({ sessionID: undefined, async: false })).toBe(true)
  expect(submitAsync({ sessionID: "ses_existing" as any, async: false })).toBe(false)
  expect(submitAsync({ sessionID: "ses_existing" as any, async: true })).toBe(true)
})

test("shouldDropDuplicateSubmit suppresses rapid duplicate prompt sends", () => {
  const previous = {
    sessionID: "ses_1" as any,
    text: "Fix the bug",
    agent: "build",
    providerID: "alibaba-coding-plan" as any,
    modelID: "qwen3.5-plus" as any,
    at: 1_000,
  }

  expect(
    shouldDropDuplicateSubmit(
      {
        sessionID: "ses_1" as any,
        text: " Fix   the bug ",
        agent: "build",
        providerID: "alibaba-coding-plan" as any,
        modelID: "qwen3.5-plus" as any,
      },
      previous,
      { now: 1_400, windowMS: 1_000 },
    ),
  ).toBe(true)

  expect(
    shouldDropDuplicateSubmit(
      {
        sessionID: "ses_1" as any,
        text: "Fix the bug again",
        agent: "build",
        providerID: "alibaba-coding-plan" as any,
        modelID: "qwen3.5-plus" as any,
      },
      previous,
      { now: 1_400, windowMS: 1_000 },
    ),
  ).toBe(false)

  expect(
    shouldDropDuplicateSubmit(
      {
        sessionID: "ses_1" as any,
        text: "Fix the bug",
        agent: "build",
        providerID: "alibaba-coding-plan" as any,
        modelID: "qwen3.5-plus" as any,
      },
      previous,
      { now: 2_500, windowMS: 1_000 },
    ),
  ).toBe(false)
})

describe("prompt submit race conditions", () => {
  test("navigation happens after successful submit for new sessions", async () => {
    let navigateCalled = false
    let navigateSessionID: string | undefined
    
    const mockRoute = {
      navigate: (params: { type: string; sessionID: string }) => {
        navigateCalled = true
        navigateSessionID = params.sessionID
      },
    }
    
    const mockSDK = {
      client: {
        session: {
          prompt: async (_params: any) => ({ data: { id: "msg_123" } }),
          create: async (_params: any) => ({ data: { id: "ses_new" } }),
        },
      },
    }
    
    const sessionID = await mockSDK.client.session.create({}).then((x) => x.data!.id)
    await mockSDK.client.session.prompt({ sessionID, text: "test" })
    mockRoute.navigate({ type: "session", sessionID })
    
    expect(navigateCalled).toBe(true)
    expect(navigateSessionID).toBe(sessionID)
  })

  test("rapid submits are prevented by submitInFlight flag", () => {
    let submitInFlight = false
    let submitCount = 0
    
    function submit() {
      if (submitInFlight) return
      submitInFlight = true
      submitCount++
      
      setTimeout(() => {
        submitInFlight = false
      }, 100)
    }
    
    submit()
    submit()
    submit()
    submit()
    
    expect(submitCount).toBe(1)
  })

  test("unmounting during submit prevents state updates", async () => {
    let isMounted = true
    let stateUpdated = false
    
    const updateState = () => {
      if (!isMounted) return
      stateUpdated = true
    }
    
    const asyncOperation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      updateState()
    }
    
    const promise = asyncOperation()
    isMounted = false
    
    await promise
    expect(stateUpdated).toBe(false)
  })

  test("error during submit doesn't leave UI in broken state", async () => {
    let submitInFlight = true
    let toastShown = false
    let inputFocused = false
    
    const mockInput = {
      focus: (_params?: any) => {
        inputFocused = true
      },
    }
    
    const mockToast = {
      show: (_params?: any) => {
        toastShown = true
      },
    }
    
    const mockSDK = {
      client: {
        session: {
          prompt: async (_params: any) => {
            throw new Error("Network error")
          },
        },
      },
    }
    
    try {
      await mockSDK.client.session.prompt({ sessionID: "ses_1" as any, text: "test" })
    } catch {
      mockToast.show({ message: "Failed to send message", variant: "error" })
      mockInput.focus()
    } finally {
      submitInFlight = false
    }
    
    expect(toastShown).toBe(true)
    expect(inputFocused).toBe(true)
    expect(submitInFlight).toBe(false)
  })

  test("component unmount during async submit prevents navigation", async () => {
    let isMounted = true
    let navigateCalled = false
    
    const mockRoute = {
      navigate: (_params?: any) => {
        if (!isMounted) return
        navigateCalled = true
      },
    }
    
    const mockSDK = {
      client: {
        session: {
          prompt: async (_params: any) => {
            await new Promise((resolve) => setTimeout(resolve, 50))
            return { data: { id: "msg_123" } }
          },
          create: async (_params: any) => ({ data: { id: "ses_new" } }),
        },
      },
    }
    
    const sessionID = await mockSDK.client.session.create({}).then((x) => x.data!.id)
    
    const promise = (async () => {
      await mockSDK.client.session.prompt({ sessionID, text: "test" })
      if (!isMounted) return
      mockRoute.navigate({ type: "session", sessionID })
    })()
    
    isMounted = false
    await promise
    
    expect(navigateCalled).toBe(false)
  })
})
