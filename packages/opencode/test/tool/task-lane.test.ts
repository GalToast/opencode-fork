// @ts-nocheck - TODO: re-enable when task routing APIs are restored
import { describe, expect, test } from "bun:test"
import { applyTaskDisciplineEnvelope, resolveTaskRouting, selectTaskArtifactCandidate, getEffectiveDispatchLane } from "../../src/tool/task"
import { SchedulerControl } from "../../src/scheduler/control-plane"

describe("task lane routing", () => {
  test("routes explicit orchestrator hint to orchestrator swarm lane", () => {
    expect(
      resolveTaskRouting({
        laneHint: "orchestrator",
        description: "control plane router",
      }),
    ).toEqual({
      discipline: "orchestrator",
      schedulerLane: "orchestrator_swarm",
      swarmTemplate: "synthesize",
      expectedArtifact: "summary",
    })
  })

  test("routes explicit adversarial hint to adversarial review lane", () => {
    expect(
      resolveTaskRouting({
        laneHint: "adversarial",
        description: "red team critic",
      }),
    ).toEqual({
      discipline: "adversarial",
      schedulerLane: "adversarial_review",
      swarmTemplate: "review",
      expectedArtifact: "critique",
    })
  })

  test("infers adversarial routing from review-style prompts", () => {
    expect(
      resolveTaskRouting({
        laneHint: "auto",
        subagentType: "general",
        description: "Critic reviewer",
        prompt: "Red team this patch and find regressions",
      }),
    ).toEqual({
      discipline: "adversarial",
      schedulerLane: "adversarial_review",
      swarmTemplate: "review",
      expectedArtifact: "critique",
    })
  })

  test("does not treat ordinary lane review wording as adversarial by itself", () => {
    const routing = resolveTaskRouting({
      laneHint: "auto",
      subagentType: "explore",
      description: "Algorithmic correctness lane review",
      prompt: "Analyze src/math.ts for correctness only.",
    })

    expect(routing.discipline).toBe("research")
    expect(routing.schedulerLane).toBe("subagent_tasks")
  })

  test("still infers adversarial routing when review language includes regressions", () => {
    expect(
      resolveTaskRouting({
        laneHint: "auto",
        subagentType: "general",
        description: "Patch review",
        prompt: "Review this change for regressions and hidden risks.",
      }),
    ).toEqual({
      discipline: "adversarial",
      schedulerLane: "adversarial_review",
      swarmTemplate: "review",
      expectedArtifact: "critique",
    })
  })

  test("does not treat negated edit instructions as worker routing", () => {
    const routing = resolveTaskRouting({
      laneHint: "auto",
      subagentType: "explore",
      description: "Algorithmic correctness lane review",
      prompt: "Analyze src/math.ts for correctness only. Do not edit files.",
    })

    expect(routing.discipline).toBe("research")
    expect(routing.schedulerLane).toBe("subagent_tasks")
  })

  test("treats analysis-oriented lane prompts as research instead of worker", () => {
    const routing = resolveTaskRouting({
      laneHint: "auto",
      subagentType: "general",
      description: "API ergonomics lane",
      prompt: "Inspect src/strings.ts and analyze API ergonomics only.",
    })

    expect(routing.discipline).toBe("research")
    expect(routing.schedulerLane).toBe("subagent_tasks")
    expect(routing.swarmTemplate).toBe("search")
    expect(routing.expectedArtifact).toBe("fact")
  })

  test("corrects contradictory explicit worker hints on clearly analysis-only prompts", () => {
    const routing = resolveTaskRouting({
      laneHint: "worker",
      subagentType: "general",
      description: "Failure modes review",
      prompt: "Analyze src/buggy.ts for failure modes only. Do not edit files.",
    })

    expect(routing.discipline).toBe("research")
    expect(routing.schedulerLane).toBe("subagent_tasks")
    expect(routing.swarmTemplate).toBe("search")
    expect(routing.expectedArtifact).toBe("fact")
  })

  test("prefers worker routing when a follow-up asks to apply fixes after synthesis-style wording", () => {
    const routing = resolveTaskRouting({
      laneHint: "auto",
      subagentType: "general",
      description: "Compile critic results and apply improvements",
      prompt: "Summarize the critic findings, remove bad drafts, update the file, and clean up the remaining entries.",
    })

    expect(routing.discipline).toBe("worker")
    expect(routing.schedulerLane).toBe("subagent_tasks")
    expect(routing.swarmTemplate).toBe("patch")
    expect(routing.expectedArtifact).toBe("patch")
  })

  test("infers orchestrator routing from coordination prompts", () => {
    expect(
      resolveTaskRouting({
        laneHint: "auto",
        subagentType: "plan",
        description: "Swarm coordinator",
        prompt: "Dispatch workers and orchestrate the queue",
      }),
    ).toEqual({
      discipline: "orchestrator",
      schedulerLane: "orchestrator_swarm",
      swarmTemplate: "synthesize",
      expectedArtifact: "summary",
    })
  })

  test("keeps existing routing on follow-up messages unless overridden", () => {
    expect(
      resolveTaskRouting({
        laneHint: "auto",
        description: "follow-up",
        existing: {
          discipline: "adversarial",
          schedulerLane: "adversarial_review",
          swarmTemplate: "review",
          expectedArtifact: "critique",
        },
      }),
    ).toEqual({
      discipline: "adversarial",
      schedulerLane: "adversarial_review",
      swarmTemplate: "review",
      expectedArtifact: "critique",
    })
  })

  test("allows explicit swarm template and expected artifact overrides", () => {
    expect(
      resolveTaskRouting({
        laneHint: "worker",
        swarmTemplate: "verify",
        expectedArtifact: "test_result",
        description: "verification worker",
        prompt: "Run the checks.",
      }),
    ).toEqual({
      discipline: "worker",
      schedulerLane: "subagent_tasks",
      swarmTemplate: "verify",
      expectedArtifact: "test_result",
    })
  })

  test("infers verify swarm contract for worker verification prompts", () => {
    expect(
      resolveTaskRouting({
        laneHint: "worker",
        description: "verification worker",
        prompt: "Verify the patch and run regression tests.",
      }),
    ).toEqual({
      discipline: "worker",
      schedulerLane: "subagent_tasks",
      swarmTemplate: "verify",
      expectedArtifact: "test_result",
    })
  })

  test("adds orchestrator contract and swarm instructions to prompts", () => {
    const prompt = applyTaskDisciplineEnvelope({
      discipline: "orchestrator",
      description: "coordinate workers",
      swarmTemplate: "synthesize",
      expectedArtifact: "summary",
      prompt: "Fan out tasks and merge the results.",
    })

    expect(prompt).toContain("Operating discipline: orchestrator.")
    expect(prompt).toContain("Assigned task: coordinate workers")
    expect(prompt).toContain("Swarm template: synthesize.")
    expect(prompt).toContain('Return a primary artifact of type "summary"')
    expect(prompt).toContain("Fan out tasks and merge the results.")
  })

  test("adds adversarial contract to adversarial prompts", () => {
    const prompt = applyTaskDisciplineEnvelope({
      discipline: "adversarial",
      description: "review risky patch",
      swarmTemplate: "review",
      expectedArtifact: "critique",
      prompt: "Find hidden regressions in this change.",
    })

    expect(prompt).toContain("Operating discipline: adversarial reviewer.")
    expect(prompt).toContain("unsupported claims")
    expect(prompt).toContain('Return a primary artifact of type "critique"')
    expect(prompt).toContain("Find hidden regressions in this change.")
  })

  test("leaves general prompts untouched", () => {
    const prompt = applyTaskDisciplineEnvelope({
      discipline: "general",
      description: "normal task",
      prompt: "Do the thing.",
    })

    expect(prompt).toBe("Do the thing.")
  })

  test("selects the best sibling artifact for an orchestrator job", () => {
    const candidate = selectTaskArtifactCandidate({
      job: {
        taskID: "session_orchestrator",
        parentSessionID: "session_supervisor",
        swarmTemplate: "patch",
        expectedArtifact: "patch",
      },
      jobs: [
        {
          taskID: "session_worker_patch",
          parentSessionID: "session_supervisor",
          discipline: "worker",
          schedulerLane: "subagent_tasks",
          status: "completed",
          swarmTemplate: "patch",
          artifacts: [
            {
              id: "artifact_patch",
              type: "patch",
              summary: "Minimal patch is ready.",
              text: "Applied the minimal fix.",
              createdAt: Date.now(),
              template: "patch",
            },
          ],
        },
        {
          taskID: "session_research",
          parentSessionID: "session_supervisor",
          discipline: "research",
          schedulerLane: "subagent_tasks",
          status: "completed",
          swarmTemplate: "search",
          artifacts: [
            {
              id: "artifact_fact",
              type: "fact",
              summary: "Found a supporting source.",
              text: "Evidence bundle.",
              createdAt: Date.now(),
              template: "search",
            },
          ],
        },
      ],
    })

    expect(candidate?.taskID).toBe("session_worker_patch")
    expect(candidate?.type).toBe("patch")
    expect(candidate?.summary).toBe("Minimal patch is ready.")
  })
})

describe("scheduler lane dispatch correctness", () => {
  test("getEffectiveDispatchLane returns orchestrator_swarm for orchestrator routed jobs", () => {
    const lane = getEffectiveDispatchLane("orchestrator_swarm")
    expect(lane).toBe("orchestrator_swarm")
  })

  test("getEffectiveDispatchLane returns adversarial_review for adversarial routed jobs", () => {
    const lane = getEffectiveDispatchLane("adversarial_review")
    expect(lane).toBe("adversarial_review")
  })

  test("getEffectiveDispatchLane returns subagent_tasks for general routed jobs", () => {
    const lane = getEffectiveDispatchLane("subagent_tasks")
    expect(lane).toBe("subagent_tasks")
  })

  test("getEffectiveDispatchLane falls back to subagent_tasks for unknown lanes", () => {
    expect(getEffectiveDispatchLane("unknown_lane" as any)).toBe("subagent_tasks")
    expect(getEffectiveDispatchLane(undefined)).toBe("subagent_tasks")
    expect(getEffectiveDispatchLane("")).toBe("subagent_tasks")
  })

  test("getEffectiveDispatchLane validates against SchedulerControl.Lane enum", () => {
    const validLanes: SchedulerControl.Lane[] = [
      "user_ingress",
      "main_turns",
      "steer_fastlane",
      "orchestrator_swarm",
      "adversarial_review",
      "subagent_tasks",
      "tool_io",
      "longrun_jobs",
    ]
    for (const lane of validLanes) {
      expect(getEffectiveDispatchLane(lane)).toBe(lane)
    }
  })

  test("resolveTaskRouting sets orchestrator lane for orchestrator discipline", () => {
    const routing = resolveTaskRouting({
      laneHint: "orchestrator",
      description: "swarm coordinator",
      prompt: "Dispatch workers and coordinate the queue",
    })
    expect(routing.discipline).toBe("orchestrator")
    expect(routing.schedulerLane).toBe("orchestrator_swarm")
    expect(getEffectiveDispatchLane(routing.schedulerLane)).toBe("orchestrator_swarm")
  })

  test("resolveTaskRouting sets adversarial lane for adversarial discipline", () => {
    const routing = resolveTaskRouting({
      laneHint: "adversarial",
      description: "red team critic",
      prompt: "Critique this patch for regressions",
    })
    expect(routing.discipline).toBe("adversarial")
    expect(routing.schedulerLane).toBe("adversarial_review")
    expect(getEffectiveDispatchLane(routing.schedulerLane)).toBe("adversarial_review")
  })

  test("infers adversarial discipline from prompt content and routes correctly", () => {
    const routing = resolveTaskRouting({
      laneHint: "auto",
      description: "critic reviewer",
      prompt: "Red team this change and find hidden bugs",
    })
    expect(routing.discipline).toBe("adversarial")
    expect(routing.schedulerLane).toBe("adversarial_review")
    expect(getEffectiveDispatchLane(routing.schedulerLane)).toBe("adversarial_review")
  })
})
