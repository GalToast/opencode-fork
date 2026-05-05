import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import { fileURLToPath } from "url"
import z from "zod"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Tool } from "./tool"

const log = Log.create({ service: "node-repl-tool" })

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_OUTPUT_CHARS = 40_000
const NODE_BINARY = process.env.OPENCODE_NODE_REPL_BINARY || "node"
const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

type KernelRequest = {
  id: number
  code?: string
  reset?: boolean
}

type KernelResponse =
  | {
      id: number
      ok: true
      logs?: string[]
      resultText?: string
    }
  | {
      id: number
      ok: false
      error: string
      logs?: string[]
      timeout?: true
    }

type PendingRequest = {
  resolve: (response: KernelResponse) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type KernelState = {
  child: ChildProcessWithoutNullStreams
  pending: Map<number, PendingRequest>
  nextRequestID: number
  stderr: string[]
  closed: boolean
}

type NodeReplMetadata = {
  ok: boolean
  status: "ok" | "error" | "timeout"
  logs: string[]
  reset: boolean
  timeout: boolean
  spawnError?: boolean
  resultText?: string
  resultType?: "undefined" | "number" | "boolean" | "string"
}

const runtime = Instance.state(
  () =>
    ({
      kernels: new Map<string, KernelState>(),
    }) satisfies {
      kernels: Map<string, KernelState>
    },
  async (state) => {
    for (const kernel of state.kernels.values()) {
      try {
        kernel.child.kill()
      } catch (err) {
        log.debug("node-repl.kernel.kill.failed", { err })
      }
      for (const pending of kernel.pending.values()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error("Node REPL kernel disposed"))
      }
      kernel.pending.clear()
    }
    state.kernels.clear()
  },
)

function truncate(text: string | undefined) {
  if (!text) return ""
  if (text.length <= MAX_OUTPUT_CHARS) return text
  return text.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]"
}

function kernelBootstrap() {
  return String.raw`
const { createRequire } = require("node:module");
const projectRequire = createRequire(process.cwd() + "/node_repl.js");
const toolRequire = createRequire((process.env.OPENCODE_NODE_REPL_TOOL_ROOT || process.cwd()) + "/node_repl_tool.js");
const babel = toolRequire("@babel/core");
const vm = require("node:vm");
const readline = require("node:readline");
const util = require("node:util");

function cloneGlobals() {
  const sandbox = Object.create(null);
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (name === "global" || name === "globalThis" || name === "self") continue;
    try {
      sandbox[name] = globalThis[name];
    } catch (err) { console.debug("repl.sandbox.property.failed", { name, err }) }
  }
  sandbox.process = process;
  sandbox.require = projectRequire;
  sandbox.module = module;
  sandbox.exports = exports;
  sandbox.__filename = __filename;
  sandbox.__dirname = __dirname;
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  sandbox.codex = { cwd: process.cwd(), node: process.version };
  return sandbox;
}

function createRuntime() {
  const sandbox = cloneGlobals();
  return {
    sandbox,
    context: vm.createContext(sandbox),
  };
}

let runtime = createRuntime();

function render(value) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return util.inspect(value, { depth: 6, colors: false, maxArrayLength: 100, breakLength: 120 });
}

function makeConsole(logs) {
  const sink = (...args) => {
    logs.push(args.map((arg) => (typeof arg === "string" ? arg : util.inspect(arg, { depth: 6, colors: false }))).join(" "));
  };
  return {
    log: sink,
    info: sink,
    warn: sink,
    error: sink,
    debug: sink,
  };
}

function resetContext() {
  runtime = createRuntime();
}

function parseProgram(code) {
  try {
    const file = babel.parseSync(code, {
      sourceType: "module",
      babelrc: false,
      configFile: false,
      parserOpts: {
        plugins: ["topLevelAwait", "importAttributes", "jsx"],
      },
    });
    return file && file.program ? file.program : null;
  } catch {
    return null;
  }
}

function entersFunctionScope(node) {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod"
  );
}

function hasTopLevelAwait(node, functionDepth = 0) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) {
    return node.some((item) => hasTopLevelAwait(item, functionDepth));
  }
  if (node.type === "AwaitExpression" && functionDepth === 0) return true;

  const nextDepth = entersFunctionScope(node) ? functionDepth + 1 : functionDepth;
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "extra" ||
      key === "leadingComments" ||
      key === "innerComments" ||
      key === "trailingComments"
    ) {
      continue;
    }
    if (hasTopLevelAwait(value, nextDepth)) return true;
  }
  return false;
}

function getLastExpressionStatement(program) {
  for (let i = program.body.length - 1; i >= 0; i--) {
    const statement = program.body[i];
    if (!statement || statement.type === "EmptyStatement") continue;
    if (statement.type === "ExpressionStatement") return statement;
    return null;
  }
  return null;
}

function wrapAwait(code) {
  const source = code || "";
  if (!source.includes("await")) return source;
  const program = parseProgram(source);
  if (!program || !hasTopLevelAwait(program)) return source;

  const lastExpression = getLastExpressionStatement(program);
  if (
    lastExpression &&
    typeof lastExpression.start === "number" &&
    typeof lastExpression.expression?.start === "number" &&
    typeof lastExpression.expression?.end === "number"
  ) {
    const prefix = source.slice(0, lastExpression.start).trimEnd();
    const suffix = source.slice(lastExpression.expression.start, lastExpression.expression.end);
    return "(async () => {\n" + (prefix ? prefix + "\n" : "") + "return (" + suffix + ");\n})()";
  }
  return "(async () => {\n" + source + "\n})()";
}

async function evaluate(code, requestID) {
  const logs = [];
  const previousConsole = runtime.sandbox.console;
  runtime.sandbox.console = makeConsole(logs);
  try {
    const script = code && code.includes("await") ? wrapAwait(code) : code || "";
    let result = vm.runInContext(script, runtime.context, { displayErrors: true });
    if (result && typeof result.then === "function") {
      result = await result;
    }
    process.stdout.write(JSON.stringify({ id: requestID, ok: true, resultText: render(result), logs }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ id: requestID, ok: false, error: error.stack || String(error), logs }) + "\n");
  } finally {
    runtime.sandbox.console = previousConsole;
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    process.stdout.write(JSON.stringify({ id: -1, ok: false, error: String(error) }) + "\n");
    return;
  }

  if (request.reset) {
    resetContext();
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, resultText: "Node REPL kernel reset." }) + "\n");
    return;
  }

  void evaluate(request.code || "", request.id);
});

rl.on("close", () => process.exit(0));
`
}

function createKernel(sessionID: string): KernelState {
  const child = spawn(NODE_BINARY, ["-e", kernelBootstrap()], {
    cwd: Instance.directory,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENCODE_NODE_REPL_TOOL_ROOT: TOOL_ROOT,
    },
  })

  const state: KernelState = {
    child,
    pending: new Map(),
    nextRequestID: 1,
    stderr: [],
    closed: false,
  }

  let stdoutBuffer = ""
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk
    while (true) {
      const newline = stdoutBuffer.indexOf("\n")
      if (newline < 0) break
      const line = stdoutBuffer.slice(0, newline).trim()
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      if (!line) continue
      let parsed: KernelResponse | undefined
      try {
        parsed = JSON.parse(line) as KernelResponse
      } catch (error) {
        log.warn("failed to parse node repl response", { sessionID, line, error })
        continue
      }
      const pending = state.pending.get(parsed.id)
      if (!pending) continue
      clearTimeout(pending.timeout)
      state.pending.delete(parsed.id)
      pending.resolve(parsed)
    }
  })

  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    state.stderr.push(chunk)
    if (state.stderr.length > 20) state.stderr.shift()
  })

  child.on("exit", (code, signal) => {
    state.closed = true
    const error = new Error(
      `Node REPL kernel exited unexpectedly${code !== null ? ` with code ${code}` : ""}${signal ? ` (signal ${signal})` : ""}${
        state.stderr.length ? `\n${state.stderr.join("")}` : ""
      }`,
    )
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    state.pending.clear()
    try {
      runtime().kernels.delete(sessionID)
    } catch (err) {
      log.debug("node-repl.kernel.delete.failed", { err })
    }
  })

  return state
}

function getKernel(sessionID: string) {
  const existing = runtime().kernels.get(sessionID)
  if (existing && !existing.closed) return existing
  const created = createKernel(sessionID)
  runtime().kernels.set(sessionID, created)
  return created
}

export function resetNodeReplSessionsForTest() {
  let kernels: Map<string, KernelState>
  try {
    kernels = runtime().kernels
  } catch {
    return
  }
  for (const kernel of kernels.values()) {
    kernel.closed = true
    try {
      kernel.child.kill()
    } catch (err) {
      log.debug("node-repl.test.reset.kill.failed", { err })
    }
    for (const pending of kernel.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("Node REPL kernel reset"))
    }
    kernel.pending.clear()
  }
  kernels.clear()
}

async function requestKernel(sessionID: string, request: KernelRequest, timeoutMS: number) {
  const kernel = getKernel(sessionID)
  return await new Promise<KernelResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      kernel.pending.delete(request.id)
      if (!kernel.closed) {
        kernel.closed = true
        try {
          kernel.child.kill()
        } catch (err) {
          log.debug("node-repl.timeout.kill.failed", { err })
        }
        runtime().kernels.delete(sessionID)
      }
      resolve({
        id: request.id,
        ok: false,
        timeout: true,
        error: `Node REPL request timed out after ${timeoutMS}ms`,
        logs: [],
      })
    }, timeoutMS)
    timeout.unref?.()
    kernel.pending.set(request.id, { resolve, reject, timeout })
    kernel.child.stdin.write(JSON.stringify(request) + "\n")
  })
}

export const NodeReplTool = Tool.define(
  "node_repl",
  {
    description:
      "Execute JavaScript in a persistent Node REPL kernel scoped to the current session. Bindings persist across calls. Supports top-level await and a reset option.",
    parameters: z.object({
      code: z.string().optional().describe("JavaScript source to evaluate in the persistent Node REPL kernel."),
      reset: z.boolean().optional().describe("When true, resets the session's Node REPL kernel and clears prior bindings."),
      timeout_ms: z.number().int().min(1).max(120_000).optional().describe("Evaluation timeout in milliseconds."),
    }),
    async execute(args, ctx): Promise<{ title: string; metadata: NodeReplMetadata; output: string }> {
      if (!args.reset && !args.code?.trim()) {
        throw new Error("node_repl requires either non-empty code or reset=true")
      }

      const kernel = getKernel(ctx.sessionID)
      const id = kernel.nextRequestID++
      let response: KernelResponse

      try {
        response = await requestKernel(
          ctx.sessionID,
          {
            id,
            code: args.code,
            reset: args.reset,
          },
          args.timeout_ms ?? DEFAULT_TIMEOUT_MS,
        )
      } catch (error) {
        const formatted = error instanceof Error ? error.stack || error.message : String(error)
        const metadata: NodeReplMetadata = {
          ok: false,
          status: "error",
          logs: [],
          spawnError: true,
          reset: false,
          timeout: false,
          resultText: undefined,
          resultType: undefined,
        }
        return {
          title: "Node REPL Error",
          metadata,
          output: truncate(["status: error", "<error>", formatted, "</error>"].join("\n")),
        }
      }

      if (!response.ok) {
        const metadata: NodeReplMetadata = {
          ok: false,
          status: response.timeout ? "timeout" : "error",
          logs: response.logs ?? [],
          timeout: response.timeout ?? false,
          spawnError: false,
          reset: args.reset ?? false,
          resultText: undefined,
          resultType: undefined,
        }
        return {
          title: response.timeout ? "Node REPL Timeout" : "Node REPL Error",
          metadata,
          output: truncate(
            [
              `status: ${response.timeout ? "timeout" : "error"}`,
              ...(response.logs?.length ? ["<logs>", ...response.logs, "</logs>"] : []),
              "<error>",
              response.error,
              "</error>",
            ].join("\n"),
          ),
        }
      }

      const resultType =
        response.resultText === ""
          ? "undefined"
          : /^-?\d+(?:\.\d+)?$/.test(response.resultText ?? "")
            ? "number"
            : response.resultText === "true" || response.resultText === "false"
              ? "boolean"
              : "string"

      const sections = ["status: ok", `result_type: ${resultType}`]
      if (response.logs?.length) {
        sections.push("<logs>", ...response.logs, "</logs>")
      }
      if (response.resultText) {
        sections.push("<result>", response.resultText, "</result>")
      }

      const metadata: NodeReplMetadata = {
        ok: true,
        status: "ok",
        logs: response.logs ?? [],
        reset: args.reset ?? false,
        timeout: false,
        spawnError: false,
        resultText: response.resultText,
        resultType,
      }
      return {
        title: args.reset ? "Node REPL Reset" : "Node REPL",
        metadata,
        output: truncate(sections.join("\n")),
      }
    },
  },
)
