type BudgetResult = {
  model: string
  budget: string
  ok: boolean
  status?: number
  firstEventMS?: number
  firstTextMS?: number
  totalMS: number
  output: string
  error?: string
}

type ProviderConfig = {
  options?: {
    apiKey?: string
  }
  models?: Record<string, { limit?: { output?: number } }>
}

const CONFIG_PATH = process.env.OPENCODE_CONFIG_PATH ?? "C:/Users/HP/.config/opencode/opencode.json"
const ENDPOINT = process.env.ALIBABA_SWEEP_BASE_URL ?? "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1"
const MODELS = (process.env.ALIBABA_SWEEP_MODELS ?? "qwen3.5-plus,MiniMax-M2.5,glm-5,kimi-k2.5")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
const BUDGETS = (process.env.ALIBABA_SWEEP_BUDGETS ?? "8192,16384,32768")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => Number(item))
  .filter((item) => Number.isFinite(item) && item > 0)
const PROMPT = process.env.ALIBABA_SWEEP_PROMPT ?? "Reply with exactly OK and nothing else."
const TIMEOUT_MS = Number(process.env.ALIBABA_SWEEP_TIMEOUT_MS ?? "90000")

async function readConfig() {
  const file = Bun.file(CONFIG_PATH)
  const json = (await file.json()) as any
  const provider =
    (json?.provider?.["alibaba-coding-plan"] as ProviderConfig | undefined) ??
    (json?.provider?.["bailian-coding-plan-test"] as ProviderConfig | undefined)
  const apiKey = provider?.options?.apiKey ?? process.env.ALIBABA_CODING_PLAN_API_KEY
  if (!apiKey) {
    throw new Error(`Could not find Alibaba Coding Plan apiKey in ${CONFIG_PATH} or ALIBABA_CODING_PLAN_API_KEY`)
  }
  return {
    apiKey: String(apiKey),
    outputLimits: provider?.models ?? {},
  }
}

function maxTokensFor(model: string, outputLimits: Record<string, { limit?: { output?: number } }>, budget?: number) {
  const limit = outputLimits[model]?.limit?.output ?? 32768
  if (!budget) return Math.min(limit, 256)
  return Math.min(limit, budget + 128)
}

function bodyFor(
  model: string,
  outputLimits: Record<string, { limit?: { output?: number } }>,
  budget?: number,
) {
  const body: Record<string, unknown> = {
    model,
    stream: true,
    temperature: 0,
    max_tokens: maxTokensFor(model, outputLimits, budget),
    messages: [
      {
        role: "user",
        content: PROMPT,
      },
    ],
  }

  if (budget) {
    body.thinking = {
      type: "enabled",
      budget_tokens: budget,
    }
  }

  return body
}

function extractText(data: string): string {
  let parsed: any
  try {
    parsed = JSON.parse(data)
  } catch {
    return ""
  }

  if (parsed?.type === "content_block_delta") {
    return parsed?.delta?.text ?? parsed?.delta?.thinking ?? ""
  }
  if (parsed?.type === "message_delta") {
    return parsed?.delta?.text ?? ""
  }
  return ""
}

async function runOne(
  model: string,
  outputLimits: Record<string, { limit?: { output?: number } }>,
  apiKey: string,
  budget?: number,
): Promise<BudgetResult> {
  const started = performance.now()
  let firstEventMS: number | undefined
  let firstTextMS: number | undefined
  let output = ""
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)

  try {
    const response = await fetch(`${ENDPOINT}/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(bodyFor(model, outputLimits, budget)),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      return {
        model,
        budget: budget ? String(budget) : "default",
        ok: false,
        status: response.status,
        totalMS: Math.round(performance.now() - started),
        output: body.slice(0, 500),
        error: `HTTP ${response.status}`,
      }
    }

    if (!response.body) {
      return {
        model,
        budget: budget ? String(budget) : "default",
        ok: false,
        status: response.status,
        totalMS: Math.round(performance.now() - started),
        output: "",
        error: "No response body",
      }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (firstEventMS === undefined) firstEventMS = Math.round(performance.now() - started)
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of rawEvent.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === "[DONE]") continue
          const text = extractText(data)
          if (text) {
            output += text
            if (firstTextMS === undefined) firstTextMS = Math.round(performance.now() - started)
          }
        }
        boundary = buffer.indexOf("\n\n")
      }
    }

    return {
      model,
      budget: budget ? String(budget) : "default",
      ok: true,
      status: response.status,
      firstEventMS,
      firstTextMS,
      totalMS: Math.round(performance.now() - started),
      output: output.trim(),
    }
  } catch (error) {
    return {
      model,
      budget: budget ? String(budget) : "default",
      ok: false,
      totalMS: Math.round(performance.now() - started),
      output,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

const { apiKey, outputLimits } = await readConfig()
const results: BudgetResult[] = []

for (const model of MODELS) {
  console.log(`Testing ${model} with default budget`)
  results.push(await runOne(model, outputLimits, apiKey))
  for (const budget of BUDGETS) {
    console.log(`Testing ${model} with budget ${budget}`)
    results.push(await runOne(model, outputLimits, apiKey, budget))
  }
}

console.table(
  results.map((item) => ({
    model: item.model,
    budget: item.budget,
    ok: item.ok,
    status: item.status ?? "",
    first_event_ms: item.firstEventMS ?? "",
    first_text_ms: item.firstTextMS ?? "",
    total_ms: item.totalMS,
    output: item.output.slice(0, 80),
    error: item.error ?? "",
  })),
)
