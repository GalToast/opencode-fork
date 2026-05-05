export type RefreshBroker = {
  queue: (sessionID: string, delay?: number, surfaces?: Iterable<string>) => void
  dispose: () => void
  getInFlightCount: () => number
}

export function createRefreshBroker<TName extends string>(input: {
  normalizeNames: (input?: Iterable<TName>) => TName[]
  resolveRootSessionID: (sessionID: string) => string
  refresh: (sessionID: string, surfaces: TName[]) => Promise<void>
  normalizeDelay?: (rootSessionID: string, surface: TName, delay: number) => number
  onError?: (event: {
    sessionID: string
    rootSessionID: string
    surface: TName
    error: unknown
  }) => void
  onInFlightSurfacesChange?: (surfaces: Set<TName>) => void
  cooldownMS?: Partial<Record<TName, number>>
  now?: () => number
  schedule?: typeof setTimeout
  cancel?: typeof clearTimeout
}): RefreshBroker {
  const now = input.now ?? (() => Date.now())
  const schedule = input.schedule ?? setTimeout
  const cancel = input.cancel ?? clearTimeout
  const cooldowns: Partial<Record<TName, number>> = input.cooldownMS ?? {}
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const pending = new Map<string, { sessionID: string; delay: number; surface: TName }>()
  const queued = new Map<string, { sessionID: string; delay: number; surface: TName }>()
  const inFlight = new Set<string>()
  const inFlightCounts = new Map<TName, number>()
  const nextAllowedAt = new Map<string, number>()
  let disposed = false

  const emitInFlightSurfaces = () => {
    input.onInFlightSurfacesChange?.(new Set(inFlightCounts.keys()))
  }

  const updateInFlightSurfaces = (surface: TName, delta: 1 | -1) => {
    const nextCount = Math.max(0, (inFlightCounts.get(surface) ?? 0) + delta)
    if (nextCount === 0) inFlightCounts.delete(surface)
    else inFlightCounts.set(surface, nextCount)
    emitInFlightSurfaces()
  }

  const getKey = (rootSessionID: string, surface: TName) => `${rootSessionID}::${surface}`

  const getCooldownDelay = (rootSessionID: string, surface: TName) => {
    const nextAllowedAtValue = nextAllowedAt.get(getKey(rootSessionID, surface)) ?? 0
    return Math.max(0, nextAllowedAtValue - now())
  }

  const queue = (sessionID: string, delay = 80, surfaces?: Iterable<string>) => {
    if (disposed) return
    const rootSessionID = input.resolveRootSessionID(sessionID)
    const requestedSurfaces = input.normalizeNames(surfaces as Iterable<TName> | undefined)
    if (requestedSurfaces.length === 0) return

    for (const surface of requestedSurfaces) {
      const key = getKey(rootSessionID, surface)
      const normalizedDelay = input.normalizeDelay?.(rootSessionID, surface, delay) ?? delay
      const effectiveDelay = Math.max(normalizedDelay, getCooldownDelay(rootSessionID, surface))
      const usesNormalizedBackoff = effectiveDelay > delay

      if (inFlight.has(key)) {
        const existingQueued = queued.get(key)
        queued.set(key, {
          sessionID,
          delay: usesNormalizedBackoff
            ? Math.max(existingQueued?.delay ?? effectiveDelay, effectiveDelay)
            : Math.min(existingQueued?.delay ?? effectiveDelay, effectiveDelay),
          surface,
        })
        continue
      }

      const existingPending = pending.get(key)
      const timerDelay = existingPending
        ? usesNormalizedBackoff
          ? Math.max(existingPending.delay, effectiveDelay)
          : Math.min(existingPending.delay, effectiveDelay)
        : effectiveDelay
      pending.set(key, { sessionID, delay: timerDelay, surface })
      const existingTimer = timers.get(key)
      if (existingTimer) cancel(existingTimer)
      timers.set(
        key,
        schedule(() => {
          timers.delete(key)
          const next = pending.get(key)
          pending.delete(key)
          run(next?.sessionID ?? sessionID, rootSessionID, [surface])
        }, timerDelay),
      )
    }
  }

  const flushQueued = (rootSessionID: string, surface: TName) => {
    if (disposed) return
    const key = getKey(rootSessionID, surface)
    const next = queued.get(key)
    if (!next) return
    queued.delete(key)
    queue(next.sessionID, next.delay, [surface])
  }

  const run = (sessionID: string, rootSessionID: string, surfaces?: Iterable<TName>) => {
    if (disposed) return
    const requestedSurfaces = input.normalizeNames(surfaces)
    if (requestedSurfaces.length === 0) return

    for (const surface of requestedSurfaces) {
      const key = getKey(rootSessionID, surface)
      if (inFlight.has(key)) {
        const existingQueued = queued.get(key)
        queued.set(key, {
          sessionID,
          delay: Math.min(existingQueued?.delay ?? 40, 40),
          surface,
        })
        continue
      }

      inFlight.add(key)
      updateInFlightSurfaces(surface, 1)
      void input
        .refresh(sessionID, [surface])
        .catch((error) => {
          input.onError?.({ sessionID, rootSessionID, surface, error })
        })
        .finally(() => {
          inFlight.delete(key)
          updateInFlightSurfaces(surface, -1)
          const cooldown = cooldowns[surface] ?? 0
          if (cooldown > 0) nextAllowedAt.set(key, now() + cooldown)
          else nextAllowedAt.delete(key)
          flushQueued(rootSessionID, surface)
        })
    }
  }

  return {
    queue,
    dispose: () => {
      disposed = true
      for (const timer of timers.values()) cancel(timer)
      timers.clear()
      pending.clear()
      queued.clear()
      inFlight.clear()
      inFlightCounts.clear()
      nextAllowedAt.clear()
      emitInFlightSurfaces()
    },
    getInFlightCount: () => inFlight.size,
  }
}
