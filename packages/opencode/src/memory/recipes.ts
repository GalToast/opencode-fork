// Cross-Session Recipes — when the agent solves a problem through a sequence
// of steps, it can distill that into a reusable "recipe" that persists across
// sessions. Future sessions can retrieve and replay relevant recipes.

import { createHash } from "crypto"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "memory.recipes" })

export type RecipeStep = {
  tool: string
  description: string
  args: Record<string, unknown>
  order: number
}

export type Recipe = {
  id: string
  projectID: string
  name: string
  description: string
  trigger: string
  steps: RecipeStep[]
  tags: string[]
  uses: number
  confidence: number
  origin: {
    sessionID: string
    at: number
  }
  at: number
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

async function create(input: {
  projectID: string
  sessionID: string
  name: string
  description: string
  trigger: string
  steps: Omit<RecipeStep, "order">[]
  tags?: string[]
  confidence?: number
}): Promise<Recipe> {
  const recipe: Recipe = {
    id: Identifier.ascending("part"),
    projectID: input.projectID,
    name: input.name,
    description: input.description,
    trigger: input.trigger,
    steps: input.steps.map((s, i) => ({ ...s, order: i })),
    tags: input.tags ?? [],
    uses: 0,
    confidence: input.confidence ?? 0.7,
    origin: {
      sessionID: input.sessionID,
      at: Date.now(),
    },
    at: Date.now(),
  }

  await persist(recipe)

  log.debug("recipe.created", {
    id: recipe.id,
    name: recipe.name,
    steps: recipe.steps.length,
  })

  return recipe
}

// ---------------------------------------------------------------------------
// Search — find recipes relevant to a task description
// ---------------------------------------------------------------------------

async function search(input: {
  projectID: string
  query: string
  limit?: number
}): Promise<Recipe[]> {
  const { RetrievalService } = await import("@/retrieval")

  const result = await RetrievalService.search({
    projectID: input.projectID,
    query: input.query,
    policy: "fast",
    limit: input.limit ?? 5,
    sourceTypes: ["task_artifact"],
    metadata: { trigger: "recipe_search" },
  })

  const recipes: Recipe[] = []
  for (const candidate of result.candidates) {
    try {
      const meta = candidate.metadata as Record<string, unknown> | undefined
      if (meta?.kind !== "recipe") continue
      const parsed = JSON.parse(candidate.content) as Recipe
      recipes.push(parsed)
    } catch {
      continue
    }
  }

  return recipes
}

/** Record that a recipe was used (boosts its confidence). */
async function use(id: string, projectID: string) {
  const { RetrievalService } = await import("@/retrieval")

  // Update the document's outcome score positively
  const docID = `recipe-${id}`
  try {
    await RetrievalService.upsertDocument({
      id: docID,
      projectID,
      sourceType: "task_artifact",
      sourceID: id,
      title: `Recipe used: ${id}`,
      fingerprint: `${id}:used:${Date.now()}`,
      metadata: { kind: "recipe", used: true },
      outcomeScore: 1.5,
      negativeSignal: false,
    })
  } catch {
    // Silently fail
  }
}

// ---------------------------------------------------------------------------
// Distill — auto-create a recipe from a sequence of tool calls
// ---------------------------------------------------------------------------

async function distill(input: {
  projectID: string
  sessionID: string
  name: string
  description: string
  trigger: string
  calls: { tool: string; args: Record<string, unknown>; description: string }[]
}): Promise<Recipe> {
  // Filter out read-only calls that don't contribute to the recipe
  const meaningful = input.calls.filter((c) =>
    !c.tool.includes("read") && !c.tool.includes("search") && !c.tool.includes("list"),
  )

  return create({
    projectID: input.projectID,
    sessionID: input.sessionID,
    name: input.name,
    description: input.description,
    trigger: input.trigger,
    steps: meaningful.map((c) => ({
      tool: c.tool,
      description: c.description,
      args: c.args,
    })),
    tags: [...new Set(meaningful.map((c) => c.tool))],
  })
}

// ---------------------------------------------------------------------------
// Persistence via retrieval engine
// ---------------------------------------------------------------------------

async function persist(recipe: Recipe) {
  const { RetrievalService } = await import("@/retrieval")

  const content = JSON.stringify(recipe, null, 2)
  const fingerprint = createHash("sha1").update(content).digest("hex")
  const id = `recipe-${recipe.id}`

  await RetrievalService.upsertDocument({
    id,
    projectID: recipe.projectID,
    sessionID: recipe.origin.sessionID,
    sourceType: "task_artifact",
    sourceID: recipe.id,
    title: `Recipe: ${recipe.name} — ${recipe.description.slice(0, 50)}`,
    fingerprint,
    metadata: {
      kind: "recipe",
      trigger: recipe.trigger,
      tags: recipe.tags,
      steps: recipe.steps.length,
    },
    outcomeScore: recipe.confidence,
    negativeSignal: false,
  })

  await RetrievalService.replaceChunks({
    documentID: id,
    projectID: recipe.projectID,
    content: [
      `Recipe: ${recipe.name}`,
      `trigger: ${recipe.trigger}`,
      `description: ${recipe.description}`,
      `tags: ${recipe.tags.join(", ")}`,
      `steps:`,
      ...recipe.steps.map((s) => `  ${s.order + 1}. [${s.tool}] ${s.description}`),
    ].join("\n"),
    chunkType: "recipe",
  })
}

export const Recipes = {
  create,
  search,
  distill,
  use,
} as const
