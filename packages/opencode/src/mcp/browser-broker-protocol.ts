import z from "zod"

export const BrokerName = z.enum(["playwright", "chrome-devtools"])
export type BrokerName = z.infer<typeof BrokerName>

export const BrokerMeta = z.object({
  version: z.literal(1),
  host: z.string(),
  port: z.number().int().positive(),
  pid: z.number().int().positive(),
  token: z.string().min(1),
  directory: z.string(),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type BrokerMeta = z.infer<typeof BrokerMeta>

export const BrokerPingInput = z.object({})
export type BrokerPingInput = z.infer<typeof BrokerPingInput>

export const BrokerEnsureInput = z.object({
  name: BrokerName,
})
export type BrokerEnsureInput = z.infer<typeof BrokerEnsureInput>

export const BrokerDisconnectInput = z.object({
  name: BrokerName,
})
export type BrokerDisconnectInput = z.infer<typeof BrokerDisconnectInput>

export const BrokerListToolsInput = z.object({
  name: BrokerName,
})
export type BrokerListToolsInput = z.infer<typeof BrokerListToolsInput>

export const BrokerPong = z.object({
  pid: z.number().int().positive(),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  uptimeSec: z.number().nonnegative(),
})

export type BrokerPong = z.infer<typeof BrokerPong>

export const BrokerEnsureOutput = z.object({
  connected: z.boolean(),
})
export type BrokerEnsureOutput = z.infer<typeof BrokerEnsureOutput>

export const BrokerDisconnectOutput = z.object({
  disconnected: z.boolean(),
})
export type BrokerDisconnectOutput = z.infer<typeof BrokerDisconnectOutput>

export const BrokerTool = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.unknown(),
  })
  .passthrough()
export type BrokerTool = z.infer<typeof BrokerTool>

export const BrokerListToolsOutput = z.object({
  tools: z.array(BrokerTool),
  cached: z.boolean(),
  connected: z.boolean(),
})
export type BrokerListToolsOutput = z.infer<typeof BrokerListToolsOutput>

export const BrokerReq = z.object({
  token: z.string().min(1),
  method: z.enum(["ping", "ensureConnected", "disconnect", "listTools"]),
  input: z.unknown().optional(),
})

export type BrokerReq = z.infer<typeof BrokerReq>

export const BrokerOk = z.object({
  ok: z.literal(true),
  result: z.unknown(),
})

export const BrokerErr = z.object({
  ok: z.literal(false),
  error: z.string(),
})

export const BrokerRes = z.union([BrokerOk, BrokerErr])
export type BrokerRes = z.infer<typeof BrokerRes>
