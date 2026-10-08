export function audioCacheDatabase(
  initial: Map<string, any> = new Map(),
  options: {
    readDelay?: number
    commitDelay?: number
    quotaFailure?: boolean
    beforeCommit?: () => void
  } = {}
) {
  const entries = initial
  let activeWrite = false
  const waitingWrites: Array<() => void> = []
  const db = {
    version: 1,
    objectStoreNames: { contains: () => true },
    transaction(_names: string[], mode: string) {
      const write = mode === 'readwrite'
      let staged: Map<string, any>,
        started = false,
        ended = false,
        pending = 0
      const queued: Array<() => void> = []
      const tx: any = { error: null, oncomplete: null, onabort: null, onerror: null }
      const release = () => {
        if (write) {
          activeWrite = false
          waitingWrites.shift()?.()
        }
      }
      tx.abort = () => {
        if (ended) return
        ended = true
        queueMicrotask(() => {
          tx.onabort?.()
          if (started) release()
        })
      }
      const finish = () => {
        if (pending || ended) return
        setTimeout(() => {
          if (pending || ended) return
          options.beforeCommit?.()
          if (ended) return
          if (write && options.quotaFailure) {
            tx.error = Object.assign(new Error('quota failed after put success'), {
              name: 'QuotaExceededError',
            })
            tx.abort()
            return
          }
          ended = true
          if (write) {
            entries.clear()
            for (const [key, value] of staged) entries.set(key, value)
          }
          tx.oncomplete?.()
          release()
        }, options.commitDelay ?? 0)
      }
      const request = (operation: () => unknown, delay = 0) => {
        const req: any = { result: null, error: null }
        pending++
        const run = () =>
          setTimeout(() => {
            if (ended) return
            req.result = operation()
            req.onsuccess?.({ target: req })
            pending--
            finish()
          }, delay)
        if (started) run()
        else queued.push(run)
        return req
      }
      tx.objectStore = () => ({
        getAll: () => request(() => [...staged.values()], options.readDelay ?? 0),
        get: (id: string) => request(() => staged.get(id)),
        put: (value: any) =>
          request(() => {
            staged.set(value.videoId, value)
            return value.videoId
          }),
        delete: (id: string) => request(() => staged.delete(id)),
      })
      const start = () => {
        if (ended) {
          waitingWrites.shift()?.()
          return
        }
        started = true
        if (write) activeWrite = true
        staged = new Map(entries)
        queued.splice(0).forEach((run) => run())
      }
      if (write && activeWrite) waitingWrites.push(start)
      else queueMicrotask(start)
      return tx
    },
  }
  return { db, entries }
}
