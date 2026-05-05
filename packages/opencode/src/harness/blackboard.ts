import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Log } from "@/util/log"
import { isDeepStrictEqual } from "util"

const log = Log.create({ service: "harness.blackboard" })
const stateSchema = z.record(z.string(), z.unknown())

type State = z.infer<typeof stateSchema>
type EventValue = unknown

function arrayValue(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined
  return Array.from(value as Iterable<unknown>)
}

/**
 * Real-Time Swarm Blackboard
 * A low-latency shared state tree for orchestrator-worker swarms to communicate
 * without needing to pass full contexts through the LLM.
 */
const Event = {
  Update: BusEvent.define(
    "harness.blackboard.update",
    z.object({
      rootSessionID: z.string(),
      key: z.string(),
      value: z.unknown(),
      updaterSessionID: z.string(),
      timestamp: z.number(),
    }),
  ),
}

const stores = new Map<string, State>()
const sessionToRoot = new Map<string, string>()
const writeLocks = new Map<string, Promise<void>>()

async function publishUpdate(rootSessionID: string, key: string, value: EventValue, updaterSessionID: string) {
  await Bus.publish(Event.Update, {
    rootSessionID,
    key,
    value,
    updaterSessionID,
    timestamp: Date.now(),
  })
}

async function mutate<T>(
  sessionID: string,
  updaterSessionID: string,
  fn: (rootID: string, store: State) => Promise<T> | T,
): Promise<T> {
  const rootID = getRootID(sessionID)
  const currentLock = writeLocks.get(rootID) ?? Promise.resolve()
  let release: () => void = () => {}
  const nextLock = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = currentLock.then(() => nextLock)
  writeLocks.set(rootID, chained)
  await currentLock
  try {
    return await fn(rootID, getStore(rootID))
  } finally {
    release()
    if (writeLocks.get(rootID) === chained) {
      writeLocks.delete(rootID)
    }
  }
}

function registerSession(sessionID: string, rootSessionID: string) {
  sessionToRoot.set(sessionID, rootSessionID)
}

function getRootID(sessionID: string): string {
  return sessionToRoot.get(sessionID) || sessionID
}

function getStore(sessionID: string): State {
  const rootID = getRootID(sessionID)
  const existing = stores.get(rootID)
  if (existing) return existing
  const created: State = {}
  stores.set(rootID, created)
  return created
}

async function set(sessionID: string, key: string, value: unknown, updaterSessionID: string) {
  await mutate(sessionID, updaterSessionID, async (rootID, store) => {
    store[key] = value
    log.debug(`Blackboard [${rootID}] updated by ${updaterSessionID} key: ${key}`)
    await publishUpdate(rootID, key, value, updaterSessionID)
  })
}

async function compareAndSwap(
  sessionID: string,
  key: string,
  expectedValue: unknown,
  newValue: unknown,
  updaterSessionID: string,
) {
  return mutate(sessionID, updaterSessionID, async (rootID, store) => {
    const currentValue = store[key]
    const success = isDeepStrictEqual(currentValue, expectedValue)
    if (!success) {
      log.debug(`Blackboard [${rootID}] compareAndSwap failed by ${updaterSessionID} key: ${key}`)
      return {
        success,
        currentValue,
      }
    }

    store[key] = newValue
    log.debug(`Blackboard [${rootID}] compareAndSwap succeeded by ${updaterSessionID} key: ${key}`)
    await publishUpdate(rootID, key, newValue, updaterSessionID)
    return {
      success,
      currentValue: newValue,
    }
  })
}

async function increment(sessionID: string, key: string, delta: number, updaterSessionID: string) {
  return mutate(sessionID, updaterSessionID, async (rootID, store) => {
    const currentValue = store[key]
    const baseValue = currentValue === undefined ? 0 : currentValue
    if (typeof baseValue !== "number" || Number.isNaN(baseValue)) {
      throw new Error(`Blackboard key '${key}' is not numeric and cannot be incremented.`)
    }
    const nextValue = baseValue + delta
    store[key] = nextValue
    log.debug(`Blackboard [${rootID}] incremented by ${updaterSessionID} key: ${key}`)
    await publishUpdate(rootID, key, nextValue, updaterSessionID)
    return nextValue
  })
}

async function append(sessionID: string, key: string, value: unknown, updaterSessionID: string) {
  return mutate(sessionID, updaterSessionID, async (rootID, store) => {
    const currentValue = store[key]
    const list = currentValue === undefined ? [] : arrayValue(currentValue)
    if (!list) {
      throw new Error(`Blackboard key '${key}' is not an array and cannot be appended to.`)
    }
    const appendedValue = [...list, value]
    store[key] = appendedValue
    log.debug(`Blackboard [${rootID}] appended by ${updaterSessionID} key: ${key}`)
    await publishUpdate(rootID, key, appendedValue, updaterSessionID)
    return appendedValue
  })
}

async function deleteKey(sessionID: string, key: string, updaterSessionID: string) {
  return mutate(sessionID, updaterSessionID, async (rootID, store) => {
    const existed = Object.prototype.hasOwnProperty.call(store, key)
    const previousValue = store[key]
    if (existed) {
      delete store[key]
      log.debug(`Blackboard [${rootID}] deleted by ${updaterSessionID} key: ${key}`)
      await publishUpdate(rootID, key, undefined, updaterSessionID)
    }
    return {
      existed,
      previousValue,
    }
  })
}

function get<T>(sessionID: string, key: string): T | undefined {
  const rootID = getRootID(sessionID)
  const store = getStore(rootID)
  return store[key] as T | undefined
}

function getAll(sessionID: string): State {
  const rootID = getRootID(sessionID)
  return getStore(rootID)
}

function clear(sessionID: string) {
  const rootID = getRootID(sessionID)
  stores.delete(rootID)
}

function subscribe(sessionID: string, callback: (key: string, value: unknown, updater: string) => void) {
  const rootID = getRootID(sessionID)
  return Bus.subscribe(Event.Update, (ev) => {
    if (ev.properties.rootSessionID !== rootID) return
    callback(ev.properties.key, ev.properties.value, ev.properties.updaterSessionID)
  })
}

export const HarnessBlackboard = {
  StateSchema: stateSchema,
  Event,
  registerSession,
  getRootID,
  getStore,
  set,
  compareAndSwap,
  increment,
  append,
  deleteKey,
  get,
  getAll,
  clear,
  subscribe,
}

export type HarnessBlackboardState = State
