import fs from "node:fs/promises"

const cfg = JSON.parse(await fs.readFile("C:/Users/HP/.config/opencode/opencode.json", "utf8"))
const apiKey = cfg.provider["alibaba-coding-plan"].options.apiKey as string
const baseURL = cfg.provider["alibaba-coding-plan"].options.baseURL as string
const MODEL = process.env.RAW_MODEL ?? "kimi-k2.5"
const TURN_COUNT = Number(process.env.RAW_TURN_COUNT ?? "3")

function paramsForModel(model: string) {
  if (model === "qwen3.5-plus") {
    return {
      max_tokens: 65535,
      thinking: { type: "enabled", budgetTokens: 32768 },
      temperature: 0.55,
      top_p: 1,
    }
  }
  if (model === "kimi-k2.5") {
    return {
      max_tokens: 32768,
      thinking: { type: "enabled", budgetTokens: 32767 },
      temperature: 1,
      top_p: 0.95,
    }
  }
  throw new Error(`Unsupported RAW_MODEL ${model}`)
}

async function run() {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = []
  const results: any[] = []
  const params = paramsForModel(MODEL)

  for (let turn = 1; turn <= TURN_COUNT; turn++) {
    const token = `RAW_${MODEL.replace(/[^a-z0-9]/gi, "_")}_${turn}_OK`
    messages.push({ role: "user", content: `Reply with exactly ${token} and nothing else.` })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error("timeout")), 60_000)
    const started = performance.now()
    let firstTextMS: number | undefined
    let output = ""
    try {
      const response = await fetch(`${baseURL}/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          messages,
          ...params,
        }),
      })

      if (!response.ok) {
        results.push({
          turn,
          status: response.status,
          error: await response.text(),
        })
        break
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
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
            let parsed: any
            try {
              parsed = JSON.parse(data)
            } catch {
              continue
            }
            const text = parsed?.delta?.text ?? ""
            if (!text) continue
            output += text
            if (firstTextMS === undefined) firstTextMS = Math.round(performance.now() - started)
          }
          boundary = buffer.indexOf("\n\n")
        }
      }
      output = output.trim()
      messages.push({ role: "assistant", content: output })
      results.push({
        turn,
        firstTextMS,
        totalMS: Math.round(performance.now() - started),
        output,
        ok: output.includes(token),
      })
    } catch (error) {
      results.push({
        turn,
        totalMS: Math.round(performance.now() - started),
        output,
        error: error instanceof Error ? error.message : String(error),
      })
      break
    } finally {
      clearTimeout(timeout)
    }
  }

  console.log(JSON.stringify({ model: MODEL, results }, null, 2))
}

await run()
