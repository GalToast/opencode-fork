import z from "zod"

export const AgentOperatingState = z
  .object({
    summary: z.string(),
    layers: z.array(z.string()).max(8),
    worldState: z
      .object({
        summary: z.string().optional(),
        riskCount: z.number().int().min(0),
        openLoopCount: z.number().int().min(0),
        closedLoopCount: z.number().int().min(0),
      })
      .optional(),
    reasoning: z
      .object({
        summary: z.string().optional(),
        commitmentCount: z.number().int().min(0),
        assumptionCount: z.number().int().min(0),
        falsifierCount: z.number().int().min(0),
        transitionCount: z.number().int().min(0),
      })
      .optional(),
    social: z
      .object({
        summary: z.string().optional(),
        pairingCount: z.number().int().min(0),
        handoffCount: z.number().int().min(0),
        stallCount: z.number().int().min(0),
      })
      .optional(),
    planning: z
      .object({
        mode: z.enum(["baseline", "semantic"]).optional(),
        patternCount: z.number().int().min(0),
      })
      .optional(),
    decomposition: z
      .object({
        mode: z.enum(["baseline", "semantic"]).optional(),
        suggestedLaneCount: z.number().int().min(0),
        parallelStrategy: z.enum(["serial", "parallel", "hybrid"]).optional(),
      })
      .optional(),
  })
  .meta({
    ref: "SessionWorkGraphAgentState",
  })

export type AgentOperatingState = z.infer<typeof AgentOperatingState>

export function agentOperatingStateLines(agentState?: AgentOperatingState) {
  return agentState
    ? [`agent_state_layers: ${agentState.layers.join(", ")}`, `agent_state_summary: ${agentState.summary}`]
    : []
}
