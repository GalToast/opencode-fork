import z from "zod"

export const CapabilityKind = z.enum(["tool", "command", "mcp_tool", "mcp_prompt", "mcp_resource"])
export type CapabilityKindValue = z.infer<typeof CapabilityKind>

export const CapabilityEntry = z.object({
  id: z.string(),
  kind: CapabilityKind,
  source: z.string(),
  title: z.string(),
  description: z.string().optional(),
  client: z.string().optional(),
  uri: z.string().optional(),
  hints: z.array(z.string()).default([]),
  inputSchema: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type CapabilityEntryValue = z.infer<typeof CapabilityEntry>

export const CapabilityWorkflowStep = z.object({
  title: z.string(),
  capabilityIDs: z.array(z.string()),
  detail: z.string().optional(),
})
export type CapabilityWorkflowStepValue = z.infer<typeof CapabilityWorkflowStep>

export const CapabilityWorkflowBundle = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  uses: z.array(z.string()),
  score: z.number().int().min(0),
  steps: z.array(CapabilityWorkflowStep),
})
export type CapabilityWorkflowBundleValue = z.infer<typeof CapabilityWorkflowBundle>

export const CapabilityPlannerPreview = z.object({
  generatedAt: z.number(),
  catalogCount: z.number().int().min(0),
  suggestions: z.array(CapabilityWorkflowBundle),
})
export type CapabilityPlannerPreviewValue = z.infer<typeof CapabilityPlannerPreview>
