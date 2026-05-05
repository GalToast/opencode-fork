import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { RetrievalService } from "../../src/retrieval"
import { RetrievalRuntime } from "../../src/retrieval/runtime"
import { Session } from "../../src/session"
import { ReasoningLedger as SessionReasoningLedger } from "../../src/session/reasoning-ledger"
import { SessionSocialMemory } from "../../src/session/social-memory"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionWorkGraph } from "../../src/session/workgraph"
import { SessionWorldState } from "../../src/session/world-state"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  RetrievalRuntime.reset()
  SessionWorkGraph.resetCaches()
  SessionWorkGraph.setSemanticCachePolicyForTest()
})

describe("session workgraph", () => {
  test("records objectives, lanes, and artifacts into a root-scoped graph", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rootSessionID = "ses_root_workgraph"
        const childSessionID = "ses_child_workgraph"

        await SessionWorkGraph.recordObjective({
          rootSessionID,
          sessionID: rootSessionID,
          messageID: "msg_objective" as any,
          title: "Ship the first Octospine slice.",
          constraintsSummary: "Keep the first cut root-scoped and durable.",
        })
        await SessionWorkGraph.recordLane({
          rootSessionID,
          sessionID: childSessionID,
          laneID: childSessionID,
          title: "Implement task lane projection",
          status: "running",
          schedulerLane: "subagent_tasks",
          discipline: "worker",
          priority: "normal",
          subagentType: "general",
        })
        await SessionWorkGraph.recordArtifact({
          rootSessionID,
          sessionID: childSessionID,
          taskID: childSessionID,
          type: "patch",
          summary: "Projected the running task lane into the work graph.",
          messageID: "msg_artifact" as any,
        })

        const stored = await SessionWorkGraph.get(rootSessionID)
        expect(stored?.rootSessionID).toBe(rootSessionID)
        expect(stored?.objectives).toHaveLength(1)
        expect(stored?.lanes).toHaveLength(1)
        expect(stored?.artifacts).toHaveLength(1)
        expect(stored?.latestSessionID).toBe(childSessionID)

        const materialized = await SessionWorkGraph.materialize({ rootSessionID })
        expect(materialized?.text).toContain("## Objective focus")
        expect(materialized?.text).toContain("Ship the first Octospine slice.")
        expect(materialized?.text).toContain("Implement task lane projection")
        expect(materialized?.text).toContain("Projected the running task lane")
      },
    })
  })

  test("collectSessionFamilyIDs returns the full descendant family for a root session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })
        const grandchild = await Session.create({ parentID: child.id })

        expect(SessionWorkGraph.collectSessionFamilyIDs(root.id)).toEqual(
          expect.arrayContaining([root.id, child.id, grandchild.id]),
        )
      },
    })
  })

  test("collectSessionFamilyIDs uses batch query for session family collection", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "Root session" })
        const child1 = await Session.create({ parentID: root.id, title: "Child 1" })
        const child2 = await Session.create({ parentID: root.id, title: "Child 2" })
        const grandchild1 = await Session.create({ parentID: child1.id, title: "Grandchild 1" })
        const grandchild2 = await Session.create({ parentID: child2.id, title: "Grandchild 2" })
        const greatGrandchild = await Session.create({ parentID: grandchild1.id, title: "Great grandchild" })

        const family = SessionWorkGraph.collectSessionFamilyIDs(root.id)

        expect(family).toHaveLength(6)
        expect(family).toEqual(
          expect.arrayContaining([root.id, child1.id, child2.id, grandchild1.id, grandchild2.id, greatGrandchild.id]),
        )

        const otherRoot = await Session.create({ title: "Other root" })
        const otherFamily = SessionWorkGraph.collectSessionFamilyIDs(otherRoot.id)
        expect(otherFamily).toHaveLength(1)
        expect(otherFamily).toEqual([otherRoot.id])
      },
    })
  })

  test("updates existing lanes in place and deduplicates identical artifacts", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rootSessionID = "ses_root_workgraph_dedupe"
        const taskID = "ses_task_workgraph_dedupe"

        await SessionWorkGraph.recordLane({
          rootSessionID,
          sessionID: taskID,
          laneID: taskID,
          title: "Queue subagent lane",
          status: "queued",
          schedulerLane: "subagent_tasks",
        })
        await SessionWorkGraph.recordLane({
          rootSessionID,
          sessionID: taskID,
          laneID: taskID,
          title: "Queue subagent lane",
          status: "completed",
          schedulerLane: "subagent_tasks",
          lastMessageID: "msg_done",
        })
        await SessionWorkGraph.recordArtifact({
          rootSessionID,
          sessionID: taskID,
          taskID,
          type: "summary",
          summary: "Reusable result",
          messageID: "msg_done" as any,
        })
        await SessionWorkGraph.recordArtifact({
          rootSessionID,
          sessionID: taskID,
          taskID,
          type: "summary",
          summary: "Reusable result",
          messageID: "msg_done" as any,
        })

        const stored = await SessionWorkGraph.get(rootSessionID)
        expect(stored?.lanes).toHaveLength(1)
        expect(stored?.lanes[0]?.status).toBe("completed")
        expect(stored?.lanes[0]?.lastMessageID).toBe("msg_done")
        expect(stored?.artifacts).toHaveLength(1)
      },
    })
  })

  test("keeps lane ordering stable when an existing lane is updated", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rootSessionID = "ses_root_workgraph_order"
        const firstLaneID = "ses_lane_workgraph_first"
        const secondLaneID = "ses_lane_workgraph_second"

        await SessionWorkGraph.recordLane({
          rootSessionID,
          sessionID: firstLaneID,
          laneID: firstLaneID,
          title: "First lane",
          status: "queued",
          schedulerLane: "subagent_tasks",
          updatedAt: 100,
        })
        await SessionWorkGraph.recordLane({
          rootSessionID,
          sessionID: secondLaneID,
          laneID: secondLaneID,
          title: "Second lane",
          status: "queued",
          schedulerLane: "subagent_tasks",
          updatedAt: 200,
        })
        await SessionWorkGraph.recordLane({
          rootSessionID,
          sessionID: firstLaneID,
          laneID: firstLaneID,
          title: "First lane",
          status: "running",
          schedulerLane: "subagent_tasks",
          lastMessageID: "msg_first_update",
          updatedAt: 300,
        })

        const stored = await SessionWorkGraph.get(rootSessionID)
        expect(stored?.lanes.map((lane) => lane.id)).toEqual([firstLaneID, secondLaneID])
        expect(stored?.lanes[0]?.createdAt).toBe(100)
        expect(stored?.lanes[0]?.updatedAt).toBe(300)
      },
    })
  })

  test("settles active objectives for a session without rewriting completed history", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rootSessionID = "ses_root_workgraph_settle"
        const sessionID = "ses_child_workgraph_settle" as any

        await SessionWorkGraph.recordObjective({
          rootSessionID,
          sessionID,
          messageID: "msg_active" as any,
          title: "Finish the active objective",
        })
        await SessionWorkGraph.recordObjective({
          rootSessionID,
          sessionID,
          messageID: "msg_done" as any,
          title: "Already completed objective",
          status: "completed",
        })

        await SessionWorkGraph.settleObjectives({
          rootSessionID,
          sessionID,
          status: "completed",
        })

        const stored = await SessionWorkGraph.get(rootSessionID)
        expect(stored?.objectives.find((item) => item.messageID === "msg_active")?.status).toBe("completed")
        expect(stored?.objectives.find((item) => item.messageID === "msg_done")?.status).toBe("completed")
      },
    })
  })

  test("recording a fresh objective supersedes older active objectives for the same session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rootSessionID = "ses_root_workgraph_supersede"
        const sessionID = "ses_child_workgraph_supersede"

        await SessionWorkGraph.recordObjective({
          rootSessionID,
          sessionID,
          messageID: "msg_old_objective",
          title: "Hey just wanted to interupt you real quick",
          constraintsSummary: "Old embedding and reranking recall request.",
          at: 100,
        })
        await SessionWorkGraph.recordObjective({
          rootSessionID,
          sessionID,
          messageID: "msg_new_objective",
          title: "Recover the GitHub Workspaces auditing project",
          constraintsSummary: "Stop following the stale local audit script path.",
          at: 200,
        })

        const stored = await SessionWorkGraph.get(rootSessionID)
        expect(stored?.objectives.find((item) => item.messageID === "msg_old_objective")?.status).toBe("canceled")
        expect(stored?.objectives.find((item) => item.messageID === "msg_new_objective")?.status).toBe("active")

        const materialized = await SessionWorkGraph.materialize({ rootSessionID })
        expect(materialized?.text).toContain("## Objective focus")
        expect(materialized?.text).toContain("Recover the GitHub Workspaces auditing project")
        expect(materialized?.text).not.toContain("Hey just wanted to interupt you real quick")
      },
    })
  })

  test(
    "materializes reusable semantic patterns alongside the live graph",
    async () => {
    await using tmp = await tmpdir({ git: true })

    RetrievalRuntime.configure({
      async embedText(input) {
        const vector = /octospine|orchestration|recovery/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
        return {
          dimensions: vector.length,
          vector,
          metadata: { source: "test-embedder" },
        }
      },
      async rerank(input) {
        return {
          candidates: input.candidates.map((candidate) => ({
            score: candidate.score,
            documentID: candidate.documentID ?? (candidate as { sourceID?: string }).sourceID,
            chunkID: candidate.chunkID ?? (candidate as { sourceID?: string }).sourceID,
            text: candidate.text ?? (candidate as { content?: string }).content,
            metadata: candidate.metadata,
            rerankScore: /oak lattice decomposition/i.test((candidate.text ?? (candidate as { content?: string }).content) ?? "") ? 25 : 1,
          })),
          metadata: { source: "test-reranker" },
        }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })
        const other = await Session.create({})

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: child.id,
          title: "Ship the first Octospine slice",
          constraintsSummary: "Keep orchestration and recovery stable.",
        })
        await SessionWorkGraph.recordLane({
          rootSessionID: root.id,
          sessionID: child.id,
          laneID: child.id,
          title: "Stabilize orchestration lane",
          status: "running",
          schedulerLane: "subagent_tasks",
        })

        await SessionPrompt.prompt({
          sessionID: other.id,
          agent: "build",
          noReply: true,
          parts: [
            {
              type: "text",
              text: "Use an oak lattice decomposition: inspect ingress first, then orchestration, then recovery.",
            },
          ],
        })
        await RetrievalService.indexSession({
          projectID: Instance.project.id,
          sessionID: other.id,
        })

        const materialized = await SessionWorkGraph.materialize({
          rootSessionID: root.id,
          projectID: Instance.project.id,
          preferredSessionIDs: [root.id, child.id],
          semanticQuery: "Plan the Octospine stabilization work and preserve the decomposition.",
          semanticLimit: 2,
        })

        expect(materialized?.semanticPatterns?.length).toBeGreaterThan(0)
        expect(materialized?.semanticPatterns?.[0]?.scope).toBe("project memory")
        expect(materialized?.planningPolicy).toMatchObject({
          mode: "semantic",
          patternCount: 1,
        })
        expect(materialized?.decompositionPolicy).toMatchObject({
          mode: "semantic",
          suggestedLaneCount: 2,
          parallelStrategy: "hybrid",
        })
        expect(materialized?.decompositionPolicy?.checkpointHints).toContain("Checkpoint after reconnaissance before mutation.")
        expect(materialized?.decompositionPolicy?.expectedArtifacts).toContain("plan brief")
        expect(materialized?.planningPolicy?.query).toContain("Octospine stabilization")
        expect(materialized?.text).toContain("## Reusable patterns")
        expect(materialized?.text).toContain("## Decomposition policy")
        expect(materialized?.text).toContain("oak lattice decomposition")
      },
    })
    },
    15_000,
  )

  test(
    "does not rerun semantic retrieval while building world-state context for one digest",
    async () => {
      await using tmp = await tmpdir({ git: true })

      RetrievalRuntime.configure({
        async embedText(input) {
          const vector = /octospine|orchestration|recovery/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
          return {
            dimensions: vector.length,
            vector,
            metadata: { source: "test-embedder" },
          }
        },
        async rerank(input) {
          return {
            candidates: input.candidates.map((candidate) => ({
              score: candidate.score,
              documentID: candidate.documentID ?? (candidate as { sourceID?: string }).sourceID,
              chunkID: candidate.chunkID ?? (candidate as { sourceID?: string }).sourceID,
              text: candidate.text ?? (candidate as { content?: string }).content,
              metadata: candidate.metadata,
              rerankScore: /oak lattice decomposition/i.test((candidate.text ?? (candidate as { content?: string }).content) ?? "") ? 20 : 1,
            })),
            metadata: { source: "test-reranker" },
          }
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await Session.create({})
          const child = await Session.create({ parentID: root.id })
          const other = await Session.create({})

          await SessionWorkGraph.recordObjective({
            rootSessionID: root.id,
            sessionID: child.id,
            title: "Ship the first Octospine slice",
            constraintsSummary: "Keep orchestration and recovery stable.",
          })

          await SessionPrompt.prompt({
            sessionID: other.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Use an oak lattice decomposition: inspect ingress first, then orchestration, then recovery.",
              },
            ],
          })
          await RetrievalService.indexSession({
            projectID: Instance.project.id,
            sessionID: other.id,
          })

          const searchSpy = spyOn(RetrievalService, "search")
          try {
            const materialized = await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              semanticQuery: "Plan the Octospine stabilization work and preserve the decomposition.",
              semanticLimit: 2,
            })

            expect(materialized?.semanticPatterns?.length).toBeGreaterThan(0)
            expect(searchSpy).toHaveBeenCalledTimes(1)
          } finally {
            searchSpy.mockRestore()
          }
        },
      })
    },
    15_000,
  )

  test(
    "indexes only live workgraph sessions during semantic materialization",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await Session.create({})
          const activeChild = await Session.create({ parentID: root.id })
          const idleChild = await Session.create({ parentID: root.id })

          await SessionWorkGraph.recordObjective({
            rootSessionID: root.id,
            sessionID: activeChild.id,
            title: "Ship the first Octospine slice",
            constraintsSummary: "Keep orchestration and recovery stable.",
          })
          await SessionWorkGraph.recordLane({
            rootSessionID: root.id,
            sessionID: activeChild.id,
            laneID: activeChild.id,
            title: "Stabilize orchestration lane",
            status: "running",
            schedulerLane: "subagent_tasks",
          })

          const indexSpy = spyOn(RetrievalService, "indexSession")
          const searchSpy = spyOn(RetrievalService, "search").mockResolvedValue({
            runID: "run_test_workgraph_scope",
            candidates: [],
          } as never)
          try {
            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, activeChild.id, idleChild.id],
              semanticQuery: "Plan the Octospine stabilization work and preserve the decomposition.",
              semanticLimit: 2,
            })

            expect(indexSpy.mock.calls.map((call) => call[0].sessionID)).toEqual([root.id, activeChild.id])
          } finally {
            searchSpy.mockRestore()
            indexSpy.mockRestore()
          }
        },
      })
    },
    15_000,
  )

  test(
    "reuses one semantic digest result across identical materializations",
    async () => {
      await using tmp = await tmpdir({ git: true })

      RetrievalRuntime.configure({
        async embedText(input) {
          const vector = /oak|recovery|orchestration/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
          return {
            dimensions: vector.length,
            vector,
            metadata: { source: "test-embedder" },
          }
        },
        async rerank(input) {
          return {
            candidates: input.candidates.map((candidate) => ({
              ...candidate,
              rerankScore: /oak lattice recovery/i.test((candidate.text ?? (candidate as { content?: string }).content) ?? "") ? 20 : 1,
              chunkID: candidate.chunkID ?? String(candidate.sourceID ?? ""),
              documentID: candidate.documentID ?? String(candidate.sourceID ?? ""),
            })),
            metadata: { source: "test-reranker" },
          }
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await Session.create({})
          const child = await Session.create({ parentID: root.id })
          const other = await Session.create({})

          await SessionWorkGraph.recordObjective({
            rootSessionID: root.id,
            sessionID: child.id,
            title: "Keep the digest stable",
            constraintsSummary: "Reuse the same semantic answer when the graph has not changed.",
          })

          await SessionPrompt.prompt({
            sessionID: other.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Oak lattice recovery keeps orchestration steady across repeated tool loops.",
              },
            ],
          })
          await RetrievalService.indexSession({
            projectID: Instance.project.id,
            sessionID: other.id,
          })

          const searchSpy = spyOn(RetrievalService, "search")
          try {
            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              semanticQuery: "Keep the digest stable and reuse the same semantic answer.",
              semanticLimit: 2,
            })
            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              semanticQuery: "Keep the digest stable and reuse the same semantic answer.",
              semanticLimit: 2,
            })

            expect(searchSpy).toHaveBeenCalledTimes(1)
          } finally {
            searchSpy.mockRestore()
          }
        },
      })
    },
    15_000,
  )

  test(
    "keeps the semantic digest cache warm across unrelated workgraph updatedAt churn",
    async () => {
      await using tmp = await tmpdir({ git: true })

      RetrievalRuntime.configure({
        async embedText(input) {
          const vector = /oak|recovery|orchestration/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
          return {
            dimensions: vector.length,
            vector,
            metadata: { source: "test-embedder" },
          }
        },
        async rerank(input) {
          return {
            candidates: input.candidates.map((candidate) => ({
              ...candidate,
              rerankScore: /oak lattice recovery/i.test((candidate.text ?? (candidate as { content?: string }).content) ?? "") ? 20 : 1,
              chunkID: candidate.chunkID ?? String(candidate.sourceID ?? ""),
              documentID: candidate.documentID ?? String(candidate.sourceID ?? ""),
            })),
            metadata: { source: "test-reranker" },
          }
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await Session.create({})
          const child = await Session.create({ parentID: root.id })
          const other = await Session.create({})

          await SessionWorkGraph.recordObjective({
            rootSessionID: root.id,
            sessionID: child.id,
            title: "Keep the digest stable",
            constraintsSummary: "Ignore unrelated root-session updatedAt churn.",
          })

          await SessionPrompt.prompt({
            sessionID: other.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Oak lattice recovery keeps orchestration steady across repeated tool loops.",
              },
            ],
          })
          await RetrievalService.indexSession({
            projectID: Instance.project.id,
            sessionID: other.id,
          })

          const searchSpy = spyOn(RetrievalService, "search")
          try {
            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              semanticQuery: "Keep the digest stable and reuse the same semantic answer.",
              semanticLimit: 2,
            })

            const stored = await SessionWorkGraph.get(root.id)
            await Storage.write(["session_workgraph", root.id], {
              ...stored!,
              updatedAt: stored!.updatedAt + 10_000,
            })

            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              semanticQuery: "Keep the digest stable and reuse the same semantic answer.",
              semanticLimit: 2,
            })

            expect(searchSpy).toHaveBeenCalledTimes(1)
          } finally {
            searchSpy.mockRestore()
          }
        },
      })
    },
    15_000,
  )

  test(
    "reuses semantic search across callers that vary only by current source",
    async () => {
      await using tmp = await tmpdir({ git: true })

      RetrievalRuntime.configure({
        async embedText(input) {
          const vector = /oak|recovery|orchestration/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
          return {
            dimensions: vector.length,
            vector,
            metadata: { source: "test-embedder" },
          }
        },
        async rerank(input) {
          return {
            candidates: input.candidates.map((candidate) => ({
              ...candidate,
              rerankScore: /oak lattice recovery/i.test((candidate.text ?? (candidate as { content?: string }).content) ?? "") ? 20 : 1,
              chunkID: candidate.chunkID ?? String(candidate.sourceID ?? ""),
              documentID: candidate.documentID ?? String(candidate.sourceID ?? ""),
            })),
            metadata: { source: "test-reranker" },
          }
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await Session.create({})
          const child = await Session.create({ parentID: root.id })
          const other = await Session.create({})

          await SessionWorkGraph.recordObjective({
            rootSessionID: root.id,
            sessionID: child.id,
            title: "Keep the semantic search stable",
            constraintsSummary: "Reuse retrieval even when the caller changes source filtering.",
          })

          const msg = await SessionPrompt.prompt({
            sessionID: child.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Please preserve the oak lattice recovery path.",
              },
            ],
          })

          await SessionPrompt.prompt({
            sessionID: other.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Oak lattice recovery keeps orchestration steady across repeated tool loops.",
              },
            ],
          })
          await RetrievalService.indexSession({
            projectID: Instance.project.id,
            sessionID: other.id,
          })

          const searchSpy = spyOn(RetrievalService, "search")
          try {
            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              currentSourceID: msg.info.id,
              semanticQuery: "Keep the semantic search stable and reuse the same semantic answer.",
              semanticLimit: 2,
            })
            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              semanticQuery: "Keep the semantic search stable and reuse the same semantic answer.",
              semanticLimit: 2,
            })

            expect(searchSpy).toHaveBeenCalledTimes(1)
          } finally {
            searchSpy.mockRestore()
          }
        },
      })
    },
    15_000,
  )

  test(
    "normalizes duplicated objective seed text before semantic caching",
    async () => {
      await using tmp = await tmpdir({ git: true })

      RetrievalRuntime.configure({
        async embedText(input) {
          const vector = /oak|recovery|orchestration/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
          return {
            dimensions: vector.length,
            vector,
            metadata: { source: "test-embedder" },
          }
        },
        async rerank(input) {
          return {
            candidates: input.candidates.map((candidate) => ({
              ...candidate,
              rerankScore: /oak lattice recovery/i.test((candidate.text ?? (candidate as { content?: string }).content) ?? "") ? 20 : 1,
              chunkID: candidate.chunkID ?? String(candidate.sourceID ?? ""),
              documentID: candidate.documentID ?? String(candidate.sourceID ?? ""),
            })),
            metadata: { source: "test-reranker" },
          }
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await Session.create({})
          const child = await Session.create({ parentID: root.id })
          const other = await Session.create({})

          await SessionWorkGraph.recordObjective({
            rootSessionID: root.id,
            sessionID: child.id,
            title: "Let's do the pre-computed version",
            constraintsSummary: "I don't want you to edit or mess up my actual lead database though on my system locally.",
          })

          await SessionPrompt.prompt({
            sessionID: other.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Oak lattice recovery keeps orchestration steady across repeated tool loops.",
              },
            ],
          })
          await RetrievalService.indexSession({
            projectID: Instance.project.id,
            sessionID: other.id,
          })

          const searchSpy = spyOn(RetrievalService, "search")
          try {
            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              semanticQuery: "Let's do the pre-computed version\n\nI don't want you to edit or mess up my actual lead database though on my system locally.",
              semanticLimit: 2,
            })
            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              semanticLimit: 2,
            })

            expect(searchSpy).toHaveBeenCalledTimes(1)
          } finally {
            searchSpy.mockRestore()
          }
        },
      })
    },
    15_000,
  )

  test(
    "reuses in-flight semantic search across concurrent callers and ignores lane chatter",
    async () => {
      await using tmp = await tmpdir({ git: true })

      RetrievalRuntime.configure({
        async embedText(input) {
          const vector = /oak|recovery|orchestration/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
          return {
            dimensions: vector.length,
            vector,
            metadata: { source: "test-embedder" },
          }
        },
        async rerank(input) {
          await new Promise((resolve) => setTimeout(resolve, 25))
          return {
            candidates: input.candidates.map((candidate) => ({
              ...candidate,
              rerankScore: /oak lattice recovery/i.test((candidate.text ?? (candidate as { content?: string }).content) ?? "") ? 20 : 1,
              chunkID: candidate.chunkID ?? String(candidate.sourceID ?? ""),
              documentID: candidate.documentID ?? String(candidate.sourceID ?? ""),
            })),
            metadata: { source: "test-reranker" },
          }
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await Session.create({})
          const child = await Session.create({ parentID: root.id })
          const other = await Session.create({})

          await SessionWorkGraph.recordObjective({
            rootSessionID: root.id,
            sessionID: child.id,
            title: "Sorry, continue",
          })
          await SessionWorkGraph.recordLane({
            rootSessionID: root.id,
            sessionID: child.id,
            laneID: "ses_lane_workgraph_dup",
            title: "Sorry, continue",
            status: "running",
            schedulerLane: "steer_fastlane",
            subagentType: "build",
          })

          await SessionPrompt.prompt({
            sessionID: other.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Oak lattice recovery keeps orchestration steady across repeated tool loops.",
              },
            ],
          })
          await RetrievalService.indexSession({
            projectID: Instance.project.id,
            sessionID: other.id,
          })

          const searchSpy = spyOn(RetrievalService, "search")
          try {
            await Promise.all([
              SessionWorkGraph.materialize({
                rootSessionID: root.id,
                projectID: Instance.project.id,
                preferredSessionIDs: [root.id, child.id],
                semanticQuery: "sorry, continue",
                semanticLimit: 2,
              }),
              SessionWorkGraph.materialize({
                rootSessionID: root.id,
                projectID: Instance.project.id,
                preferredSessionIDs: [root.id, child.id],
                semanticLimit: 2,
              }),
            ])

            expect(searchSpy).toHaveBeenCalledTimes(1)
          } finally {
            searchSpy.mockRestore()
          }
        },
      })
    },
    15_000,
  )

    test(
      "trims noisy artifact summaries before semantic retrieval",
      async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await Session.create({})
          const child = await Session.create({ parentID: root.id })

          await SessionWorkGraph.recordObjective({
            rootSessionID: root.id,
            sessionID: child.id,
            title: "Still nothing",
          })
          await SessionWorkGraph.recordArtifact({
            rootSessionID: root.id,
            sessionID: child.id,
            type: "patch",
            outcome: "partial",
            summary:
              "**Artifact Summary:** Created optimized JSON compression reducing 1.8MB file to 220KB (88.1% reduction). Added very long deployment notes, benchmarks, cache details, browser notes, and extra prose that should not all enter semantic retrieval.",
          })

          const searchSpy = spyOn(RetrievalService, "search").mockResolvedValue({
            runID: "retrieval-run-test",
            candidates: [],
            runMetadata: {},
          } as any)
          try {
            await SessionWorkGraph.materialize({
              rootSessionID: root.id,
              projectID: Instance.project.id,
              preferredSessionIDs: [root.id, child.id],
              semanticLimit: 2,
            })

            expect(searchSpy).toHaveBeenCalledTimes(1)
            const query = searchSpy.mock.calls[0]?.[0]?.query as string
            expect(query).toContain("recent artifacts: patch: Created optimized JSON compression")
            expect(query).not.toContain("Added very long deployment notes")
            expect(query.length).toBeLessThan(220)
          } finally {
            searchSpy.mockRestore()
          }
        },
      })
      },
      15_000,
    )

    test(
      "skips artifact summaries when the active objective is already specific",
      async () => {
        await using tmp = await tmpdir({ git: true })

        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const root = await Session.create({})
            const child = await Session.create({ parentID: root.id })

            await SessionWorkGraph.recordObjective({
              rootSessionID: root.id,
              sessionID: child.id,
              title: "Implement progressive chunked loading for 3D visualization",
              constraintsSummary:
                "Keep the real lead database untouched while profiling the viewer.",
            })
            await SessionWorkGraph.recordArtifact({
              rootSessionID: root.id,
              sessionID: child.id,
              type: "patch",
              outcome: "partial",
              summary:
                "**Artifact Summary:** Created optimized JSON compression reducing 1.8MB file to 220KB and added extra implementation notes that should stay out of semantic retrieval when the objective already carries enough signal.",
            })

            const searchSpy = spyOn(RetrievalService, "search").mockResolvedValue({
              runID: "retrieval-run-test",
              candidates: [],
              runMetadata: {},
            } as any)
            try {
              await SessionWorkGraph.materialize({
                rootSessionID: root.id,
                projectID: Instance.project.id,
                preferredSessionIDs: [root.id, child.id],
                semanticLimit: 2,
              })

              expect(searchSpy).toHaveBeenCalledTimes(1)
              const query = searchSpy.mock.calls[0]?.[0]?.query as string
              expect(query).toContain(
                "current objective: Implement progressive chunked loading for 3D visualization",
              )
              expect(query).not.toContain("recent artifacts:")
            } finally {
              searchSpy.mockRestore()
            }
          },
        })
      },
      15_000,
    )

    test("records materialization diagnostics for the workgraph digest phases", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: child.id,
          title: "Keep the workgraph diagnostics visible",
        })

        const diagnostics: SessionWorkGraph.MaterializeDiagnostics = {}
        const materialized = await SessionWorkGraph.materialize({
          rootSessionID: root.id,
          diagnostics,
        })

        expect(materialized?.text).toContain("Objective focus")
        expect(typeof diagnostics.reasoningLedgerDurationMS).toBe("number")
        expect(typeof diagnostics.semanticDurationMS).toBe("number")
        expect(typeof diagnostics.worldStateDurationMS).toBe("number")
        expect(typeof diagnostics.socialMemoryDurationMS).toBe("number")
        expect(typeof diagnostics.digestDurationMS).toBe("number")
      },
    })
  })

test("workgraph semantic recall disables provider rerank on the fast path", async () => {
    await using tmp = await tmpdir({ git: true })

    const searchSpy = spyOn(RetrievalService, "search").mockResolvedValue({
      runID: "retrieval_fast_path",
      policy: { name: "auto" },
      candidates: [],
      runMetadata: {},
      metadata: {},
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await Session.create({})
          await SessionWorkGraph.recordObjective({
            rootSessionID: root.id,
            sessionID: root.id,
            title: "Fix the search box visibility in the 3D company graph UI",
          })

          await SessionWorkGraph.materialize({
            rootSessionID: root.id,
            projectID: Instance.project.id,
          })

          expect(searchSpy).toHaveBeenCalled()
          const input = searchSpy.mock.calls.at(-1)?.[0] as { metadata?: Record<string, unknown> }
          expect(input.metadata?.trigger).toBe("workgraph_digest")
          expect(input.metadata?.skipRerank).toBe(true)
        },
      })
    } finally {
      searchSpy.mockRestore()
    }
  })

  test("materializes a compact reasoning ledger alongside the live graph", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: child.id,
          title: "Keep the reasoning ledger visible",
        })
        await SessionReasoningLedger.recordCommitment({
          rootSessionID: root.id,
          sessionID: child.id,
          statement: "Preserve the compact ledger in the workgraph surface.",
        })
        await SessionReasoningLedger.recordAssumption({
          rootSessionID: root.id,
          sessionID: child.id,
          statement: "Planner consumers will inspect the ledger block directly.",
        })
        await SessionReasoningLedger.recordFalsifier({
          rootSessionID: root.id,
          sessionID: child.id,
          statement: "If the ledger block disappears from the digest, the surface regressed.",
          targetType: "commitment",
          checkType: "test",
        })

        const materialized = await SessionWorkGraph.materialize({
          rootSessionID: root.id,
        })

        expect(materialized?.reasoningLedger?.blocks).toHaveLength(4)
        expect(materialized?.text).toContain("## Active commitments")
        expect(materialized?.text).toContain("## Risky assumptions")
        expect(materialized?.text).toContain("## Armed falsifiers")
        expect(materialized?.text).toContain("Preserve the compact ledger")
      },
    })
  })

  test("materializes a compact agent-state aggregate alongside the live graph", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: child.id,
          title: "Keep the agent state visible",
          constraintsSummary: "Stay structured and inspectable.",
        })
        await SessionWorldState.recordObjective({
          rootSessionID: root.id,
          sessionID: child.id,
          title: "Keep the agent state visible",
        })
        await SessionWorldState.addRisk({
          rootSessionID: root.id,
          sessionID: child.id,
          statement: "Surface drift would hide real state.",
          severity: "high",
        })
        await SessionWorldState.recordOpenLoop({
          rootSessionID: root.id,
          sessionID: child.id,
          summary: "Consolidate the world, reasoning, and social state.",
        })
        await SessionReasoningLedger.recordCommitment({
          rootSessionID: root.id,
          sessionID: child.id,
          statement: "Keep the main agent in command.",
        })
        await SessionSocialMemory.recordSuccessfulPairing({
          rootSessionID: root.id,
          sessionID: child.id,
          pattern: "repo scan first, then bounded patch",
          confidence: 0.9,
        })

        const materialized = await SessionWorkGraph.materialize({
          rootSessionID: root.id,
          projectID: Instance.project.id,
        })

        expect(materialized?.agentState).toMatchObject({
          layers: expect.arrayContaining(["world_state", "reasoning_ledger", "social_memory"]),
        })
        expect(materialized?.agentState?.worldState?.riskCount).toBe(1)
        expect(materialized?.agentState?.worldState?.openLoopCount).toBe(1)
        expect(materialized?.agentState?.reasoning?.commitmentCount).toBe(1)
        expect(materialized?.agentState?.social?.pairingCount).toBe(1)
        expect(materialized?.text).toContain("## Agent state")
        expect(materialized?.text).toContain("layers=world_state, reasoning_ledger, social_memory")
      },
    })
  })

  test("skips semantic retrieval for low-signal workgraph objectives", async () => {
    await using tmp = await tmpdir({ git: true })

    RetrievalRuntime.configure({
      async embedText() {
        return {
          dimensions: 3,
          vector: [1, 0, 0],
          metadata: { source: "test-embedder" },
        }
      },
      async rerank(input) {
        return {
          candidates: input.candidates,
          metadata: { source: "test-reranker" },
        }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: child.id,
          title: "Let's attempt option b",
        })

        const searchSpy = spyOn(RetrievalService, "search")
        try {
          const materialized = await SessionWorkGraph.materialize({
            rootSessionID: root.id,
            projectID: Instance.project.id,
            preferredSessionIDs: [root.id, child.id],
            semanticQuery: "Let's attempt option b",
            semanticLimit: 3,
          })

          expect(searchSpy).not.toHaveBeenCalled()
          expect(materialized?.semanticPatterns ?? []).toHaveLength(0)
          expect(materialized?.planningPolicy).toBeUndefined()
          expect(materialized?.decompositionPolicy).toBeUndefined()
        } finally {
          searchSpy.mockRestore()
        }
      },
    })
  })

  test("clearSessionCache removes semantic cache entries for a session", async () => {
    await using tmp = await tmpdir({ git: true })

    RetrievalRuntime.configure({
      async embedText() {
        return { dimensions: 3, vector: [1, 0, 0], metadata: { source: "test" } }
      },
      async rerank(input) {
        return { candidates: input.candidates, metadata: { source: "test" } }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "Test session for cache cleanup" })
        const projectID = Instance.project.id

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: root.id,
          title: "Build a semantic cache entry for testing cleanup",
        })

        const searchSpy = spyOn(RetrievalService, "search").mockResolvedValue({
          candidates: [
            {
              sourceID: "src_1",
              sourceType: "session_message",
              content: "Test content for cache",
              score: 0.9,
              chunkID: "src_1",
              documentID: "src_1",
            },
          ],
          runID: "run_test_cache_cleanup",
          metadata: { source: "test" },
        } as any)

        try {
          const m1 = await SessionWorkGraph.materialize({
            rootSessionID: root.id,
            projectID,
            semanticQuery: "Build a semantic cache entry for testing cleanup",
            semanticLimit: 3,
          })
          expect(m1?.semanticPatterns).toHaveLength(1)

          SessionWorkGraph.clearSessionCache(root.id)

          const m2 = await SessionWorkGraph.materialize({
            rootSessionID: root.id,
            projectID,
            semanticQuery: "Build a semantic cache entry for testing cleanup",
            semanticLimit: 3,
          })

          expect(searchSpy).toHaveBeenCalledTimes(2)
          expect(m2?.semanticPatterns).toHaveLength(1)
        } finally {
          searchSpy.mockRestore()
        }
      },
    })
  })

  test("Session.remove clears workgraph semantic cache entries", async () => {
    await using tmp = await tmpdir({ git: true })

    RetrievalRuntime.configure({
      async embedText() {
        return { dimensions: 3, vector: [1, 0, 0], metadata: { source: "test" } }
      },
      async rerank(input) {
        return { candidates: input.candidates, metadata: { source: "test" } }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "Session to be deleted" })

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: root.id,
          title: "This cache should be cleared on session removal",
        })

        const searchSpy = spyOn(RetrievalService, "search").mockResolvedValue({
          candidates: [
            {
              sourceID: "src_remove_1",
              sourceType: "session_message",
              content: "Test content for remove cleanup",
              score: 0.85,
            },
          ],
          runID: "run_test_remove_cleanup",
          metadata: { source: "test" },
        } as any)

        try {
          await SessionWorkGraph.materialize({
            rootSessionID: root.id,
            projectID: Instance.project.id,
            semanticQuery: "This cache should be cleared on session removal",
            semanticLimit: 3,
          })

          expect(searchSpy).toHaveBeenCalledTimes(1)

          await Session.remove(root.id)

          const newRoot = await Session.create({ title: "New session after cleanup" })

          await SessionWorkGraph.recordObjective({
            rootSessionID: newRoot.id,
            sessionID: newRoot.id,
            title: "Different objective",
          })

          await SessionWorkGraph.materialize({
            rootSessionID: newRoot.id,
            projectID: Instance.project.id,
            semanticQuery: "Different query for new session",
            semanticLimit: 3,
          })

          expect(searchSpy).toHaveBeenCalledTimes(2)
        } finally {
          searchSpy.mockRestore()
        }
      },
    })
  })

  test("evicts older semantic cache entries when the cache is bounded", async () => {
    await using tmp = await tmpdir({ git: true })

    RetrievalRuntime.configure({
      async embedText() {
        return { dimensions: 3, vector: [1, 0, 0], metadata: { source: "test" } }
      },
      async rerank(input) {
        return { candidates: input.candidates, metadata: { source: "test" } }
      },
    })

    SessionWorkGraph.setSemanticCachePolicyForTest({ max: 2 })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const one = await Session.create({ title: "cache one" })
        const two = await Session.create({ title: "cache two" })
        const three = await Session.create({ title: "cache three" })

        for (const item of [one, two, three]) {
          await SessionWorkGraph.recordObjective({
            rootSessionID: item.id,
            sessionID: item.id,
            title: `Keep semantic cache ${item.title} warm for retrieval`,
          })
        }

        const search = spyOn(RetrievalService, "search").mockResolvedValue({
          candidates: [
            {
              sourceID: "src_cache",
              sourceType: "session_message",
              content: "Cache-friendly retrieval result",
              score: 0.9,
            },
          ],
          runID: "run_cache_bound",
          metadata: { source: "test" },
        } as any)

        try {
          await SessionWorkGraph.materialize({
            rootSessionID: one.id,
            projectID: Instance.project.id,
            semanticQuery: "Keep semantic cache one warm for retrieval",
            semanticLimit: 3,
          })
          await SessionWorkGraph.materialize({
            rootSessionID: two.id,
            projectID: Instance.project.id,
            semanticQuery: "Keep semantic cache two warm for retrieval",
            semanticLimit: 3,
          })
          await SessionWorkGraph.materialize({
            rootSessionID: three.id,
            projectID: Instance.project.id,
            semanticQuery: "Keep semantic cache three warm for retrieval",
            semanticLimit: 3,
          })
          await SessionWorkGraph.materialize({
            rootSessionID: one.id,
            projectID: Instance.project.id,
            semanticQuery: "Keep semantic cache one warm for retrieval",
            semanticLimit: 3,
          })

          expect(search).toHaveBeenCalledTimes(4)
        } finally {
          search.mockRestore()
        }
      },
    })
  })

  test("expires semantic cache entries after the ttl window", async () => {
    await using tmp = await tmpdir({ git: true })

    RetrievalRuntime.configure({
      async embedText() {
        return { dimensions: 3, vector: [1, 0, 0], metadata: { source: "test" } }
      },
      async rerank(input) {
        return { candidates: input.candidates, metadata: { source: "test" } }
      },
    })

    SessionWorkGraph.setSemanticCachePolicyForTest({ ttl: 1 })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "ttl root" })

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: root.id,
          title: "Keep semantic cache ttl under control for retrieval",
        })

        const search = spyOn(RetrievalService, "search").mockResolvedValue({
          candidates: [
            {
              sourceID: "src_ttl",
              sourceType: "session_message",
              content: "TTL retrieval result",
              score: 0.8,
            },
          ],
          runID: "run_cache_ttl",
          metadata: { source: "test" },
        } as any)

        try {
          await SessionWorkGraph.materialize({
            rootSessionID: root.id,
            projectID: Instance.project.id,
            semanticQuery: "Keep semantic cache ttl under control for retrieval",
            semanticLimit: 3,
          })
          await Bun.sleep(5)
          await SessionWorkGraph.materialize({
            rootSessionID: root.id,
            projectID: Instance.project.id,
            semanticQuery: "Keep semantic cache ttl under control for retrieval",
            semanticLimit: 3,
          })

          expect(search).toHaveBeenCalledTimes(2)
        } finally {
          search.mockRestore()
        }
      },
    })
  })
})
