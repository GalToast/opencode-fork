import { Session } from "@/session"
import { SessionAuthority } from "@/session/authority"
import { SessionCounterpressure } from "@/session/counterpressure"
import { SessionDecision } from "@/session/decision"
import { SessionEvidence } from "@/session/evidence"
import { SessionMission } from "@/session/mission"
import { SessionOpenLoops } from "@/session/open-loops"
import { ReasoningLedger as SessionReasoningLedger } from "@/session/reasoning-ledger"
import { SessionSocialMemory } from "@/session/social-memory"
import { SessionForeground } from "@/session/foreground"
import { SessionWorkGraph } from "@/session/workgraph"
import { Identifier } from "@/id/id"
import z from "zod"

/* eslint-disable-next-line @typescript-eslint/no-namespace */
export namespace SessionBatonRegistry {
  export const BatonKind = z
    .enum(["mission", "authority", "decision", "evidence", "counterpressure", "open_loops", "reasoning_ledger", "execution_brief", "social_memory", "foreground"])
    .meta({ ref: "SessionBatonKind" })
  export type BatonKind = z.infer<typeof BatonKind>

  export const ActiveBaton = z
    .object({
      kind: BatonKind,
      rootSessionID: Identifier.schema("session"),
      status: z.enum(["active", "idle"]),
      updatedAt: z.number(),
      sessionID: Identifier.schema("session").optional(),
      messageID: Identifier.schema("message").optional(),
      summary: z.string(),
      text: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    })
    .meta({ ref: "SessionActiveBaton" })
  export type ActiveBaton = z.infer<typeof ActiveBaton>

  export const ActiveSnapshot = z
    .object({
      rootSessionID: Identifier.schema("session"),
      generatedAt: z.number(),
      batons: z.array(ActiveBaton),
    })
    .meta({ ref: "SessionBatonRegistryActiveSnapshot" })
  export type ActiveSnapshot = z.infer<typeof ActiveSnapshot>

  export const HistoryEntry = z
    .object({
      kind: BatonKind,
      at: z.number(),
      action: z.string(),
      sessionID: Identifier.schema("session").optional(),
      messageID: Identifier.schema("message").optional(),
      summary: z.string(),
    })
    .meta({ ref: "SessionBatonHistoryEntry" })
  export type HistoryEntry = z.infer<typeof HistoryEntry>

  export const History = z
    .object({
      rootSessionID: Identifier.schema("session"),
      generatedAt: z.number(),
      entries: z.array(HistoryEntry),
    })
    .meta({ ref: "SessionBatonRegistryHistory" })
  export type History = z.infer<typeof History>

  async function latestExecutionBrief(rootSessionID: string) {
    const graph = await SessionWorkGraph.get(rootSessionID).catch(() => undefined)
    const artifact = [...(graph?.artifacts ?? [])].reverse().find((item) => item.type === "execution_brief")
    if (!artifact) return undefined
    return {
      artifact,
      text: artifact.summary,
    }
  }

  export async function active(input: { sessionID: string }) {
    const rootSessionID = input.sessionID
    const generatedAt = Date.now()
    const [missionInfo, mission, authorityInfo, authority, decisionInfo, decision, evidenceInfo, evidence, counterpressureInfo, counterpressure, openLoopsInfo, openLoops, reasoningInfo, reasoningLedger, socialInfo, socialMemory, executionBrief, foreground] =
      await Promise.all([
        SessionMission.get(rootSessionID).catch(() => undefined),
        SessionMission.materialize({ rootSessionID }).catch(() => undefined),
        SessionAuthority.get(rootSessionID).catch(() => undefined),
        SessionAuthority.materialize({ rootSessionID, sessionID: input.sessionID }).catch(() => undefined),
        SessionDecision.get(rootSessionID).catch(() => undefined),
        SessionDecision.materialize({ rootSessionID }).catch(() => undefined),
        SessionEvidence.get(rootSessionID).catch(() => undefined),
        SessionEvidence.materialize({ rootSessionID }).catch(() => undefined),
        SessionCounterpressure.get(rootSessionID).catch(() => undefined),
        SessionCounterpressure.materialize({ rootSessionID }).catch(() => undefined),
        SessionOpenLoops.get(rootSessionID).catch(() => undefined),
        SessionOpenLoops.materialize({ rootSessionID }).catch(() => undefined),
        SessionReasoningLedger.get(rootSessionID).catch(() => undefined),
        SessionReasoningLedger.materialize({ rootSessionID }).catch(() => undefined),
        SessionSocialMemory.get(rootSessionID).catch(() => undefined),
        SessionSocialMemory.materialize({ rootSessionID }).catch(() => undefined),
        latestExecutionBrief(rootSessionID).catch(() => undefined),
        Promise.resolve(SessionForeground.get(rootSessionID)),
      ])

    const batons = [
      missionInfo
        ? {
            kind: "mission",
            rootSessionID,
            status: "active",
            updatedAt: missionInfo.updatedAt,
            sessionID: missionInfo.latestSessionID,
            messageID: missionInfo.latestMessageID,
            summary: missionInfo.latestConstraintsSummary
              ? `${missionInfo.latestIntent} | constraints=${missionInfo.latestConstraintsSummary.split(/\r?\n/).length}`
              : missionInfo.latestIntent,
            text: mission?.text,
          }
        : undefined,
      authorityInfo
        ? {
            kind: "authority",
            rootSessionID,
            status: "active",
            updatedAt: authorityInfo.updatedAt,
            sessionID: authorityInfo.latestSessionID,
            messageID: authorityInfo.latestMessageID,
            summary: authorityInfo.latestSummary,
            text: authority?.text,
            metadata: {
              records: authorityInfo.records.length,
            },
          }
        : undefined,
      decisionInfo
        ? {
            kind: "decision",
            rootSessionID,
            status: decisionInfo.decisions.some((item) => item.status === "active") ? "active" : "idle",
            updatedAt: decisionInfo.updatedAt,
            sessionID: decisionInfo.latestSessionID,
            messageID: decisionInfo.latestMessageID,
            summary: decisionInfo.latestSummary,
            text: decision?.text,
            metadata: {
              active: decisionInfo.decisions.filter((item) => item.status === "active").length,
              superseded: decisionInfo.decisions.filter((item) => item.status === "superseded").length,
            },
          }
        : undefined,
      evidenceInfo
        ? {
            kind: "evidence",
            rootSessionID,
            status: evidenceInfo.items.some((item) => item.freshness !== "stale") ? "active" : "idle",
            updatedAt: evidenceInfo.updatedAt,
            sessionID: evidenceInfo.latestSessionID,
            messageID: evidenceInfo.latestMessageID,
            summary: evidenceInfo.latestSummary,
            text: evidence?.text,
            metadata: {
              total: evidenceInfo.items.length,
              fresh: evidenceInfo.items.filter((item) => item.freshness === "fresh").length,
              recent: evidenceInfo.items.filter((item) => item.freshness === "recent").length,
              stale: evidenceInfo.items.filter((item) => item.freshness === "stale").length,
            },
          }
        : undefined,
      counterpressureInfo
        ? {
            kind: "counterpressure",
            rootSessionID,
            status: counterpressureInfo.warnings.some((item) => item.severity !== "medium") ? "active" : "idle",
            updatedAt: counterpressureInfo.updatedAt,
            sessionID: counterpressureInfo.latestSessionID,
            messageID: counterpressureInfo.latestMessageID,
            summary: counterpressureInfo.latestSummary,
            text: counterpressure?.text,
            metadata: {
              total: counterpressureInfo.warnings.length,
              critical: counterpressureInfo.warnings.filter((item) => item.severity === "critical").length,
              high: counterpressureInfo.warnings.filter((item) => item.severity === "high").length,
              medium: counterpressureInfo.warnings.filter((item) => item.severity === "medium").length,
            },
          }
        : undefined,
      openLoopsInfo
        ? {
            kind: "open_loops",
            rootSessionID,
            status: openLoopsInfo.loops.some((item) => item.status !== "resolved") ? "active" : "idle",
            updatedAt: openLoopsInfo.updatedAt,
            sessionID: openLoopsInfo.latestSessionID,
            messageID: openLoopsInfo.latestMessageID,
            summary: openLoopsInfo.latestSummary,
            text: openLoops?.text,
            metadata: {
              unresolved: openLoopsInfo.loops.filter((item) => item.status !== "resolved").length,
              resolved: openLoopsInfo.loops.filter((item) => item.status === "resolved").length,
            },
          }
        : undefined,
      reasoningInfo
        ? {
            kind: "reasoning_ledger",
            rootSessionID,
            status: "active",
            updatedAt: reasoningInfo.updatedAt,
            sessionID: reasoningInfo.latestSessionID,
            messageID: reasoningInfo.latestMessageID,
            summary: reasoningInfo.latestSummary,
            text: reasoningLedger?.text,
            metadata: {
              commitments: reasoningInfo.commitments.length,
              assumptions: reasoningInfo.assumptions.length,
              falsifiers: reasoningInfo.falsifiers.length,
              transitions: reasoningInfo.events.length,
            },
          }
        : undefined,
      executionBrief
        ? {
            kind: "execution_brief",
            rootSessionID,
            status: "active",
            updatedAt: executionBrief.artifact.createdAt,
            sessionID: executionBrief.artifact.sessionID,
            messageID: executionBrief.artifact.messageID,
            summary: executionBrief.artifact.summary.split(/\r?\n/)[0] ?? executionBrief.artifact.summary,
            text: executionBrief.text,
            metadata: {
              artifactID: executionBrief.artifact.id,
            },
          }
        : undefined,
      socialInfo
        ? {
            kind: "social_memory",
            rootSessionID,
            status: "active",
            updatedAt: socialInfo.updatedAt,
            sessionID: socialInfo.latestSessionID,
            messageID: socialInfo.latestMessageID,
            summary: socialInfo.latestSummary,
            text: socialMemory?.text,
            metadata: {
              pairings: socialInfo.successfulPairings.length,
              handoffs: socialInfo.handoffPatterns.length,
              stalls: socialInfo.stallPatterns.length,
            },
          }
        : undefined,
      foreground
        ? {
            kind: "foreground",
            rootSessionID,
            status: foreground.state === "idle" ? "idle" : "active",
            updatedAt: foreground.completedAt ?? foreground.promotedAt ?? foreground.acceptedAt ?? foreground.steer?.at ?? generatedAt,
            sessionID: foreground.latestSessionID,
            messageID: foreground.latestMessageID,
            summary: `${foreground.state}: ${foreground.latestUserIntent}`,
            metadata: {
              info: foreground,
            },
          }
        : undefined,
    ].filter(Boolean) as ActiveBaton[]

    return {
      rootSessionID,
      generatedAt,
      batons: batons.sort((a, b) => b.updatedAt - a.updatedAt),
    } satisfies ActiveSnapshot
  }

  export async function history(input: { sessionID: string; limit?: number }) {
    const rootSessionID = input.sessionID
    const generatedAt = Date.now()
    const limit = Math.max(1, input.limit ?? 20)
    const [mission, authority, decision, evidence, counterpressure, openLoops, reasoning, social, executionBrief, foreground] = await Promise.all([
      SessionMission.get(rootSessionID).catch(() => undefined),
      SessionAuthority.get(rootSessionID).catch(() => undefined),
      SessionDecision.get(rootSessionID).catch(() => undefined),
      SessionEvidence.get(rootSessionID).catch(() => undefined),
      SessionCounterpressure.get(rootSessionID).catch(() => undefined),
      SessionOpenLoops.get(rootSessionID).catch(() => undefined),
      SessionReasoningLedger.get(rootSessionID).catch(() => undefined),
      SessionSocialMemory.get(rootSessionID).catch(() => undefined),
      latestExecutionBrief(rootSessionID).catch(() => undefined),
      Promise.resolve(SessionForeground.get(rootSessionID)),
    ])

    const entries: HistoryEntry[] = [
      ...(mission?.intentLog ?? []).map((entry) => ({
        kind: "mission" as const,
        at: entry.at,
        action: "ingress",
        sessionID: entry.sessionID,
        messageID: entry.messageID,
        summary: entry.constraintsSummary ? `${entry.intent} | ${entry.constraintsSummary}` : entry.intent,
      })),
      ...(authority?.records ?? []).flatMap((entry) => [
        {
          kind: "authority" as const,
          at: entry.at,
          action: entry.scopeEscalationRequired ? "escalation_required" : entry.authoritySource,
          sessionID: entry.sessionID,
          messageID: entry.messageID,
          summary: entry.latestSummary,
        },
      ]),
      ...(decision?.events ?? []).map((entry) => ({
        kind: "decision" as const,
        at: entry.at,
        action: entry.action,
        sessionID: entry.sessionID,
        messageID: entry.messageID,
        summary: entry.summary,
      })),
      ...(evidence?.events ?? []).map((entry) => ({
        kind: "evidence" as const,
        at: entry.at,
        action: entry.action,
        sessionID: entry.sessionID,
        messageID: entry.messageID,
        summary: entry.summary,
      })),
      ...(counterpressure?.events ?? []).map((entry) => ({
        kind: "counterpressure" as const,
        at: entry.at,
        action: entry.action,
        sessionID: entry.sessionID,
        messageID: entry.messageID,
        summary: entry.summary,
      })),
      ...(openLoops?.events ?? []).map((entry) => ({
        kind: "open_loops" as const,
        at: entry.at,
        action: entry.action,
        sessionID: entry.sessionID,
        messageID: entry.messageID,
        summary: entry.summary,
      })),
      ...(reasoning?.events ?? []).map((entry) => ({
        kind: "reasoning_ledger" as const,
        at: entry.at,
        action: `${entry.targetType}_${entry.outcome}`,
        sessionID: entry.sessionID,
        messageID: entry.messageID,
        summary: entry.note ?? `${entry.targetType} ${entry.outcome}`,
      })),
      ...(social?.successfulPairings ?? []).map((entry) => ({
        kind: "social_memory" as const,
        at: entry.at,
        action: "pairing",
        sessionID: entry.sessionID,
        messageID: entry.messageID,
        summary: entry.note ? `${entry.pattern} | ${entry.note}` : entry.pattern,
      })),
      ...(social?.handoffPatterns ?? []).map((entry) => ({
        kind: "social_memory" as const,
        at: entry.at,
        action: "handoff",
        sessionID: entry.sessionID,
        messageID: entry.messageID,
        summary: entry.note ? `${entry.pattern} | ${entry.note}` : entry.pattern,
      })),
      ...(social?.stallPatterns ?? []).map((entry) => ({
        kind: "social_memory" as const,
        at: entry.at,
        action: "stall",
        sessionID: entry.sessionID,
        messageID: entry.messageID,
        summary: entry.note ? `${entry.pattern} | ${entry.note}` : entry.pattern,
      })),
      ...(executionBrief
        ? [
            {
              kind: "execution_brief" as const,
              at: executionBrief.artifact.createdAt,
              action: "committed",
              sessionID: executionBrief.artifact.sessionID,
              messageID: executionBrief.artifact.messageID,
              summary: executionBrief.artifact.summary,
            },
          ]
        : []),
      ...(foreground
        ? [
            ...(foreground.acceptedAt
              ? [
                  {
                    kind: "foreground" as const,
                    at: foreground.acceptedAt,
                    action: "accepted",
                    sessionID: foreground.latestSessionID,
                    messageID: foreground.latestMessageID,
                    summary: foreground.latestUserIntent,
                  },
                ]
              : []),
            ...(foreground.promotedAt
              ? [
                  {
                    kind: "foreground" as const,
                    at: foreground.promotedAt,
                    action: "promoted",
                    sessionID: foreground.activeSessionID ?? foreground.latestSessionID,
                    messageID: foreground.latestMessageID,
                    summary: foreground.latestUserIntent,
                  },
                ]
              : []),
            ...(foreground.steer?.at
              ? [
                  {
                    kind: "foreground" as const,
                    at: foreground.steer.at,
                    action: `steer_${foreground.steer.stage}`,
                    sessionID: foreground.latestSessionID,
                    messageID: foreground.steer.messageID ?? foreground.latestMessageID,
                    summary: foreground.latestUserIntent,
                  },
                ]
              : []),
            ...(foreground.completedAt
              ? [
                  {
                    kind: "foreground" as const,
                    at: foreground.completedAt,
                    action: "settled",
                    sessionID: foreground.latestSessionID,
                    messageID: foreground.latestMessageID,
                    summary: foreground.latestUserIntent,
                  },
                ]
              : []),
          ]
        : []),
    ]

    return {
      rootSessionID,
      generatedAt,
      entries: entries.sort((a, b) => b.at - a.at).slice(0, limit),
    } satisfies History
  }
}
