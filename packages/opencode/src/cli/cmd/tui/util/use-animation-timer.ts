import { onCleanup, onMount } from "solid-js"

/**
 * Unified animation timer for TUI components.
 * Consolidates multiple setInterval calls into a single timer for better performance.
 * 
 * @param tickFn - Function called on each tick with delta time
 * @param intervalMs - Interval in milliseconds (default: 50ms = 20fps)
 * 
 * @example
 * ```ts
 * useAnimationTimer((dt) => {
 *   setPulsePhase(p => (p + 1) % 60)
 *   setRainbowHue(h => (h + 2) % 360)
 * })
 * ```
 */
export function useAnimationTimer(
  tickFn: (deltaTime: number) => void,
  intervalMs: number = 50
): void {
  onMount(() => {
    const interval = setInterval(() => {
      tickFn(intervalMs)
    }, intervalMs)
    
    onCleanup(() => clearInterval(interval))
  })
}

/**
 * Animation frame-based timer for smoother animations.
 * Uses requestAnimationFrame pattern adapted for TUI.
 * 
 * @param tickFn - Function called on each frame with delta time
 * 
 * @example
 * ```ts
 * useAnimationFrame((dt) => {
 *   setParticles(prev => prev.map(p => ({ ...p, y: p.y + p.speed * dt })))
 * })
 * ```
 */
export function useAnimationFrame(tickFn: (deltaTime: number) => void): void {
  let frameId: number
  let lastTime = performance.now()
  
  onMount(() => {
    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastTime
      lastTime = currentTime
      
      tickFn(deltaTime)
      frameId = requestAnimationFrame(animate)
    }
    
    frameId = requestAnimationFrame(animate)
    
    onCleanup(() => cancelAnimationFrame(frameId))
  })
}

/**
 * Multi-phase animation timer that supports different update rates.
 * Useful for components that need both fast and slow animations.
 * 
 * @param phases - Array of phase configurations with their intervals and callbacks
 * 
 * @example
 * ```ts
 * useMultiPhaseTimer([
 *   { interval: 30, fn: () => setTitlePulse(p => (p + 0.05) % (Math.PI * 2)) },
 *   { interval: 50, fn: () => { setPulsePhase(p => (p + 1) % 60); setRainbowHue(h => (h + 2) % 360) } },
 *   { interval: 800, fn: () => setIconIndex(i => (i + 1) % KAWAII_ICONS.length) },
 * ])
 * ```
 */
export function useMultiPhaseTimer(
  phases: Array<{ interval: number; fn: () => void }>
): void {
  onMount(() => {
    const intervals = phases.map((phase) => {
      return setInterval(phase.fn, phase.interval)
    })
    
    onCleanup(() => {
      intervals.forEach((interval) => clearInterval(interval))
    })
  })
}

/**
 * Consolidated timer for sidebar animations.
 * Combines sparkle, pulse, and rainbow animations into a single timer.
 */
export function useSidebarAnimationTimer(
  callbacks: {
    onSparkle?: () => void
    onPulse?: () => void
    onRainbow?: () => void
  }
): void {
  useAnimationTimer(() => {
    callbacks.onSparkle?.()
    callbacks.onPulse?.()
    callbacks.onRainbow?.()
  }, 50)
}

/**
 * Consolidated timer for header animations.
 * Combines rainbow, pulse, icon rotation, and bounce animations.
 */
export function useHeaderAnimationTimer(
  callbacks: {
    onRainbow?: () => void
    onPulse?: () => void
    onIcon?: () => void
    onBounce?: () => void
    onSparkle?: () => void
  }
): void {
  // Fast animations (30ms)
  useAnimationTimer(() => {
    callbacks.onPulse?.()
  }, 30)
  
  // Medium animations (50ms)
  useAnimationTimer(() => {
    callbacks.onRainbow?.()
    callbacks.onSparkle?.()
  }, 50)
  
  // Slow animations (800ms)
  useAnimationTimer(() => {
    callbacks.onIcon?.()
  }, 800)
  
  // Very slow animations (2000ms)
  useAnimationTimer(() => {
    callbacks.onBounce?.()
  }, 2000)
}

/**
 * Consolidated timer for footer animations.
 * Combines all footer animation phases efficiently.
 */
export function useFooterAnimationTimer(
  callbacks: {
    onMain?: () => void
    onBlink?: () => void
    onGlow?: () => void
    onParticle?: () => void
  }
): void {
  // Main timer handles most animations
  useAnimationTimer(() => {
    callbacks.onMain?.()
  }, 50)
  
  // Blink timer
  useAnimationTimer(() => {
    callbacks.onBlink?.()
  }, 60)
  
  // Glow timer
  useAnimationTimer(() => {
    callbacks.onGlow?.()
  }, 30)
  
  // Particle timer
  useAnimationTimer(() => {
    callbacks.onParticle?.()
  }, 100)
}
