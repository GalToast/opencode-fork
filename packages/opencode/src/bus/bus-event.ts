import z from "zod"
import type { ZodType } from "zod"
import { Log } from "../util/log"

const log = Log.create({ service: "event" })

export type BusEventDefinition = ReturnType<typeof define>

const registry = new Map<string, BusEventDefinition>()

function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
  const result = {
    type,
    properties,
  }
  registry.set(type, result)
  return result
}

function payloads() {
  const variants = registry
    .entries()
    .map(([type, def]) =>
      z
        .object({
          type: z.literal(type),
          properties: def.properties,
        })
        .meta({
          ref: "Event" + "." + def.type,
        }),
    )
    .toArray()

  if (variants.length === 0) {
    log.warn("payloads requested before any bus events were registered")
    return z.never().meta({ ref: "Event" })
  }

  return z.discriminatedUnion("type", variants as [typeof variants[number], ...Array<typeof variants[number]>]).meta({
    ref: "Event",
  })
}

export const BusEvent = {
  define,
  payloads,
}
