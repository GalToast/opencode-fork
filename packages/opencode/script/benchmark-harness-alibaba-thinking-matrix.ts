import { fileURLToPath } from "url"

type AgentOptions = Record<string, unknown>

type MatrixCase = {
  label: string
  agent: string
  model: string
  options?: AgentOptions
}

type BenchResult = {
  agent: string
  firstDeltaMS?: number
  firstReasoningMS?: number
  firstTextMS?: number
  totalMS: number
  output: string
  error?: string
}

const BENCH_SCRIPT = fileURLToPath(new URL("./benchmark-harness-latency.ts", import.meta.url))
const PROMPT = process.env.HARNESS_MATRIX_PROMPT ?? "Reply with exactly OK and nothing else."
const TIMEOUT_MS = Number(process.env.HARNESS_MATRIX_TIMEOUT_MS ?? "180000")

const qwenBudgets = (process.env.HARNESS_QWEN_BUDGETS ?? "1024,4096,8192,16384,32768")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isFinite(item) && item > 0)

const glmBudgets = (process.env.HARNESS_GLM_BUDGETS ?? "1024,4096,8192,16384,32768")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isFinite(item) && item > 0)

const minimaxBudgets = (process.env.HARNESS_MINIMAX_BUDGETS ?? "8192,16384")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isFinite(item) && item > 0)

const kimiBudgets = (process.env.HARNESS_KIMI_BUDGETS ?? "8192")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isFinite(item) && item > 0)

function budgetOptions(budget: number): AgentOptions {
  return {
    thinking: {
      type: "enabled",
      budgetTokens: budget,
    },
  }
}

function configFor(testCase: MatrixCase) {
  return JSON.stringify({
    agent: {
      [testCase.agent]: {
        mode: "all",
        model: `alibaba-coding-plan/${testCase.model}`,
        description: testCase.label,
        options: testCase.options ?? {},
      },
    },
  })
}

async function runCase(testCase: MatrixCase) {
  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      "run",
      BENCH_SCRIPT,
    ],
    cwd: import.meta.dir,
    env: {
      ...process.env,
      HARNESS_BENCH_AGENTS: testCase.agent,
      HARNESS_BENCH_PROMPT: PROMPT,
      HARNESS_BENCH_JSON: "1",
      OPENCODE_CONFIG_CONTENT: configFor(testCase),
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  const timeout = setTimeout(() => proc.kill(), TIMEOUT_MS)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (exitCode !== 0) {
      return {
        label: testCase.label,
        model: testCase.model,
        firstDeltaMS: undefined,
        firstReasoningMS: undefined,
        firstTextMS: undefined,
        totalMS: undefined,
        output: "",
        error: stderr.trim() || `child exited with code ${exitCode}`,
      }
    }

    const start = stdout.indexOf("[")
    const parsed = JSON.parse(start >= 0 ? stdout.slice(start) : stdout) as BenchResult[]
    const row = parsed[0]
    return {
      label: testCase.label,
      model: testCase.model,
      firstDeltaMS: row?.firstDeltaMS,
      firstReasoningMS: row?.firstReasoningMS,
      firstTextMS: row?.firstTextMS,
      totalMS: row?.totalMS,
      output: row?.output ?? "",
      error: row?.error,
    }
  } finally {
    clearTimeout(timeout)
  }
}

const cases: MatrixCase[] = [
  { label: "qwen default", agent: "matrix_qwen_default", model: "qwen3.5-plus" },
  { label: "qwen thinking enabled", agent: "matrix_qwen_enabled", model: "qwen3.5-plus", options: { thinking: { type: "enabled" } } },
  ...qwenBudgets.map((budget) => ({
    label: `qwen budget ${budget}`,
    agent: `matrix_qwen_${budget}`,
    model: "qwen3.5-plus",
    options: budgetOptions(budget),
  })),

  { label: "glm default", agent: "matrix_glm_default", model: "glm-5" },
  { label: "glm thinking enabled", agent: "matrix_glm_enabled", model: "glm-5", options: { thinking: { type: "enabled" } } },
  ...glmBudgets.map((budget) => ({
    label: `glm budget ${budget}`,
    agent: `matrix_glm_${budget}`,
    model: "glm-5",
    options: budgetOptions(budget),
  })),

  { label: "kimi default", agent: "matrix_kimi_default", model: "kimi-k2.5" },
  { label: "kimi thinking enabled", agent: "matrix_kimi_enabled", model: "kimi-k2.5", options: { thinking: { type: "enabled" } } },
  ...kimiBudgets.map((budget) => ({
    label: `kimi budget ${budget}`,
    agent: `matrix_kimi_${budget}`,
    model: "kimi-k2.5",
    options: budgetOptions(budget),
  })),

  { label: "minimax default", agent: "matrix_minimax_default", model: "MiniMax-M2.5" },
  { label: "minimax thinking enabled", agent: "matrix_minimax_enabled", model: "MiniMax-M2.5", options: { thinking: { type: "enabled" } } },
  ...minimaxBudgets.map((budget) => ({
    label: `minimax budget ${budget}`,
    agent: `matrix_minimax_${budget}`,
    model: "MiniMax-M2.5",
    options: budgetOptions(budget),
  })),
]

const results = []
for (const testCase of cases) {
  console.log(`Running ${testCase.label}`)
  results.push(await runCase(testCase))
}

console.table(results)
