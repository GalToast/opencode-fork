import z from "zod"
import { HarnessState } from "./state"
import { pendingWorkerManifestPath, activeWorkerManifestPath } from "./hotswap"
import { Filesystem } from "@/util/filesystem"
import { plainEnglishUpgradeDetail } from "./ux"

/* eslint-disable @typescript-eslint/no-namespace */
type WorkerManifest = {
  executionID: string
  proposalID?: string
  updatedAt: number
  reportPath?: string
  summaryPath?: string
}

type Defer = {
  time?: number
  proposalID?: string
  reason?: string
}

export namespace HarnessStatus {
  export const State = z.enum([
    "idle",
    "observing",
    "upgrading",
    "retrying",
    "ready_next_launch",
    "updated",
    "deferred",
    "failed",
  ])
  export type State = z.infer<typeof State>

  export const Info = z.object({
    state: State,
    label: z.string(),
    detail: z.string().optional(),
    visible: z.boolean(),
    time: z.number().optional(),
    proposalID: z.string().optional(),
    pendingCount: z.number().int().min(0),
  })
  export type Info = z.infer<typeof Info>

  function lower(input: unknown) {
    return typeof input === "string" ? input.toLowerCase() : ""
  }

  function proposalTitle(snapshot: Awaited<ReturnType<typeof HarnessState.getSnapshot>>, proposalID?: string) {
    if (!proposalID) return undefined
    return snapshot.proposals.find((proposal) => proposal.id === proposalID)?.title
  }

  function mostRecent<T extends { time?: number }>(items: T[]) {
    return items.toSorted((a, b) => (b.time ?? 0) - (a.time ?? 0))[0]
  }

  function startup(input: unknown) {
    return lower(input).includes("session_start")
  }

  function upgrade(input: Awaited<ReturnType<typeof HarnessState.getSnapshot>>, proposalID?: string) {
    return plainEnglishUpgradeDetail(proposalTitle(input, proposalID))
  }

  function retryDetail(input: Awaited<ReturnType<typeof HarnessState.getSnapshot>>, item: { proposalID?: string; error?: string }) {
    const detail = upgrade(input, item.proposalID)
    if (startup(item.error)) {
      if (detail) return `startup stalled on ${detail}`
      return "startup stalled before author output"
    }
    return detail ?? "self-upgrade"
  }

  function deferDetail(input: Awaited<ReturnType<typeof HarnessState.getSnapshot>>, item?: Defer, fallback?: string) {
    const detail = upgrade(input, item?.proposalID) ?? fallback
    if (item?.reason === "foreground_active") return detail ? `waiting for foreground on ${detail}` : "waiting for foreground"
    if (item?.reason === "foreground_cooldown")
      return detail ? `waiting for foreground cooldown on ${detail}` : "waiting for foreground cooldown"
    if (item?.reason === "large_single_flight_active")
      return detail ? `waiting for the active large upgrade before ${detail}` : "waiting for the active large upgrade"
    if (item?.reason === "failure_cooldown") return detail ? `cooling down before retrying ${detail}` : "cooling down before retry"
    return detail ?? "needs safe handoff"
  }

  async function readManifest(path: string) {
    return Filesystem.readJson<WorkerManifest>(path).catch(() => undefined)
  }

  export async function current(): Promise<Info> {
    const [snapshot, observations, pendingManifest, activeManifest] = await Promise.all([
      HarnessState.getSnapshot(),
      HarnessState.listObservations(120),
      readManifest(pendingWorkerManifestPath()),
      readManifest(activeWorkerManifestPath()),
    ])

    const pendingCount = snapshot.proposals.filter((proposal) => {
      if (proposal.status === "applied" || proposal.status === "dismissed") return false
      return true
    }).length

    const runningProposal = mostRecent(
      snapshot.proposals
        .filter((proposal) => proposal.autoStatus === "running")
        .map((proposal) => ({ time: proposal.lastAutoExecutionAt, proposal })),
    )?.proposal
    const failedProposal = mostRecent(
      snapshot.proposals
        .filter((proposal) => proposal.autoStatus === "failed")
        .map((proposal) => ({ time: proposal.lastAutoExecutionAt, proposal })),
    )?.proposal
    const validatedProposal = mostRecent(
      snapshot.proposals
        .filter((proposal) => proposal.autoStatus === "validated")
        .map((proposal) => ({ time: proposal.lastValidatedAt ?? proposal.lastAutoExecutionAt, proposal })),
    )?.proposal
    const appliedProposal = mostRecent(
      snapshot.proposals
        .filter((proposal) => proposal.autoStatus === "applied")
        .map((proposal) => ({ time: proposal.lastAutoExecutionAt ?? proposal.lastValidatedAt, proposal })),
    )?.proposal

    const latestRetry = mostRecent(
      observations
        .filter((item) => item.kind === "patch.generation_retry")
        .map((item) => ({
          time: item.time,
          proposalID: lower(item.data?.proposalID) ? item.data?.proposalID : undefined,
          error: typeof item.data?.validationError === "string" ? item.data.validationError : undefined,
        })),
    )
    const latestFailure = mostRecent(
      observations
        .filter((item) => item.kind === "proposal.autopatch_failed")
        .map((item) => ({
          time: item.time,
          proposalID: item.data?.proposalID as string | undefined,
          error: typeof item.data?.error === "string" ? item.data.error : undefined,
        })),
    )
    const latestDeferred = mostRecent(
      observations
        .filter(
          (item) =>
            item.kind === "proposal.autopatch_deferred" ||
            (item.kind === "proposal.autopatch_skipped" &&
              ["foreground_active", "foreground_cooldown", "large_single_flight_active", "failure_cooldown"].includes(
                lower(item.data?.reason),
              )),
        )
        .map((item) => ({
          time: item.time,
          proposalID: item.data?.proposalID as string | undefined,
          reason: (item.data?.deferred as string | undefined) ?? (item.data?.reason as string | undefined),
        })),
    )
    const latestApplied = mostRecent(
      observations
        .filter((item) =>
          item.kind === "proposal.autopatch_applied" || item.kind === "self_edit.applied" || item.kind === "proposal.autopatch_promoted",
        )
        .map((item) => ({ time: item.time, proposalID: item.data?.proposalID as string | undefined })),
    )

    if (pendingManifest) {
      return {
        state: "ready_next_launch",
        label: "next launch",
        detail: plainEnglishUpgradeDetail(proposalTitle(snapshot, pendingManifest.proposalID)) ?? "validated upgrade ready",
        visible: true,
        time: pendingManifest.updatedAt,
        proposalID: pendingManifest.proposalID,
        pendingCount,
      }
    }

    if (runningProposal) {
      return {
        state: latestRetry && (latestRetry.time ?? 0) >= (runningProposal.lastAutoExecutionAt ?? 0) ? "retrying" : "upgrading",
        label:
          latestRetry && (latestRetry.time ?? 0) >= (runningProposal.lastAutoExecutionAt ?? 0) ? "retrying" : "upgrading",
        detail:
          latestRetry && (latestRetry.time ?? 0) >= (runningProposal.lastAutoExecutionAt ?? 0)
            ? retryDetail(snapshot, latestRetry)
            : plainEnglishUpgradeDetail(runningProposal?.title) ??
              plainEnglishUpgradeDetail(proposalTitle(snapshot, latestRetry?.proposalID)) ??
              "self-upgrade",
        visible: true,
        time: runningProposal.lastAutoExecutionAt || undefined,
        proposalID: runningProposal?.id ?? latestRetry?.proposalID,
        pendingCount,
      }
    }

    if (latestFailure && (latestFailure.time ?? 0) >= (latestApplied?.time ?? 0)) {
      return {
        state: "failed",
        label: "failed",
        detail:
          retryDetail(snapshot, latestFailure) ?? plainEnglishUpgradeDetail(failedProposal?.title) ?? "self-upgrade",
        visible: true,
        time: latestFailure.time,
        proposalID: latestFailure.proposalID ?? failedProposal?.id,
        pendingCount,
      }
    }

    if (latestDeferred && (latestDeferred.time ?? 0) >= (latestApplied?.time ?? 0)) {
      return {
        state: "deferred",
        label: "deferred",
        detail: deferDetail(snapshot, latestDeferred, plainEnglishUpgradeDetail(validatedProposal?.title)),
        visible: true,
        time: latestDeferred.time,
        proposalID: latestDeferred.proposalID ?? validatedProposal?.id,
        pendingCount,
      }
    }

    if (validatedProposal) {
      return {
        state: "ready_next_launch",
        label: "next launch",
        detail: plainEnglishUpgradeDetail(validatedProposal.title) ?? "validated upgrade ready",
        visible: true,
        time: validatedProposal.lastValidatedAt ?? validatedProposal.lastAutoExecutionAt,
        proposalID: validatedProposal.id,
        pendingCount,
      }
    }

    if (activeManifest || latestApplied || appliedProposal) {
      return {
        state: "updated",
        label: "updated",
        detail:
          plainEnglishUpgradeDetail(proposalTitle(snapshot, activeManifest?.proposalID)) ??
          plainEnglishUpgradeDetail(proposalTitle(snapshot, latestApplied?.proposalID)) ??
          plainEnglishUpgradeDetail(appliedProposal?.title) ??
          "harness upgrade active",
        visible: true,
        time:
          activeManifest?.updatedAt ??
          latestApplied?.time ??
          appliedProposal?.lastAutoExecutionAt ??
          appliedProposal?.lastValidatedAt,
        proposalID: activeManifest?.proposalID ?? latestApplied?.proposalID ?? appliedProposal?.id,
        pendingCount,
      }
    }

    const observingProposal = mostRecent(
      snapshot.proposals
        .filter((proposal) => proposal.status === "open" || proposal.status === "materialized" || proposal.autoStatus === "staged")
        .map((proposal) => ({ time: proposal.materializedAt ?? proposal.lastAutoExecutionAt ?? snapshot.updatedAt, proposal })),
    )?.proposal

    if (observingProposal || pendingCount > 0) {
      return {
        state: "observing",
        label: "learning",
        detail: plainEnglishUpgradeDetail(observingProposal?.title) ?? "watching for upgrades",
        visible: true,
        time: observingProposal?.materializedAt ?? observingProposal?.lastAutoExecutionAt ?? snapshot.updatedAt,
        proposalID: observingProposal?.id,
        pendingCount,
      }
    }

    return {
      state: "idle",
      label: "idle",
      detail: undefined,
      visible: false,
      time: snapshot.updatedAt || undefined,
      proposalID: undefined,
      pendingCount: 0,
    }
  }
}
