type EndpointKind = "openai" | "anthropic"

type EndpointSpec = {
  kind: EndpointKind
  name: string
  baseURL: string
}

type ModelResult = {
  endpoint: string
  model: string
  ok: boolean
  status?: number
  firstEventMS?: number
  firstTextMS?: number
  totalMS: number
  output: string
  error?: string
}

const CONFIG_PATH = process.env.OPENCODE_CONFIG_PATH ?? "C:/Users/HP/.config/opencode/opencode.json"
const MODELS = ["qwen3.5-plus", "MiniMax-M2.5", "glm-5", "kimi-k2.5"]
const PROMPT = "Reply with exactly OK and nothing else."
const TIMEOUT_MS = Number(process.env.ALIBABA_BENCH_TIMEOUT_MS ?? "90000")

const ENDPOINTS: EndpointSpec[] = [
  {
    kind: "openai",
    name: "openai-compatible",
    baseURL: "https://coding-intl.dashscope.aliyuncs.com/v1",
  },
  {
    kind: "anthropic",
    name: "anthropic-compatible",
    baseURL: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1",
  },
]

async function readApiKey() {
  const file = Bun.file(CONFIG_PATH)
  const json = (await file.json()) as any
  const provider = json?.provider?.["alibaba-coding-plan"] ?? json?.provider?.["bailian-coding-plan-test"]
  const apiKey = provider?.options?.apiKey ?? process.env.ALIBABA_CODING_PLAN_API_KEY
  if (!apiKey) {
    throw new Error(`Could not find Alibaba Coding Plan apiKey in ${CONFIG_PATH} or ALIBABA_CODING_PLAN_API_KEY`)
  }
  return String(apiKey)
}

function openaiBody(model: string) {
  return {
    model,
    stream: true,
    temperature: 0,
    max_tokens: 64,
    messages: [
      {
        role: "user",
        content: PROMPT,
      },
    ],
  }
}

function anthropicBody(model: string) {
  return {
    model,
    stream: true,
    temperature: 0,
    max_tokens: 64,
    messages: [
      {
        role: "user",
        content: PROMPT,
      },
    ],
  }
}

async function runOne(endpoint: EndpointSpec, model: string, apiKey: string): Promise<ModelResult> {
  const started = performance.now()
  let firstEventMS: number | undefined
  let firstTextMS: number | undefined
  let output = ""
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)

  try {
    const url = endpoint.kind === "openai" ? `${endpoint.baseURL}/chat/completions` : `${endpoint.baseURL}/messages`
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers:
        endpoint.kind === "openai"
          ? {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            }
          : {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
      body: JSON.stringify(endpoint.kind === "openai" ? openaiBody(model) : anthropicBody(model)),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      return {
        endpoint: endpoint.name,
        model,
        ok: false,
        status: response.status,
        totalMS: Math.round(performance.now() - started),
        output: body.slice(0, 500),
        error: `HTTP ${response.status}`,
      }
    }

    if (!response.body) {
      return {
        endpoint: endpoint.name,
        model,
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
          const text = extractText(endpoint.kind, data)
          if (text) {
            output += text
            if (firstTextMS === undefined) firstTextMS = Math.round(performance.now() - started)
          }
        }
        boundary = buffer.indexOf("\n\n")
      }
    }

    return {
      endpoint: endpoint.name,
      model,
      ok: true,
      status: response.status,
      firstEventMS,
      firstTextMS,
      totalMS: Math.round(performance.now() - started),
      output: output.trim(),
    }
  } catch (error) {
    return {
      endpoint: endpoint.name,
      model,
      ok: false,
      totalMS: Math.round(performance.now() - started),
      output,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function extractText(kind: EndpointKind, data: string): string {
  let parsed: any
  try {
    parsed = JSON.parse(data)
  } catch {
    return ""
  }

  if (kind === "openai") {
    const delta = parsed?.choices?.[0]?.delta
    return delta?.content ?? delta?.reasoning_content ?? ""
  }

  if (parsed?.type === "content_block_delta") {
    return parsed?.delta?.text ?? parsed?.delta?.thinking ?? ""
  }
  if (parsed?.type === "message_delta") {
    return parsed?.delta?.text ?? ""
  }
  return ""
}

function printSummary(results: ModelResult[]) {
  const rows = results.map((item) => ({
    endpoint: item.endpoint,
    model: item.model,
    ok: item.ok,
    status: item.status ?? "",
    first_event_ms: item.firstEventMS ?? "",
    first_text_ms: item.firstTextMS ?? "",
    total_ms: item.totalMS,
    output: item.output.slice(0, 80),
    error: item.error ?? "",
  }))
  console.table(rows)
}

const apiKey = await readApiKey()
const results: ModelResult[] = []

for (const endpoint of ENDPOINTS) {
  for (const model of MODELS) {
    console.log(`Testing ${endpoint.name} -> ${model}`)
    results.push(await runOne(endpoint, model, apiKey))
  }
}

printSummary(results)

const grouped = new Map<string, ModelResult[]>()
for (const item of results) {
  const list = grouped.get(item.model) ?? []
  list.push(item)
  grouped.set(item.model, list)
}

for (const [model, list] of grouped) {
  const openai = list.find((item) => item.endpoint === "openai-compatible")
  const anthropic = list.find((item) => item.endpoint === "anthropic-compatible")
  if (!openai || !anthropic) continue
  console.log(
    JSON.stringify(
      {
        model,
        openai_first_text_ms: openai.firstTextMS ?? null,
        anthropic_first_text_ms: anthropic.firstTextMS ?? null,
        openai_total_ms: openai.totalMS,
        anthropic_total_ms: anthropic.totalMS,
        openai_ok: openai.ok,
        anthropic_ok: anthropic.ok,
      },
      null,
      2,
    ),
  )
}
