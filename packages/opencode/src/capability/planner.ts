import { CapabilityCatalog } from "./catalog"
import {
  CapabilityPlannerPreview,
  type CapabilityEntryValue as CapabilityEntry,
  type CapabilityWorkflowBundleValue as CapabilityWorkflowBundle,
} from "./schema"

function byID(capabilities: CapabilityEntry[]) {
  return new Map(capabilities.map((entry) => [entry.id, entry]))
}

function has(capabilities: Map<string, CapabilityEntry>, ...ids: string[]) {
  return ids.some((id) => capabilities.has(id))
}

function present(capabilities: Map<string, CapabilityEntry>, ...ids: string[]) {
  return ids.filter((id) => capabilities.has(id))
}

function pushBundle(
  result: CapabilityWorkflowBundle[],
  bundle: CapabilityWorkflowBundle | undefined,
): asserts bundle is CapabilityWorkflowBundle {
  if (bundle) result.push(bundle)
}

const BROWSER_MCP_CLIENT_IDS = new Set(["playwright", "chrome-devtools"])

function isBrowserCapability(entry: CapabilityEntry) {
  if (entry.client && BROWSER_MCP_CLIENT_IDS.has(entry.client)) return true
  return (
    entry.id.startsWith("playwright_") ||
    entry.id.startsWith("chrome-devtools_") ||
    entry.id.startsWith("chrome_devtools_")
  )
}

function previewFrom(capabilities: CapabilityEntry[]) {
  const catalog = byID(capabilities)
  const suggestions: CapabilityWorkflowBundle[] = []

    const inspectPatchRead = present(catalog, "read", "grep", "glob")
    const inspectPatchWrite = present(catalog, "apply_patch", "edit", "write")
    pushBundle(
      suggestions,
      inspectPatchRead.length > 0 && inspectPatchWrite.length > 0
        ? {
            id: "inspect-and-patch",
            title: "Inspect and Patch Code",
            rationale:
              "This workspace can inspect files, narrow the search surface, and apply targeted edits without needing a heavier execution plan.",
            uses: [...inspectPatchRead, ...inspectPatchWrite],
            score: inspectPatchRead.length + inspectPatchWrite.length + 1,
            steps: [
              {
                title: "Map the relevant files",
                capabilityIDs: present(catalog, "glob", "grep").length > 0 ? present(catalog, "glob", "grep") : ["read"],
                detail: "Locate the files and symbols that matter before editing.",
              },
              {
                title: "Read the exact implementation surface",
                capabilityIDs: present(catalog, "read"),
                detail: "Pull the most relevant snippets and confirm behavior.",
              },
              {
                title: "Apply the smallest safe patch",
                capabilityIDs: inspectPatchWrite,
                detail: "Patch the code directly, preferring the narrowest edit surface available.",
              },
            ],
          }
        : undefined,
    )

    const researchInputs = present(catalog, "webfetch", "websearch")
    const researchRemote = capabilities
      .filter((entry) => entry.kind === "mcp_resource" || entry.kind === "mcp_prompt")
      .map((entry) => entry.id)
      .slice(0, 3)
    pushBundle(
      suggestions,
      researchInputs.length > 0 || researchRemote.length > 0
        ? {
            id: "research-and-summarize",
            title: "Research and Summarize",
            rationale:
              "The current capability mix supports gathering external or MCP-provided context, then turning it into a concise working summary.",
            uses: [...researchInputs, ...researchRemote],
            score: researchInputs.length + researchRemote.length,
            steps: [
              {
                title: "Collect the strongest source material",
                capabilityIDs: [...present(catalog, "websearch", "webfetch"), ...researchRemote].slice(0, 4),
                detail: "Use search/fetch and MCP resources/prompts to gather the primary inputs.",
              },
              {
                title: "Extract the decision-relevant facts",
                capabilityIDs: present(catalog, "read").length > 0 ? present(catalog, "read") : researchInputs,
                detail: "Trim the material down to the facts that matter for the request.",
              },
              {
                title: "Produce a human-usable summary",
                capabilityIDs: capabilities.filter((entry) => entry.kind === "command").map((entry) => entry.id).slice(0, 2),
                detail: "Package the findings into a short answer, memo, or next-step recommendation.",
              },
            ],
          }
        : undefined,
    )

    const delegation = present(catalog, "task", "question")
    const commandHelp = capabilities
      .filter((entry) => entry.kind === "command" && ["review", "init"].includes(entry.id))
      .map((entry) => entry.id)
    pushBundle(
      suggestions,
      delegation.length > 0
        ? {
            id: "delegate-and-synthesize",
            title: "Delegate and Synthesize",
            rationale:
              "This environment has the pieces for parallel investigation or review lanes, then a final synthesis back in the main thread.",
            uses: [...delegation, ...commandHelp],
            score: delegation.length + commandHelp.length + 1,
            steps: [
              {
                title: "Split the work into clear lanes",
                capabilityIDs: present(catalog, "task"),
                detail: "Break the request into a few narrow parallel tracks with explicit goals.",
              },
              {
                title: "Use commands or questions to tighten the brief",
                capabilityIDs: [...present(catalog, "question"), ...commandHelp].slice(0, 3),
                detail: "Use lightweight command/question surfaces to sharpen or redirect the plan before execution.",
              },
              {
                title: "Merge the lane outputs into one answer",
                capabilityIDs: present(catalog, "task"),
                detail: "Collect the outputs and synthesize them into one coordinated result.",
              },
            ],
          }
        : undefined,
    )

    const repoBootstrap = capabilities
      .filter((entry) => entry.kind === "command" && ["init", "review"].includes(entry.id))
      .map((entry) => entry.id)
    pushBundle(
      suggestions,
      repoBootstrap.length > 0 && has(catalog, "read", "bash")
        ? {
            id: "bootstrap-and-review",
            title: "Bootstrap and Review a Repo",
            rationale:
              "The available command surfaces suggest this environment is ready for repo setup and review-oriented terminal workflows.",
            uses: [...repoBootstrap, ...present(catalog, "read", "bash")],
            score: repoBootstrap.length + present(catalog, "read", "bash").length,
            steps: [
              {
                title: "Initialize or refresh repo guidance",
                capabilityIDs: repoBootstrap.filter((id) => id === "init"),
                detail: "Use init-style guidance to establish or update repo operating context.",
              },
              {
                title: "Inspect the current tree and diffs",
                capabilityIDs: present(catalog, "read", "bash"),
                detail: "Read the working tree and shell state before making changes.",
              },
              {
                title: "Run a review-oriented pass",
                capabilityIDs: repoBootstrap.filter((id) => id === "review"),
                detail: "Use the review command surface to produce a focused bug/risk pass.",
              },
            ],
          }
        : undefined,
    )

    const browserCapabilities = capabilities.filter(
      (entry) => entry.kind === "mcp_tool" && isBrowserCapability(entry),
    )
    pushBundle(
      suggestions,
      browserCapabilities.length > 0
        ? {
            id: "browser-automation-and-debug",
            title: "Automate and Debug in a Real Browser",
            rationale:
              "Browser tools are already available here, so you can navigate, inspect, and capture evidence directly in a live browser.",
            uses: browserCapabilities.map((entry) => entry.id).slice(0, 4),
            score: browserCapabilities.length + 1,
            steps: [
              {
                title: "Drive or inspect the page",
                capabilityIDs: browserCapabilities.map((entry) => entry.id).slice(0, 3),
                detail: "Use the available browser tools to navigate, inspect, or exercise the live UI.",
              },
              {
                title: "Capture evidence and verify behavior",
                capabilityIDs: browserCapabilities.map((entry) => entry.id).slice(0, 4),
                detail: "Prefer targeted browser captures or DOM state to confirm the result and explain issues clearly.",
              },
            ],
          }
        : undefined,
    )

  return CapabilityPlannerPreview.parse({
    generatedAt: Date.now(),
    catalogCount: capabilities.length,
    suggestions: suggestions.toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 4),
  })
}

async function preview() {
  return previewFrom(await CapabilityCatalog.list())
}

export const CapabilityPlanner = {
  previewFrom,
  preview,
}
