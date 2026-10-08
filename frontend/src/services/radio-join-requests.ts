interface RadioJoinAttempt {
  id: number
  stationId: string
  cancelled: boolean
}

// The existing server returns a station ID, but no request ID. Socket.IO preserves
// response order on one connection; keep cancelled attempts until their reply so
// a late reply cannot be mistaken for a retry of the same station.
export class RadioJoinRequests {
  private sequence = 0
  private attempts: RadioJoinAttempt[] = []

  start(stationId: string): number {
    const id = ++this.sequence
    this.attempts.push({ id, stationId, cancelled: false })
    return id
  }

  cancel(id: number): boolean {
    const attempt = this.attempts.find((item) => item.id === id)
    if (!attempt || attempt.cancelled) return false
    attempt.cancelled = true
    return true
  }

  settle(stationId?: string): RadioJoinAttempt | undefined {
    const index = stationId === undefined
      ? 0
      : this.attempts.findIndex((item) => item.stationId === stationId)
    if (index < 0) return undefined
    return this.attempts.splice(index, 1)[0]
  }

  clear(): void {
    this.attempts = []
  }
}
