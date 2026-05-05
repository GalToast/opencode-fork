import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./batch.txt"
import type { MessageV2 } from "../session/message-v2"
import { ProviderID, ModelID } from "../provider/schema"
import { PartID } from "../session/schema"

const DISALLOWED = new Set(["batch"])
const FILTERED_FROM_SUGGESTIONS = new Set(["invalid", "patch", ...DISALLOWED])
const MUTATION_TOOLS = new Set(["write", "edit", "multiedit", "patch", "apply_patch"])
const INSPECT_TOOLS = new Set(["read", "grep", "glob", "list", "lsp", "dependency_explorer", "structural_read"])
const MAX_CALLS = 25

const parameters = z.object({
  tool_calls: z
    .array(
      z.object({
        tool: z.string().describe("The name of the tool to execute"),
        parameters: z.object({}).loose().describe("Parameters for the tool"),
      }),
    )
    .min(1, "Provide at least one tool call")
    .describe("Array of tool calls to execute in parallel"),
})

type BatchParams = z.infer<typeof parameters>
type BatchCall = BatchParams["tool_calls"][number]

type BatchMetadata = {
  totalCalls: number
  successful: number
  failed: number
  tools: string[]
  details: Array<{ tool: string; success: boolean }>
}

type InitializedTool = Awaited<ReturnType<Tool.Info["init"]>>
type ToolResult = Awaited<ReturnType<InitializedTool["execute"]>>
type BatchResult =
  | {
      success: true
      tool: string
      result: ToolResult
    }
  | {
      success: false
      tool: string
      error: unknown
    }

function targetResource(call: BatchCall) {
  const filePath = call.parameters["filePath"]
  if (typeof filePath === "string") return filePath
  const path = call.parameters["path"]
  if (typeof path === "string") return path
  return undefined
}

function findBatchSafetyError(toolCalls: BatchCall[]) {
  const mutations = toolCalls.filter((call) => MUTATION_TOOLS.has(call.tool))
  if (mutations.length > 1) {
    return "Batch contains multiple mutation tools. Run mutation tools one at a time so file state, permissions, and rollback semantics stay clear."
  }

  const mutation = mutations[0]
  if (!mutation) return undefined

  const mutationTarget = targetResource(mutation)
  if (!mutationTarget) return undefined

  for (const call of toolCalls) {
    if (call === mutation) continue
    if (!INSPECT_TOOLS.has(call.tool)) continue
    if (targetResource(call) === mutationTarget) {
      return "Batch calls target the same resource with both inspect and mutate operations. Read or inspect first, then issue the mutation separately."
    }
  }

  return undefined
}

function formatValidationError(error: z.ZodError<BatchParams>) {
  const formattedErrors = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root"
      return `  - ${path}: ${issue.message}`
    })
    .join("\n")

  return `Invalid parameters for tool 'batch':\n${formattedErrors}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
}

function createRunningPart(
  call: BatchCall,
  ctx: Tool.Context<BatchMetadata>,
  partID: PartID,
  start: number,
): MessageV2.ToolPart {
  return {
    id: partID,
    messageID: ctx.messageID,
    sessionID: ctx.sessionID,
    type: "tool",
    tool: call.tool,
    callID: partID,
    state: {
      status: "running",
      input: call.parameters,
      time: { start },
    },
  }
}

function createCompletedPart(
  call: BatchCall,
  ctx: Tool.Context<BatchMetadata>,
  partID: PartID,
  start: number,
  result: ToolResult,
  attachments: MessageV2.FilePart[] | undefined,
): MessageV2.ToolPart {
  return {
    id: partID,
    messageID: ctx.messageID,
    sessionID: ctx.sessionID,
    type: "tool",
    tool: call.tool,
    callID: partID,
    state: {
      status: "completed",
      input: call.parameters,
      output: result.output,
      title: result.title,
      metadata: result.metadata,
      attachments,
      time: {
        start,
        end: Date.now(),
      },
    },
  }
}

function createErrorPart(
  call: BatchCall,
  ctx: Tool.Context<BatchMetadata>,
  partID: PartID,
  start: number,
  message: string,
  end = Date.now(),
): MessageV2.ToolPart {
  return {
    id: partID,
    messageID: ctx.messageID,
    sessionID: ctx.sessionID,
    type: "tool",
    tool: call.tool,
    callID: partID,
    state: {
      status: "error",
      input: call.parameters,
      error: message,
      time: { start, end },
    },
  }
}

export const BatchTool = Tool.define("batch", {
  description: DESCRIPTION,
  parameters,
  formatValidationError,
  async execute(params: BatchParams, ctx: Tool.Context<BatchMetadata>) {
      const { Session }: typeof import("../session") = await import("../session")
      const { ToolRegistry }: typeof import("./registry") = await import("./registry")

      const toolCalls = params.tool_calls.slice(0, MAX_CALLS)
      const discardedCalls = params.tool_calls.slice(MAX_CALLS)
      const safetyError = findBatchSafetyError(toolCalls)
      if (safetyError) {
        const start = Date.now()
        const results: BatchResult[] = toolCalls.map((call) => {
          const partID = PartID.ascending()
          Session.updatePart(createErrorPart(call, ctx, partID, start, safetyError, start))
          return { success: false, tool: call.tool, error: new Error(safetyError) }
        })
        return {
          title: `Batch execution (0/${results.length} successful)`,
          output: `Executed 0/${results.length} tools successfully. ${results.length} failed.`,
          attachments: [],
          metadata: {
            totalCalls: results.length,
            successful: 0,
            failed: results.length,
            tools: params.tool_calls.map((call) => call.tool),
            details: results.map((result) => ({ tool: result.tool, success: result.success })),
          },
        }
      }
      const availableTools = await ToolRegistry.tools({ modelID: "" as ModelID, providerID: "" as ProviderID })
      const toolMap = new Map(availableTools.map((tool) => [tool.id, tool] as const))

      const executeCall = async (call: BatchCall): Promise<BatchResult> => {
        const start = Date.now()
        const partID = PartID.ascending()

        try {
          if (DISALLOWED.has(call.tool)) {
            throw new Error(
              `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`,
            )
          }

          const tool = toolMap.get(call.tool)
          if (!tool) {
            const available = Array.from(toolMap.keys()).filter((name) => !FILTERED_FROM_SUGGESTIONS.has(name))
            throw new Error(
              `Tool '${call.tool}' not in registry. External tools (MCP, environment) cannot be batched - call them directly. Available tools: ${available.join(", ")}`,
            )
          }

          const validated = tool.parameters.parse(call.parameters)
          Session.updatePart(createRunningPart(call, ctx, partID, start))

          const result = await tool.execute(validated, { ...ctx, callID: partID })
          const attachments = result.attachments?.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
          }))

          Session.updatePart(createCompletedPart(call, ctx, partID, start, result, attachments))
          return { success: true, tool: call.tool, result }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          Session.updatePart(createErrorPart(call, ctx, partID, start, message))
          return { success: false, tool: call.tool, error }
        }
      }

      const results: BatchResult[] = await Promise.all(toolCalls.map((call) => executeCall(call)))
      const now = Date.now()

      for (const call of discardedCalls) {
        const partID = PartID.ascending()
        const message = `Maximum of ${MAX_CALLS} tools allowed in batch`
        Session.updatePart(createErrorPart(call, ctx, partID, now, message, now))
        results.push({
          success: false,
          tool: call.tool,
          error: new Error(message),
        })
      }

      const successful = results.filter((result) => result.success).length
      const failed = results.length - successful
      const output =
        failed > 0
          ? `Executed ${successful}/${results.length} tools successfully. ${failed} failed.`
          : `All ${successful} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`

      return {
        title: `Batch execution (${successful}/${results.length} successful)`,
        output,
        attachments: results.flatMap((result) => (result.success ? result.result.attachments ?? [] : [])),
        metadata: {
          totalCalls: results.length,
          successful,
          failed,
          tools: params.tool_calls.map((call) => call.tool),
          details: results.map((result) => ({ tool: result.tool, success: result.success })),
        },
      }
    },
  },
)
