export type LiveTranscriptWindowMessage = {
  role: string
  time?: {
    completed?: number
  }
}

export function resolveLiveTranscriptWindow<TMessage extends LiveTranscriptWindowMessage>(
  messages: readonly TMessage[],
  limit: number,
) {
  if (!Number.isFinite(limit) || limit <= 0 || messages.length <= limit) {
    return {
      messages: [...messages],
      omittedCount: 0,
    }
  }

  const limitedStart = Math.max(0, messages.length - limit)
  const lastActiveIndex = messages.findLastIndex((message) => !message.time?.completed)
  if (lastActiveIndex === -1) {
    return {
      messages: messages.slice(limitedStart),
      omittedCount: limitedStart,
    }
  }

  let activeTurnStart = lastActiveIndex
  for (let index = lastActiveIndex; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      activeTurnStart = index
      break
    }
  }

  const start = Math.min(limitedStart, activeTurnStart)
  return {
    messages: messages.slice(start),
    omittedCount: start,
  }
}
