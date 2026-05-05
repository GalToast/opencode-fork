export const SESSION_STEER_INTERRUPT = "SessionSteerInterrupt"

export class SessionSteerInterrupt extends Error {
  constructor(public readonly sessionID: string) {
    super(`Session ${sessionID} steer interrupt`)
    this.name = SESSION_STEER_INTERRUPT
  }
}

export function isSessionSteerInterrupt(error: unknown): error is SessionSteerInterrupt {
  if (error instanceof SessionSteerInterrupt) return true
  if (!error || typeof error !== "object") return false
  return "name" in error && (error as { name?: string }).name === SESSION_STEER_INTERRUPT
}
