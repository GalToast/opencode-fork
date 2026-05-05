import { Log } from "../src/util/log"
import { Instance } from "../src/project/instance"
import { Session } from "../src/session"
import { RetrievalService } from "../src/retrieval"
import { REAL_RETRIEVAL_QUALITY_SCENARIOS } from "../src/harness/retrieval-quality-real-cases"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"
const LIMIT = Number(process.env.RETRIEVAL_TRACE_CAPTURE_LIMIT ?? "12")

const queries = [
  {
    id: "file_vs_decision_rule_owner",
    query: "which file actually owns the settled retrieval rule about embedding cache identity",
    detail: "ambiguous between exact owner file lookup and settled decision recall",
  },
  {
    id: "recovery_vs_decision_fallback_rule",
    query: "what fixed provider fallback divergence and what rule did we keep afterward",
    detail: "ambiguous between recovery path and preserved decision rule",
  },
  {
    id: "file_vs_compaction_retention_owner",
    query: "which file owns the short filename retention logic for compaction",
    detail: "ambiguous between exact file lookup and compaction retention memory",
  },
  {
    id: "task_pattern_vs_file_narrow_patch",
    query: "show the narrow patch pattern for retrieval fixes and where it usually lives",
    detail: "ambiguous between reusable execution pattern and exact file locator",
  },
  {
    id: "recovery_vs_file_truthful_status",
    query: "where did retrieval status stop lying during degraded mode and what fixed it",
    detail: "ambiguous between owner file lookup and recovery history",
  },
  {
    id: "decision_vs_compaction_constraint",
    query: "retain the rule about index-space isolation through compaction",
    detail: "ambiguous between durable decision recall and compaction retention",
  },
  {
    id: "file_vs_recovery_feedback_scope",
    query: "which file fixed the feedback bias leak across sibling sessions",
    detail: "ambiguous between file ownership and recovery narrative",
  },
  {
    id: "task_pattern_vs_decision_benchmark_then_production",
    query: "what was our benchmark-first then production pattern and what decision did it preserve",
    detail: "ambiguous between execution pattern and governing decision",
  },
  {
    id: "file_vs_decision_router_contract",
    query: "which file enforces the qwen retrieval instruction contract and what was the rule",
    detail: "ambiguous between file owner lookup and settled instruction contract",
  },
  {
    id: "recovery_vs_task_pattern_observability_first",
    query: "what was the pattern where we made retrieval truthful first before fixing the rest",
    detail: "ambiguous between recovery episode and reusable task pattern",
  },
  {
    id: "decision_vs_file_runtime_models",
    query: "which file shows observed runtime retrieval models and what rule required that",
    detail: "ambiguous between exact surface owner and settled observability rule",
  },
  {
    id: "compaction_vs_file_scope_anchor",
    query: "keep session_only and project_with_family_preference alive and show me where they come from",
    detail: "ambiguous between compaction-worthy anchors and file/source lookup",
  },
]

process.env.OPENCODE_DEBUG_RETRIEVAL_TRACE = process.env.OPENCODE_DEBUG_RETRIEVAL_TRACE || "1"

await Log.init({ print: false })

const workspaceDir = process.cwd()
const queryBatch = queries.slice(0, Math.max(1, Math.min(queries.length, LIMIT)))

async function seedCorpus(projectID: string, sessionID: string) {
  for (const scenario of REAL_RETRIEVAL_QUALITY_SCENARIOS) {
    const documentID = `capture-seed-${scenario.id}`
    const content = [
      scenario.sharedContext,
      `[intent:${scenario.category}]`,
      scenario.detail,
      `Operator query: ${scenario.query}`,
      `This record captures real opencode retrieval substrate knowledge for ${scenario.category}.`,
    ].join(" ")

    await RetrievalService.upsertDocument({
      id: documentID,
      projectID,
      sourceType: "note",
      sourceID: scenario.id,
      title: `${scenario.id} ${scenario.category}`,
      fingerprint: `${documentID}-fingerprint`,
      metadata: {
        benchmarkSource: "real_retrieval_quality",
        category: scenario.category,
      },
      outcomeScore: 1,
      negativeSignal: false,
    } as any)
    await RetrievalService.replaceChunks({
      documentID,
      projectID,
      content,
    })
  }
}

const result = await Instance.provide({
  directory: workspaceDir,
  fn: async () => {
    const session = await Session.create({ title: "Ambiguous retrieval trace capture" })
    try {
      await seedCorpus(Instance.project.id, session.id)

      const rows = []
      for (const item of queryBatch) {
        const search = await RetrievalService.search({
          projectID: Instance.project.id,
          preferredSessionIDs: [session.id],
          query: item.query,
          policy: "auto",
          limit: 5,
          metadata: {
            detail: item.detail,
          },
        })

        rows.push({
          id: item.id,
          query: item.query,
          detail: item.detail,
          runID: search.runID,
          candidateCount: search.candidates.length,
          routedIntent: search.runMetadata?.routedIntent,
          routedIntentSecondary: search.runMetadata?.routedIntentSecondary,
          routingConfidence: search.runMetadata?.routingConfidence,
          routingStrategy: search.runMetadata?.routingStrategy,
          routingScoreSpread: search.runMetadata?.routingScoreSpread,
          topDocumentID: search.candidates[0]?.documentID,
          topScore: search.candidates[0]?.score ?? null,
          secondScore: search.candidates[1]?.score ?? null,
        })
      }
      return rows
    } finally {
      await Session.remove(session.id).catch(() => {})
    }
  },
})

if (JSON_OUTPUT) {
  console.log(JSON.stringify({ count: result.length, rows: result }, null, 2))
} else {
  console.log("Ambiguous retrieval trace capture")
  console.log(`query_count: ${result.length}`)
  console.table(result)
}
