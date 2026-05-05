import path from "path"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import { Global } from "../global"
import z from "zod"
import { Glob } from "./glob"

export const LogLevelSchema = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
export type LogLevel = z.infer<typeof LogLevelSchema>

type LogFields = Record<string, unknown>
type LogWriter = (msg: string) => number | Promise<number>

const levelPriority: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

let level: LogLevel = "INFO"

function shouldLog(input: LogLevel): boolean {
  return levelPriority[input] >= levelPriority[level]
}

export type Logger = {
  debug(message?: unknown, extra?: LogFields): void
  info(message?: unknown, extra?: LogFields): void
  error(message?: unknown, extra?: LogFields): void
  warn(message?: unknown, extra?: LogFields): void
  tag(key: string, value: string): Logger
  clone(): Logger
  time(
    message: string,
    extra?: LogFields,
  ): {
    stop(): void
    [Symbol.dispose](): void
  }
}

const loggers = new Map<string, Logger>()

export interface Options {
  print: boolean
  dev?: boolean
  level?: LogLevel
}

let logpath = ""

function file() {
  return logpath
}

let write: LogWriter = (msg) => {
  process.stderr.write(msg)
  return msg.length
}

async function init(options: Options) {
  if (options.level) level = options.level
  void cleanup(Global.Path.log)
  if (options.print) return
  logpath = path.join(
    Global.Path.log,
    options.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
  )
  await fs.truncate(logpath).catch(() => {})
  const stream = createWriteStream(logpath, { flags: "a" })
  write = async (msg) => {
    return new Promise<number>((resolve, reject) => {
      stream.write(msg, (err) => {
        if (err) reject(err)
        else resolve(msg.length)
      })
    })
  }
}

async function cleanup(dir: string) {
  const files = await Glob.scan("????-??-??T??????.log", {
    cwd: dir,
    absolute: true,
    include: "file",
  })
  if (files.length <= 5) return

  const filesToDelete = files.slice(0, -10)
  await Promise.all(filesToDelete.map((staleFile) => fs.unlink(staleFile).catch(() => {})))
}

function formatError(error: Error, depth = 0): string {
  const result = error.message
  return error.cause instanceof Error && depth < 10 ? result + " Caused by: " + formatError(error.cause, depth + 1) : result
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return formatError(value)
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (typeof value === "symbol") return value.toString()
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  return JSON.stringify(value)
}

let last = Date.now()

function create(tags: LogFields = {}): Logger {
  const service = tags["service"]
  if (typeof service === "string") {
    const cached = loggers.get(service)
    if (cached) {
      return cached
    }
  }

  function build(message: unknown, extra?: LogFields) {
    const prefix = Object.entries({
      ...tags,
      ...extra,
    })
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(" ")
    const next = new Date()
    const diff = next.getTime() - last
    last = next.getTime()
    return [next.toISOString().split(".")[0], "+" + diff + "ms", prefix, message === undefined ? undefined : formatValue(message)]
      .filter(Boolean)
      .join(" ") + "\n"
  }

  const result: Logger = {
    debug(message?: unknown, extra?: LogFields) {
      if (shouldLog("DEBUG")) {
        void write("DEBUG " + build(message, extra))
      }
    },
    info(message?: unknown, extra?: LogFields) {
      if (shouldLog("INFO")) {
        void write("INFO  " + build(message, extra))
      }
    },
    error(message?: unknown, extra?: LogFields) {
      if (shouldLog("ERROR")) {
        void write("ERROR " + build(message, extra))
      }
    },
    warn(message?: unknown, extra?: LogFields) {
      if (shouldLog("WARN")) {
        void write("WARN  " + build(message, extra))
      }
    },
    tag(key: string, value: string) {
      tags[key] = value
      return result
    },
    clone() {
      return create({ ...tags })
    },
    time(message: string, extra?: LogFields) {
      const now = Date.now()
      result.info(message, { status: "started", ...extra })
      function stop() {
        result.info(message, {
          status: "completed",
          duration: Date.now() - now,
          ...extra,
        })
      }
      return {
        stop,
        [Symbol.dispose]() {
          stop()
        },
      }
    },
  }

  if (typeof service === "string") {
    loggers.set(service, result)
  }

  return result
}

export const Default = create({ service: "default" })

export const Log = {
  Level: LogLevelSchema,
  Default,
  init,
  file,
  create,
}
