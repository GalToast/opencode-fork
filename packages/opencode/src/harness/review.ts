import path from "path"
import { Filesystem } from "@/util/filesystem"
import { resolveHarnessSourcePath } from "./paths"
import { HarnessState } from "./state"
import { callerHarnessRoot, runReadOnlyHarnessSession, sourceRoot } from "./session"
import { changedFilesFromPatch, defaultVerifyCommands } from "./verify"

/* eslint-disable @typescript-eslint/no-namespace */
type ReviewPatchInput = {
  proposalID: string
  patchPath?: string
  model?: string
  agent?: string
  timeoutMS?: number
  tracePath?: string
}

type ReviewVerdict = "approve" | "reject"

type ReviewedPatchArtifact = {
  proposalID: string
  verdict: ReviewVerdict
  approved: boolean
  summary: string
  concerns: string[]
  verifySuggestions: string[]
  sessionID: string
  patchPath: string
  rawPath: string
  reportPath: string
  raw: string
}

type MaterializeInput = {
  proposalID?: string
  all?: boolean
}

type MaterializedArtifact = {
  proposalID: string
  title: string
  directory: string
  files: string[]
}

function resolveTargetFiles(proposal: HarnessState.Proposal) {
  const files = proposal.patchHint?.files ?? []
  return files.map((file) => ({
    relativePath: file,
    absolutePath: resolveHarnessSourcePath(file, sourceRoot()),
  }))
}

function trimExcerpt(input: string, maxChars = 8_000, maxLines = 160) {
  const lines = input.split(/\r?\n/).slice(0, maxLines)
  const joined = lines.join("\n")
  if (joined.length <= maxChars) return joined
  return joined.slice(0, maxChars) + "\n...<truncated>..."
}

async function fileSection(absolutePath: string, relativePath: string) {
  const exists = Filesystem.exists(absolutePath)
  if (!exists) {
    return [
      `## ${relativePath}`,
      "",
      `- absolutePath: ${absolutePath}`,
      "- status: missing",
      "",
    ].join("\n")
  }

  const content = await Filesystem.readText(absolutePath).catch(() => "")
  const excerpt = trimExcerpt(content)
  return [
    `## ${relativePath}`,
    "",
    `- absolutePath: ${absolutePath}`,
    "- status: present",
    "",
    "```text",
    excerpt,
    "```",
    "",
  ].join("\n")
}

function reviewMarkdown(proposal: HarnessState.Proposal, files: { relativePath: string; absolutePath: string }[], sections: string[]) {
  return [
    `# ${proposal.title}`,
    "",
    `- proposalId: ${proposal.id}`,
    `- kind: ${proposal.kind}`,
    `- confidence: ${proposal.confidence}`,
    `- status: ${proposal.status}`,
    "",
    "## Rationale",
    "",
    proposal.rationale,
    "",
    "## Patch Hint",
    "",
    proposal.patchHint?.summary ?? "No patch hint provided.",
    "",
    "## Target Files",
    "",
    ...(files.length > 0 ? files.map((file) => `- ${file.relativePath}`) : ["- none provided"]),
    "",
    "## Review Workflow",
    "",
    "1. Inspect the target file excerpts below.",
    "2. Decide whether the proposal is safe and worthwhile.",
    "3. If approved, use the companion prompt artifact to generate a real patch in the harness source repo.",
    "4. Review the resulting diff before applying it.",
    "",
    "## File Context",
    "",
    ...sections,
  ].join("\n")
}

function promptMarkdown(proposal: HarnessState.Proposal, files: { relativePath: string; absolutePath: string }[]) {
  return [
    "# Harness Self-Edit Prompt",
    "",
    "Use this prompt with an implementation pass that is allowed to edit the harness source repo.",
    "",
    "## Objective",
    "",
    proposal.title,
    "",
    "## Rationale",
    "",
    proposal.rationale,
    "",
    "## Requested Change",
    "",
    proposal.patchHint?.summary ?? "No patch summary provided.",
    "",
    "## Constraints",
    "",
    "- Edit only the listed target files unless a narrowly related test file is needed.",
    "- Preserve existing behavior outside the issue being fixed.",
    "- Add or update tests when practical.",
    "- Do not apply unrelated refactors.",
    "",
    "## Target Files",
    "",
    ...(files.length > 0 ? files.map((file) => `- ${file.absolutePath}`) : ["- none provided"]),
    "",
    "## Deliverable",
    "",
    "Produce an actual patch or diff for review. Do not apply it automatically.",
    "",
  ].join("\n")
}

function appendUnique(list: string[] | undefined, values: string[]) {
  return [...new Set([...(list ?? []), ...values])]
}

function reviewPatchPrompt(input: {
  proposal: HarnessState.Proposal
  patchPath: string
  artifacts: string[]
}) {
  return [
    "Review the supplied generated apply_patch patch for the OpenCode harness.",
    "",
    "You are the adversarial review lane. Be skeptical, specific, and safety-conscious, but finish now.",
    "All evidence you may use is already supplied in the artifact text blocks attached to this prompt.",
    "Do not inspect files, run commands, ask questions, announce next steps, or say you will verify something later.",
    "Your job is to make a reviewer decision from the supplied proposal, context, and patch.",
    "",
    "Decision policy:",
    "- APPROVE when the patch is well-scoped, internally consistent, aligned to the proposal, and concretely reviewable.",
    "- REJECT when the patch is malformed, ambiguous, too broad, unrelated, likely to regress behavior, or impossible to verify from supplied context.",
    "- Missing dedicated tests are not automatically fatal for a tiny fixture patch; list needed checks under VERIFY.",
    "",
    "Return EXACTLY this format:",
    "VERDICT: APPROVE or REJECT",
    "SUMMARY: <one line>",
    "CONCERNS:",
    "- <one concern per line, or '- none'>",
    "VERIFY:",
    "- <one verification suggestion per line, or '- none'>",
    "",
    `Proposal title: ${input.proposal.title}`,
    `Proposal rationale: ${input.proposal.rationale}`,
    `Patch hint: ${input.proposal.patchHint?.summary ?? "No patch hint provided."}`,
    `Patch file: ${input.patchPath}`,
    "",
    "Attached artifacts:",
    ...input.artifacts.map((artifact) => `- ${artifact}`),
    "",
    `Harness source root: ${sourceRoot()}`,
    `Caller harness root: ${callerHarnessRoot()}`,
    "",
    "Final answer only. Do not include prose before or after this block:",
    "VERDICT: APPROVE or REJECT",
    "SUMMARY: <one concrete sentence explaining the decision>",
    "CONCERNS:",
    "- <one concern per line, or '- none'>",
    "VERIFY:",
    "- <one verification suggestion per line, or '- none'>",
  ].join("\n")
}

export function parseSectionLines(raw: string, header: "CONCERNS" | "VERIFY") {
  const lines = raw.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim().toUpperCase() === `${header}:`)
  if (start === -1) return []
  const values: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (/^[A-Za-z][A-Za-z_ ]+:/.test(line)) break
    if (line.startsWith("-")) values.push(line.slice(1).trim())
  }
  const normalized = values.map((value) => value.trim()).filter(Boolean)
  return normalized.filter((value) => value.toLowerCase() !== "none")
}

export function parsePatchReview(raw: string) {
  const verdictMatch = raw.match(/^\s*VERDICT:\s*(APPROVE|REJECT)\s*$/im)
  const summaryMatch = raw.match(/^\s*SUMMARY:\s*(.+)$/im)
  const concerns = parseSectionLines(raw, "CONCERNS")
  const verifySuggestions = parseSectionLines(raw, "VERIFY")
  const verdict = verdictMatch?.[1]?.toLowerCase() === "approve" ? "approve" : "reject"
  const summary = summaryMatch?.[1]?.trim() || "No review summary provided."
  return {
    verdict: verdict as ReviewVerdict,
    approved: verdict === "approve",
    summary,
    concerns,
    verifySuggestions,
  }
}

export function reviewVerifySuggestions(input: {
  approved: boolean
  patchText: string
  verifySuggestions: string[]
}) {
  if (!input.approved) return input.verifySuggestions
  if (input.verifySuggestions.length > 0) return input.verifySuggestions
  return defaultVerifyCommands(changedFilesFromPatch(input.patchText))
}

export namespace HarnessReview {
  export async function materialize(input: MaterializeInput = {}): Promise<MaterializedArtifact[]> {
    const snapshot = await HarnessState.getSnapshot()
    const proposals = snapshot.proposals.filter((proposal) => {
      if (proposal.kind !== "code_patch") return false
      if (input.proposalID && proposal.id !== input.proposalID) return false
      if (input.all) return proposal.status !== "dismissed" && proposal.status !== "applied"
      return proposal.status === "open"
    })

    const artifacts: MaterializedArtifact[] = []
    for (const proposal of proposals) {
      const dir = path.join(HarnessState.reviewDir(), proposal.id)
      const targets = resolveTargetFiles(proposal)
      const sections = await Promise.all(targets.map((target) => fileSection(target.absolutePath, target.relativePath)))
      const jsonPath = path.join(dir, "proposal.json")
      const reviewPath = path.join(dir, "review.md")
      const promptPath = path.join(dir, "implement.prompt.md")
      const artifactPaths = [jsonPath, reviewPath, promptPath]

      await Filesystem.writeJson(jsonPath, {
        proposal,
        generatedAt: Date.now(),
        harnessRoot: process.env.OPENCODE_HARNESS_ROOT || process.cwd(),
        sourceRoot: sourceRoot(),
        targets,
      })
      await Filesystem.write(reviewPath, reviewMarkdown(proposal, targets, sections))
      await Filesystem.write(promptPath, promptMarkdown(proposal, targets))

      await HarnessState.updateProposal(proposal.id, (current) => ({
        ...current,
        status: "materialized",
        materializedAt: Date.now(),
        reviewArtifacts: appendUnique(current.reviewArtifacts, artifactPaths),
      }))

      artifacts.push({
        proposalID: proposal.id,
        title: proposal.title,
        directory: dir,
        files: artifactPaths,
      })
    }

    return artifacts
  }

  export async function reviewPatch(input: ReviewPatchInput): Promise<ReviewedPatchArtifact> {
    const snapshot = await HarnessState.getSnapshot()
    const proposal = snapshot.proposals.find((item) => item.id === input.proposalID)
    if (!proposal) throw new Error(`Proposal not found: ${input.proposalID}`)
    if (proposal.kind !== "code_patch") throw new Error(`Proposal is not a code_patch: ${input.proposalID}`)

    if (!proposal.reviewArtifacts || proposal.reviewArtifacts.length === 0) {
      await materialize({ proposalID: input.proposalID })
    }

    const artifactDir = path.join(HarnessState.reviewDir(), input.proposalID)
    const patchPath = input.patchPath ?? path.join(artifactDir, "generated.patch")
    const patchExists = Filesystem.exists(patchPath)
    if (!patchExists) throw new Error(`Generated patch not found: ${patchPath}`)

    const proposalJson = path.join(artifactDir, "proposal.json")
    const reviewPath = path.join(artifactDir, "review.md")
    const promptPath = path.join(artifactDir, "implement.prompt.md")
    const rawPath = path.join(artifactDir, "patch.review.response.txt")
    const reportPath = path.join(artifactDir, "patch.review.report.json")
    const artifactFiles = [proposalJson, reviewPath, promptPath, patchPath]
    const patchText = await Filesystem.readText(patchPath)

    const result = await runReadOnlyHarnessSession({
      title: `Harness patch review ${input.proposalID}`,
      prompt: reviewPatchPrompt({
        proposal,
        patchPath,
        artifacts: artifactFiles,
      }),
      model: input.model,
      agent: input.agent,
      artifactFiles,
      lane: "reviewer",
      stage: "review",
      timeoutMS: input.timeoutMS,
      tracePath: input.tracePath,
    })
    const parsed = parsePatchReview(result.raw)
    const verifySuggestions = reviewVerifySuggestions({
      approved: parsed.approved,
      patchText,
      verifySuggestions: parsed.verifySuggestions,
    })

    await Filesystem.write(rawPath, result.raw)
    await Filesystem.writeJson(reportPath, {
      proposalID: input.proposalID,
      sessionID: result.sessionID,
      verdict: parsed.verdict,
      approved: parsed.approved,
      summary: parsed.summary,
      concerns: parsed.concerns,
      verifySuggestions,
      patchPath,
      model: input.model,
      agent: input.agent,
      reviewedAt: Date.now(),
    })

    await HarnessState.updateProposal(input.proposalID, (current) => ({
      ...current,
      reviewArtifacts: appendUnique(current.reviewArtifacts, [rawPath, reportPath]),
      reviewVerdict: parsed.approved ? "approve" : "reject",
      reviewSummary: parsed.summary,
      reviewedAt: Date.now(),
    }))

    await HarnessState.appendObservation({
      source: "analyzer",
      kind: parsed.approved ? "patch.review_approved" : "patch.review_rejected",
      message: `${parsed.approved ? "Approved" : "Rejected"} generated patch for proposal ${input.proposalID}.`,
      data: {
        proposalID: input.proposalID,
        sessionID: result.sessionID,
        patchPath,
        summary: parsed.summary,
      },
    })

    return {
      proposalID: input.proposalID,
      verdict: parsed.verdict,
      approved: parsed.approved,
      summary: parsed.summary,
      concerns: parsed.concerns,
      verifySuggestions,
      sessionID: result.sessionID,
      patchPath,
      rawPath,
      reportPath,
      raw: result.raw,
    }
  }
}
